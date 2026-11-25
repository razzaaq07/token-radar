# Token Radar — token-radar-01

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Token Radar rank](https://make.fun/bounty/token-radar-01/razzaaq07/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Token Radar reward](https://make.fun/bounty/token-radar-01/razzaaq07/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Every protocol DefiLlama tracks that still records no token, ranked by what its launch would be worth. An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC).

## What it is

- **Board:** 198 rows — the full 40-protocol watchlist (TVL ≥ $50M, no token) plus every other rankable pre-token protocol the snapshot holds (158 early rows). No top-N cut: the radar ranks the whole rankable set it finds.
- **Model (radar-2):** `implied = fitted × growth × maturity × odds`
  - `fitted = exp(7.9295 + 0.4617 × ln(TVL))` — a log-log comps curve **fitted on every run** on the snapshot's own live-token protocols (R² 0.144, n=118). Bigger protocols trade at lower multiples, so the curve values size sub-linearly.
  - `growth` — the 7-day TVL change, clamped to −60%…+120%; a rise counts ×0.5, a fall counts ×0.8.
  - `maturity` — `0.55 + 0.45 × (1 − e^(−age/730d))`; an unknown listing date counts as 365 days.
  - `odds` — the mean of the protocol's age bucket token rate and its category token rate, clamped to 5%…95%, over 532 dated protocols. Leave-one-out Brier 0.216 against the base rate's 0.250.
- **Validation:** the fit is validated out of sample (leave-one-out median absolute log error 1.202; a time split — fit the older half, test the newer half — gives 1.024), and the numbers are printed in the dashboard and in `board.json`.
- **Farm plans:** seven steps per protocol, derived from its category, chains, TVL and age — capital by TVL, gas priced by main chain, hold by age, with a second, different qualifying action per category.
- **Dashboard:** a static page (`dashboard/`) that renders the whole board with no network — sortable and filterable, a detail view per protocol with the full model breakdown and farm plan, a live-token tab at market value, and the model with its fit and validation.

## How the board is built

The sealed snapshot holds 758 protocols. The funnel to the board:

| Step | Count |
| --- | --- |
| Protocols in the snapshot | 758 |
| Record no token (no market cap, no CoinGecko id, no symbol) | 342 |
| Excluded as a wrapped, staked or bridged product, or a CEX | 144 |
| **Rows on the board** | **198** |

A protocol is rankable only if it records no token and is not a wrapped, staked or bridged product of a token that already trades: no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX category, no versioned pool name, no wrapped / staked / staking word, no exchange-prefixed name. That is why a staked-ETH product never tops this board.

The top of the board on this snapshot: Polymarket International ($14.7M implied, $320M TVL, 66% launch odds), USDD ($12.6M), Veda ($12.3M), Steakhouse Financial ($11.9M), Sentora ($11.6M). The smallest row carries $0.33M implied. Risk Curators hold the most combined implied value despite the lowest launch odds (13%) of any category — size against likelihood, stated openly.

## Farm plans

Each row carries seven steps, each an action with a cost and a time:

1. Fresh wallet, seed phrase offline (under $3 gas, 5 minutes).
2. The category's main action — supply, provide liquidity, bridge, stake, deposit margin, mint, buy cover — with capital by TVL ($50 / $100 / $150 / $250) and gas priced by the main chain.
3. A second, different qualifying action for the same protocol, so the wallet shows more than a single deposit.
4. One qualifying action each week (about $2 gas, 10 minutes a week).
5. Hold for 30–60 days by age, so the activity is counted in more than one snapshot.
6. Check the protocol's own points page; claim only from the link it publishes, never pay to claim.
7. Keep a farm log of the wallet, dates and transactions.

The dashboard shows the plan exactly as `board.json` states it, never regenerated, so the page and the board cannot disagree.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22, standard library only. Deterministic: the same input gives the same bytes out.

Then check it, enter it and follow it:

```
node <kit>/cli/makefun.mjs check --kit <kit> --repo . --transcripts transcripts.tar.gz
```

`.makefun/owner.json` — claim file naming the agent wallet linked to the entrant's account.
