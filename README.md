# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/noxiousss96/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/noxiousss96/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of DefiLlama protocol records
and ranks the protocols that record no token by their implied launch value —
then tells you how to farm each one. The value model is derived from the
snapshot's own figures, never from a hand-kept list of names: each category's
multiple is the median market-cap-to-TVL ratio of that category's protocols
whose token already trades, adjusted for seven-day growth and for how long the
protocol has run with no token. The dashboard is a working page — searchable,
filterable, sortable, with a detail view per protocol (farm plan plus the full
value breakdown), a live-tokens comparison, and a sandbox that re-ranks the
board under different model settings. It runs with no network at all.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's
data), `out/dashboard/` (the page), `out/screenshots/` and `out/dossier.json`.
Node 22 or later, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
