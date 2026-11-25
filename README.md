# Token Radar — token-radar-01

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Token Radar rank](https://make.fun/bounty/token-radar-01/razzaaq07/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Token Radar reward](https://make.fun/bounty/token-radar-01/razzaaq07/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Every protocol DefiLlama tracks that still records no token, ranked by what its launch would be worth. An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC).

## What it is

- **Board:** 198 rows — the full 40-protocol watchlist (TVL ≥ $50M, no token) plus every other rankable pre-token protocol the snapshot holds (158 early rows). No top-N cut: the radar ranks the whole rankable set it finds.
- **Model (radar-3):** `implied = fitted × growth × maturity × odds`
  - `fitted = exp(7.9295 + 0.4617 × ln(TVL))` — a log-log comps curve **fitted on every run** on the snapshot's own live-token protocols (R² 0.144, n=118). Bigger protocols trade at lower multiples, so the curve values size sub-linearly.
  - `growth` — the 7-day TVL change, clamped to −60%…+120%; a rise counts ×0.5, a fall counts ×0.8.
  - `maturity` — `0.55 + 0.45 × (1 − e^(−age/730d))`; an unknown listing date counts as 365 days.
  - `odds` — the mean of the protocol's age bucket token rate and its category token rate **read among protocols of the same age band**, shrunk toward that band's own rate when the cell is small, clamped to 5%…95%, over 532 dated protocols. Leave-one-out Brier 0.211 against the base rate's 0.250.
- **Validation:** every value term is fitted and tested held-out twice (leave-one-out and walk-forward); only the size curve survives both. The odds are scored the same way. The printed P25–P75 range is honest: 51% of real market caps fall inside it leave-one-out, 52% walk-forward. The numbers are printed in the dashboard and in `board.json`.
- **Farm plans:** seven steps per protocol, derived from its category, chains, TVL and age — capital by TVL, gas priced by main chain, hold by age, with a second, different qualifying action per category. Every row is costed: only 12 of 198 clear their costs under the stated scenario.
- **Dashboard:** a static page (`dashboard/`) that renders the whole board with no network — sortable and filterable, a detail view per protocol with the full model breakdown, the costed farm verdict and the farm plan, a live-token tab at market value, and the model with its fit, term evidence and validation.

## How the board is built

The sealed snapshot holds 758 protocols. Every one of them sits in exactly one group:

| Group | Count |
| --- | --- |
| Ranked · watchlist | 40 |
| Ranked · early, below the floor | 158 |
| Pre-token · excluded as wrapped / staked / bridged / CEX | 144 |
| Token trades · priced comp | 118 |
| Token recorded · no usable cap or out | 298 |
| **Total** | **758** |

Excluded pre-token: CEX 42, wrapped category 86, versioned 11, wrapped word 5. Live-token not in the comps: CEX 14, versioned 67, wrapped category 64, no usable cap 153.

A protocol is rankable only if it records no token and is not a wrapped, staked or bridged product of a token that already trades: no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX category, no versioned pool name, no wrapped / staked / staking word, no exchange-prefixed name. That is why a staked-ETH product never tops this board.

The top of the board on this snapshot: Polymarket International ($17.6M implied, $320M TVL, 78% launch odds), Steakhouse Financial ($14.1M), Sentora Curator ($13.7M), Veda ($11.7M), Gauntlet ($11.4M). Total implied across the board: $537.9M. The smallest row carries $0.35M implied.

## Every value term, fitted and tested held-out twice

A term is kept only when it lowers the held-out miss in **both** tests: leave-one-out refits, and a walk-forward split that fits the older half by listing date and tests the newer half (44 protocols). Median absolute log error:

| Term | Leave-one-out | Walk-forward | Verdict |
| --- | --- | --- | --- |
| flat median multiple | 1.555 | 1.458 | baseline |
| **size curve (log-log OLS)** | **1.202** | **1.024** | **kept** |
| + 7-day TVL growth | 1.208 | 1.171 | not kept: hurts both |
| + age (years listed) | 1.215 | 1.006 | not kept: helps walk-forward, hurts leave-one-out |
| + chain count | 1.247 | 1.026 | not kept: hurts both |
| + category effect (ridge 16) | 1.226 | 0.942 | not kept: helps walk-forward, hurts leave-one-out |
| + category effect (ridge 64) | 1.168 | 1.020 | not kept: the walk-forward gain is within noise |
| CONTROL: growth of another protocol | 1.137 | 1.210 | rejected: flatters leave-one-out through the market, fails walk-forward |

One test is not enough: the control improves leave-one-out by luck, because every protocol's week moves with the market, and walk-forward exposes it. That is why the radar requires both.

**Is the printed range honest?** The fitted value's P25–P75 range is ×0.32 to ×3.82 of the point value. Leave-one-out, 60 of 118 real market caps (51%) fall inside it; walk-forward, 23 of 44 (52%). Honest is about one half — the range neither flatters nor hides the miss.

## Every odds signal, scored leave-one-out and walk-forward

Brier score against the base rate (0.250 leave-one-out, 0.326 walk-forward):

| Signal | Leave-one-out | Walk-forward | Verdict |
| --- | --- | --- | --- |
| base rate | 0.250 | 0.326 | baseline |
| age bucket | 0.213 | 0.287 | kept: the strongest single signal |
| category rate | 0.245 | 0.345 | not kept: barely beats the base rate |
| **age-matched category rate** | **0.211** | **0.286** | **kept: the odds the board uses** |
| chain count | 0.255 | 0.316 | rejected: worse than the base rate |
| TVL band | 0.251 | 0.329 | rejected: looks predictive alone, adds nothing once age is known |

The age match matters: a category's rate is read among protocols of the same age band, shrunk toward that band's own rate when the cell is small. A young category must not drag an old protocol down — Risk Curators launch only 13% of the time overall, but among 1–2-year-old Risk Curators the rate is 21%, and the age band itself is 36%, so Steakhouse Financial (543 days, Risk Curators) carries 29% odds, not 13% and not 85%. TVL looks predictive alone (the biggest protocols launch most often) but adds nothing once age is known — the size gradient is the age gradient.

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

### Is it worth farming?

Every row is costed under one stated scenario: the airdrop pool is 10% of the implied value, an active farmer's points are worth 25× a passive deposit of the same size, and the cost is 8 transactions at the main chain's gas plus 2 hours at $10 an hour. The scenario is stated, not hidden, and the verdict changes if it does.

**12 of 198 rows clear their costs** (2 WORTH IT, 10 MARGINAL, 186 SKIP). The rest are not worth farming under this scenario, and the board says so. The best farm by net is metalx-swap (+$24.19, $12.09/hour); the top of the board is not the best farm — Steakhouse Financial nets −$20.49, because its $2.75B TVL means a $150 position is a rounding error of its implied value.

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
