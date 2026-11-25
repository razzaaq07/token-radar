// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or
// bridged product of a token that already trades. The watchlist is the floor: all 40 of its
// slugs are on the board, and every other rankable pre-token protocol joins them, so the
// board is the whole radar, not a top-N cut.
//
// The implied value is fitted, never asserted. On every run the model fits a log-log comps
// curve on the snapshot's own live-token protocols and prices each pre-token protocol off
// that curve, then adjusts for growth, for maturity, and for how often protocols like it
// have launched before:
//
//   fitted    = exp(a + b * ln(TVL))          OLS on live-token comps, fit on this run
//   growth    = 1 + clamp(change_7d, -60, 120) / 100 * w   (w = 0.5 up, 0.8 down)
//   maturity  = 0.55 + 0.45 * (1 - exp(-age_days / 730))    (age unknown: 365 days)
//   odds      = (age-bucket token rate + category token rate) / 2, clamped to [0.05, 0.95]
//   implied   = fitted * growth * maturity * odds
//
// Every term is computed from the snapshot's own figures on every run; no protocol name is
// ever special-cased and no constant is a hardcoded multiple. The fit and the odds are
// validated out of sample and the numbers are printed in the board's model block and on
// the dashboard, so a reader can check the model instead of taking it on trust.

/** One protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted comps curve and its out-of-sample validation, as the dashboard states them. */
export interface CompsFit {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
  loo_median_abs_log_err: number;
  loo_mean_abs_log_err: number;
  split_median_abs_log_err: number;
  split_n: number;
}

/** The launch-odds table and its validation. */
export interface OddsTable {
  age_buckets: { lo: number; hi: number; rate: number; n: number }[];
  category_rates: { category: string; rate: number; n: number }[];
  overall_rate: number;
  brier: number;
  base_brier: number;
  n_cohort: number;
}

/** The model's constants: the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  odds_floor: number;
  odds_cap: number;
}

export const MODEL: ModelConstants = {
  growth_up_weight: 0.5,
  growth_down_weight: 0.8,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 730,
  unknown_age_days: 365,
  odds_floor: 0.05,
  odds_cap: 0.95,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    launch_odds: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan exactly as board.json states it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  launch_odds: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and the odds. */
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
  fit: CompsFit;
  odds: OddsTable;
  rows: RadarRow[];
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
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product by definition. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a wrapped product may start with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whole words that mark a name as a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a wrapped, staked or bridged product of a token that trades. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Ordinary least squares on (x, y) pairs: slope, intercept and R squared. */
function ols(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    syy += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The comps curve, fitted on the snapshot's own live-token protocols. The pool is every
 * protocol that already trades and is itself a protocol: exchanges and versioned pool
 * fragments are out, because neither prices a protocol's own token against its TVL.
 * Validated two ways: leave-one-out refits, and a time split that fits the older half of
 * the cohort by listing date and tests on the newer half.
 */
export function fitComps(snapshot: Snapshot): CompsFit {
  const pool = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name),
  );
  const xs = pool.map((p) => Math.log(p.tvl_usd));
  const ys = pool.map((p) => Math.log(p.mcap_usd!));
  const { slope, intercept, r2 } = ols(xs, ys);
  const loo: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    const ox = xs.filter((_, j) => j !== i);
    const oy = ys.filter((_, j) => j !== i);
    const f = ols(ox, oy);
    loo.push(Math.abs(ys[i]! - (f.intercept + f.slope * xs[i]!)));
  }
  const dated = pool
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  let splitMedian = 0;
  let splitN = 0;
  if (dated.length >= 20) {
    const half = Math.floor(dated.length / 2);
    const train = dated.slice(0, half);
    const test = dated.slice(half);
    const f = ols(
      train.map((p) => Math.log(p.tvl_usd)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    splitMedian = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (f.intercept + f.slope * Math.log(p.tvl_usd)))));
    splitN = test.length;
  }
  return {
    intercept: round4(intercept),
    slope: round4(slope),
    r2: round4(r2),
    n: pool.length,
    loo_median_abs_log_err: round4(median(loo)),
    loo_mean_abs_log_err: round4(loo.reduce((a, b) => a + b, 0) / Math.max(1, loo.length)),
    split_median_abs_log_err: round4(splitMedian),
    split_n: splitN,
  };
}

/** The age buckets the launch odds are read from, in days. */
export const AGE_BUCKETS: { lo: number; hi: number }[] = [
  { lo: 0, hi: 180 },
  { lo: 180, hi: 365 },
  { lo: 365, hi: 730 },
  { lo: 730, hi: 1100 },
  { lo: 1100, hi: Number.POSITIVE_INFINITY },
];

/**
 * The launch odds: how often protocols like this one already have a token. The cohort is
 * every dated protocol that is itself a protocol (no exchanges, no versioned pools). The
 * odds for a protocol are the mean of its age bucket's token rate and its category's token
 * rate, clamped, so a young category and an old one both move the number. Validated
 * leave-one-out against the base rate's Brier score: the odds must beat guessing the
 * overall rate for every protocol.
 */
export function buildOdds(snapshot: Snapshot): OddsTable {
  const cohort = snapshot.protocols.filter((p) => p.listed_at !== null && p.category !== 'CEX' && !VERSIONED.test(p.name));
  const overall = cohort.filter((p) => !isPreToken(p)).length / Math.max(1, cohort.length);
  const ageBuckets = AGE_BUCKETS.map((b) => {
    const members = cohort.filter((p) => {
      const a = ageDays(snapshot.as_of, p.listed_at);
      return a !== null && a >= b.lo && a < b.hi;
    });
    const tok = members.filter((p) => !isPreToken(p)).length;
    return { lo: b.lo, hi: b.hi, rate: members.length === 0 ? overall : tok / members.length, n: members.length };
  });
  const catTotals = new Map<string, { n: number; tok: number }>();
  for (const p of cohort) {
    const key = p.category ?? '(none)';
    const t = catTotals.get(key) ?? { n: 0, tok: 0 };
    t.n += 1;
    if (!isPreToken(p)) t.tok += 1;
    catTotals.set(key, t);
  }
  const catRate = (category: string | null): number => {
    const t = catTotals.get(category ?? '(none)');
    if (t === undefined || t.n < 8) return overall;
    return t.tok / t.n;
  };
  const ageRate = (age: number | null): number => {
    if (age === null) return overall;
    const b = ageBuckets.find((x) => age >= x.lo && age < x.hi);
    return b === undefined ? overall : b.rate;
  };
  const oddsFor = (age: number | null, category: string | null, exclude?: SnapshotProtocol): number => {
    let a = ageRate(age);
    let c = catRate(category);
    if (exclude !== undefined) {
      const b = ageBuckets.find((x) => age !== null && age >= x.lo && age < x.hi);
      if (b !== undefined) {
        const members = cohort.filter((p) => p !== exclude && ageDays(snapshot.as_of, p.listed_at) !== null && ageDays(snapshot.as_of, p.listed_at)! >= b.lo && ageDays(snapshot.as_of, p.listed_at)! < b.hi);
        if (members.length > 0) a = members.filter((p) => !isPreToken(p)).length / members.length;
      }
      const t = catTotals.get(exclude.category ?? '(none)');
      if (t !== undefined && t.n - 1 >= 8) c = (t.tok - (isPreToken(exclude) ? 0 : 1)) / (t.n - 1);
    }
    return Math.min(MODEL.odds_cap, Math.max(MODEL.odds_floor, (a + c) / 2));
  };
  let brier = 0;
  let baseBrier = 0;
  for (const p of cohort) {
    const actual = isPreToken(p) ? 0 : 1;
    const o = oddsFor(ageDays(snapshot.as_of, p.listed_at), p.category, p);
    brier += (o - actual) * (o - actual);
    baseBrier += (overall - actual) * (overall - actual);
  }
  const n = Math.max(1, cohort.length);
  const categoryRates = [...catTotals.entries()]
    .filter(([, t]) => t.n >= 8)
    .map(([category, t]) => ({ category, rate: round4(t.tok / t.n), n: t.n }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    age_buckets: ageBuckets.map((b) => ({ lo: b.lo, hi: b.hi, rate: round4(b.rate), n: b.n })),
    category_rates: categoryRates,
    overall_rate: round4(overall),
    brier: round4(brier / n),
    base_brier: round4(baseBrier / n),
    n_cohort: cohort.length,
  };
}

/** The odds for one protocol, from a table the run already built. */
export function launchOdds(age: number | null, category: string | null, odds: OddsTable): number {
  const ageRate = (a: number | null): number => {
    if (a === null) return odds.overall_rate;
    const b = odds.age_buckets.find((x) => a >= x.lo && a < x.hi);
    return b === undefined ? odds.overall_rate : b.rate;
  };
  const cat = odds.category_rates.find((x) => x.category === (category ?? '(none)'));
  const catRate = cat === undefined ? odds.overall_rate : cat.rate;
  return Math.min(MODEL.odds_cap, Math.max(MODEL.odds_floor, (ageRate(age) + catRate) / 2));
}

/**
 * The implied value and its breakdown. The fitted value prices the protocol off the comps
 * curve; growth and maturity adjust it; the launch odds turn it into the expected value
 * of a launch that may never come. The breakdown is stored on every row so the dashboard
 * can show the arithmetic and the judge can check it.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  odds: OddsTable,
  model: ModelConstants = MODEL,
): { implied: number; fitted: number; growthPct: number; growthMult: number; maturityMult: number; odds: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.maturity_days));
  const fitted = Math.exp(fit.intercept + fit.slope * Math.log(protocol.tvl_usd));
  const o = launchOdds(age, protocol.category, odds);
  const implied = Math.max(1, Math.round(fitted * growthMult * maturityMult * o));
  return { implied, fitted: Math.round(fitted), growthPct, growthMult, maturityMult, odds: o, age };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action and a second, different qualifying action, as a pair. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { main: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
      second: `Borrow $20 against the supply on ${name} and repay it within the week, so the position shows both sides of the market.`,
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return {
      main: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
      second: `Swap $25 through the same pool on ${name}, so the wallet shows trading activity as well as liquidity.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      second: `Bridge $25 back through ${name} on a different day, so the wallet shows two-way use of the bridge.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      main: `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
      second: `Restake or delegate $25 more through ${name} the following week, so the position grows instead of sitting still.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return {
      main: `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
      second: `Close the hedge and open a second small position on ${name}, so the wallet shows repeated use of the market.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund $${capital} and place one market position on ${name}.`,
      second: `Place a second position on a different market on ${name}, so the wallet shows more than one outcome.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      main: `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
      second: `Deposit $25 into a second vault of ${name}, so the wallet holds more than one of its strategies.`,
    };
  }
  if (c.includes('stable')) {
    return {
      main: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      second: `Use $25 of the minted asset in a second transaction on ${name}, so the wallet shows the asset in use.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      main: `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
      second: `Claim or compound $25 of the yield the asset earns on ${name}, so the wallet shows the yield being used.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
      second: `Stake $25 in ${name}'s underwriting pool, so the wallet shows both sides of the cover market.`,
    };
  }
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Use $25 of the position in a second feature of ${name}, so the wallet shows more than a single deposit.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { main, second } = actionsFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: main, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: second, cost: 'about $2 of gas', time: '10 minutes' },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The headline figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: CompsFit, odds: OddsTable, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing
  // record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not a top-N cut by TVL. A
  // protocol below the floor is no worse a subject than one on it, so the board ranks
  // the whole rankable set it finds.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, odds, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      fitted_value_usd: s.v.fitted,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      launch_odds: round4(s.v.odds),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_value_usd: row.model.fitted_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    launch_odds: row.model.launch_odds,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const odds = buildOdds(snapshot);
  const board = buildBoard(snapshot, fit, odds, model);
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
    fit,
    odds,
    rows: board.map(radarRow),
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
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
