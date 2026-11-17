// Token radar model: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols — protocols whose snapshot record carries no token
// (no market cap, no CoinGecko id, no symbol) — by the implied value a token would carry
// if the protocol's record stayed as it is. It never predicts whether or when a token
// launches. Protocols whose token already trades are set aside and shown with the
// market's own value, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures — TVL, seven-day growth,
// how long the protocol has run with no token, and how many chains it runs on:
//
//   base        = tvl_usd x 0.30
//   growth      = clamp(change_7d, -50, 200) per cent; unreported growth counts as 0
//   growthMult  = 1 + growth / 100 x 0.80
//   age         = days from listed_at to as_of; unlisted age counts as 365 days
//   maturityMult = 0.55 + 0.45 x min(age, 1095) / 1095
//   reachMult   = 1 + 0.03 x min(max(chains - 1, 0), 10)
//   implied     = max(1, round(base x growthMult x maturityMult x reachMult))
//
// Why these four terms: TVL is the value already entrusted to the protocol, so the
// token's implied value scales with it. Growth rewards momentum and punishes decay,
// capped so one wild week (the snapshot's fastest grower is up over 4000%) cannot
// dominate the board. Maturity rewards staying power: a protocol that has held large
// TVL for years with no token on record has more pent-up value than one listed last
// month. Reach rewards breadth: a protocol live on many chains has more surfaces a
// token could attach to, capped at ten extra chains so a 40-chain index does not
// swamp the ranking. No protocol name is ever special-cased: one function scores
// every row, and the dashboard prints the same arithmetic beside each row.
//
// The watchlist is the floor, never the ceiling: every watchlist slug is ranked,
// and the early radar adds the rankable pre-token protocols below the floor, by TVL.
// Rankable means pre-token and not a product of a token that already trades — the
// house watchlist rule, applied to the early rows too: no CEX, no bridge, no liquid
// staking or restaking product, no versioned pool, no name carrying the whole word
// wrapped, staked or staking, and no name starting with an exchange's name.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed by the dashboard and fixed for a run. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 200,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  reach_per_chain: 0.03,
  reach_max_chains: 10,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'marten-radar-1';

/** How many live-token protocols the dashboard's live strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: an action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs, written to data.js. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_chains);
  const reachMult = 1 + model.reach_per_chain * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * reachMult));
  return { implied, growthPct, growthMult, maturityMult, reachMult, age };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying one of these whole words is a wrapped, staked or staking product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name must not start with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Categories that are products of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol may be ranked: pre-token and not a product of a token that
 * already trades. The watchlist slugs pass this rule by construction; the early
 * rows are held to the same bar so the board never ranks a CEX, a bridge or a
 * wrapped/staked product as a token that might launch.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: every watchlist slug plus the rankable pre-token protocols below the floor, by TVL. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the floor, strongest TVL first.
  // No cap is applied: the gate allows up to 4,000 rows and this snapshot yields 138,
  // so the board stays complete rather than truncated at an arbitrary number.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    token_status: 'pre-token' as const,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      reach_multiplier: round4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One farm step as a single string: the action, then its cost and time. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols need a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's main farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares — curators route the capital, your shares are the receipt.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s tokenised real-world asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('basis trading') || c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedged position, and close it the same week.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it within the week.`;
  }
  if (c.includes('dex')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL yield vault on ${chain} and leave it compounding.`;
  }
  if (c.includes('restak') || c.includes('staking pool')) {
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and keep the staking receipt in the wallet.`;
  }
  if (c.includes('stablecoin') || c.includes('stable')) {
    return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it for the full farming window.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole window.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} of payments through ${name} on ${chain} in two or three separate transfers.`;
  }
  if (c.includes('governance')) {
    return `Lock $${capital} of voting power through ${name} on ${chain} and vote in the next live proposal.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit $${capital} of USDC into ${name}'s yield account on ${chain} and keep the balance untouched.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${name} on ${chain}, then use it once inside the chain's own app.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} on ${chain} and place one small position on an outcome market.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds once in its app.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full window.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The
 * plan is derived from the protocol's own record — category, chains, TVL and age —
 * never from a hand-written list of names. The first step is always a small test
 * transaction, so a wrong address or a dead contract costs $5, not the whole stake.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm with, write its seed phrase on paper, and never paste it anywhere.`,
      cost: 'free to create, under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Send a $5 test deposit to ${p.name} on ${chain} first and confirm it lands before you send the rest.`,
      cost: '$5 of capital and about $1 of gas',
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: `Do one qualifying action every week — a deposit, a swap, a borrow and repay, or a vote — so the wallet shows a pattern, not a single deposit.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted across more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a month, open ${p.name}'s own points or rewards page from the link the protocol itself publishes and check what the wallet has earned.`,
      cost: 'free to check, and never pay a fee to claim',
      time: '10 minutes a month',
    },
    {
      text: `When you unwind, withdraw in two tranches a day apart, then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'about $3 of gas to exit',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's live strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.category === null || !PRODUCT_CATEGORIES.has(p.category)))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
