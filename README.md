# Token Radar — build the best token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ssllxx1/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ssllxx1/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)


A radar for pre-token protocols: which protocol is worth farming next, what a
token would be worth if the protocol kept its record, and what to do about it.
It reads one sealed snapshot of the protocol universe (DefiLlama, 2026-11-14,
758 protocols) and ranks the protocols that record no token by implied value.

## What it ranks

- **Watchlist (40):** every protocol with TVL ≥ $50,000,000 and no token on
  record, per the house rule.
- **Early radar (138):** the rankable pre-token protocols below that floor, by
  TVL — held to the same bar as the watchlist, so no CEX, bridge, liquid
  staking/restaking or wrapped/staked product is ever ranked as a token that
  might launch. Together the board holds **178 rows** on this snapshot.
- **Set aside:** protocols whose token already trades, shown with their market
  cap — a fact, not a model.

"Records no token" is what the snapshot says, never proof a protocol has none.

## The value model

```
implied = round( tvl_usd × 0.30
  × (1 + clamp(change_7d, -50, 200) / 100 × 0.80)
  × (0.55 + min(age_days, 1095) / 1095 × 0.45)
  × (1 + 0.03 × min(chains − 1, 10)) )
```

TVL is the value already entrusted to the protocol. Growth rewards momentum
and punishes decay, clamped so one wild week cannot dominate the board.
Maturity rewards staying power: holding large TVL for years with no token on
record is more pent-up value than a listing from last month (unlisted age
counts as 365 days). Reach rewards breadth across chains, capped at ten extra
chains. No protocol name is special-cased — one function scores every row, and
the dashboard recomputes each row and prints whether it matches board.json.

Each row also carries a 7-step farm plan derived from the protocol's own
record (category, chains, TVL, age): a fresh wallet, a $5 test deposit, the
category's main action with a stated capital, a weekly action, a hold window,
a monthly points check, and an exit in two tranches — every step with its cost
and time.

## How to run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22, standard library only, no network. `main.ts` writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/` into the output directory,
and writes `dossier.json` with the vendored make.fun library. The run is
deterministic: the same snapshot bytes always produce the same output bytes.

## Layout

- `main.ts` — entrypoint: read snapshot, score, write outputs.
- `lib/model.ts` — the value model, the farm plans, the snapshot parser.
- `vendor/makefun-board.ts` — the kit's dossier library, verbatim.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js` (dark theme,
  sortable board, search/category/chain filters, pre-token vs has-token tabs,
  pinned detail panel per protocol). No network at render time.
- `screenshots/` — the board, a detail view, a filtered view.

## License

MIT — see `LICENSE`.
