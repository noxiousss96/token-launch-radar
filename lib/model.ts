// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every other rankable pre-token protocol below the watchlist floor: the early rows the radar
// exists to find. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol); live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The key step is the multiple, and
// radar-4 fits it instead of taking a median: a log-log regression of market cap on TVL across
// the snapshot's trading protocols (log mcap = intercept + slope x log TVL), with a per-category
// effect from the median residual of that category's trading protocols. The fit uses only the
// trading protocols whose mcap/TVL sits between 0.02x and 5x — 24 extremes (a 400x bridge, giants
// under 0.02x) are left out of the fit so they cannot set the curve; they still appear in the
// Live view. A category's effect is shrunk toward the global curve by its comparable count
// (shrinkage k = 9; a category with fewer than 3 comparables keeps only 10% of its effect, so a
// single comparable can no longer set a category's multiple). Each protocol's multiple is the
// fitted curve at its own TVL, clamped to the model's band. Then:
//
//   base       = tvl_usd x fittedMultiple(TVL, category)
//   growth     = clamp(change_7d, -60, 120) per cent (change_7d unknown: the snapshot's median)
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.8 + min(age_days, 730) / 730 x 0.2   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The fit is tested held out, three ways, and the dashboard shows every number: leave-one-out
// over the whole fit population, a deterministic 70/30 split by slug, and walk-forward (fit on
// the oldest 60/70/80% of dated listings, test on the newer rest; the number shown is the
// median of the three splits' median errors). Each value term is added in turn and tested both
// ways, so the dashboard can say which terms earned their place and which are kept because the
// task asks for them. The printed p10-p90 ranges are checked the same way: the share of held-out
// caps that fall inside the printed P25-P75 and P10-P90 bands. The odds are scored by Brier
// score, leave-one-out and walk-forward, against the base rate alone. A seeded bootstrap (200
// refits) gives the standard error of the fitted slope and of the multiple at $100M TVL. A curve
// that was never tested is a claim, not a model.
//
// Three more numbers ride on every row. Launch odds: the category's launch base rate (the share
// of the snapshot's protocols in that category that already trade) adjusted for the protocol's age
// (older with no token, slightly less likely) and its seven-day growth (growing, slightly more
// likely), clamped to 0.02-0.95. Expected value is implied x odds; ranking stays by implied
// value. Uncertainty: every row carries a p10-p90 implied-value range from the dispersion of the
// fit's log residuals (its own category's, when it has at least 5, else the global dispersion),
// and the rank range that range implies. Farm cost is the gas of the plan itself (set-up gas plus
// $2 a week over the hold plus $1 to claim); net expected value is expected value minus that cost.
//
// The farmer's own verdict is separate from the protocol's expected value, because a farmer
// does not receive the whole protocol: the farm deposit is 0.02% of the protocol's TVL (at least
// $100), the airdrop is assumed to be 7% of the token's value, and the farmer's share of it is
// deposit / TVL. Expected drop = implied x odds x 7% x (deposit / TVL); net = drop - gas; net
// per hour = net / the hours the plan takes. FARM when net is at least $25, MARGINAL when it is
// positive but below $25, SKIP when it is negative. The deposit is the model's plan size, stated
// on the board — it is not a recommendation for any one farmer's wallet.
//
// The dashboard also accounts for the whole snapshot: every one of the 758 protocols sits in
// exactly one group (ranked on the watchlist, ranked early, live and shown, token trades but not
// shown, token recorded with no usable cap, or set aside for one stated reason). The integrity
// strip on the cover recomputes the board from board.json's own figures and shows the board's
// checksum, so the page and the file it claims to show can be checked against each other.
//
// The constants are stated in the dashboard and changeable in the model sandbox. No protocol
// name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_min: number;
  multiple_max: number;
  multiple_shrink_k: number;
  fit_ratio_min: number;
  fit_ratio_max: number;
  odds_floor: number;
  odds_cap: number;
  odds_age_decay: number;
  odds_growth_weight: number;
  /** The farm deposit as a share of the protocol's TVL (at least deposit_min_usd). */
  deposit_share: number;
  deposit_min_usd: number;
  /** The share of the token's value the airdrop is assumed to pay to depositors. */
  drop_share: number;
  /** A farm verdict is FARM when the farmer's net is at least this many dollars. */
  verdict_farm_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 730,
  unknown_age_days: 365,
  multiple_min: 0.02,
  multiple_max: 2.0,
  multiple_shrink_k: 9,
  fit_ratio_min: 0.02,
  fit_ratio_max: 5,
  odds_floor: 0.02,
  odds_cap: 0.95,
  odds_age_decay: 0.3,
  odds_growth_weight: 0.3,
  deposit_share: 0.0002,
  deposit_min_usd: 100,
  drop_share: 0.07,
  verdict_farm_usd: 25,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's trading multiple, derived from the snapshot's own tokenised protocols. */
export interface CategoryMultiple {
  category: string;
  n: number;
  multiple: number;
  at_tvl_usd: number;
}

/** The fitted curve: log mcap = intercept + slope x log TVL, plus a shrunk effect per category. */
export interface FitResult {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
  effects: Map<string, { effect: number; raw: number; n: number }>;
  /** Sorted log residuals (actual minus fitted log mcap) of the fit population. */
  globalResiduals: number[];
  /** Sorted log residuals per category, only for categories with at least 5 fit protocols. */
  categoryResiduals: Map<string, number[]>;
}

/** One value term, added in turn and tested both held-out ways, for the evidence table. */
export interface EvidenceTerm {
  label: string;
  /** Median absolute percentage error, leave-one-out. */
  loo_median_abs_pct_error: number;
  /** Median multiplicative miss, leave-one-out. */
  loo_median_factor: number;
  /** Median absolute percentage error, walk-forward (median of three time splits). */
  wf_median_abs_pct_error: number;
  /** Median multiplicative miss, walk-forward. */
  wf_median_factor: number;
  /** Whether the term is kept, and why. */
  verdict: string;
}

/** One odds term, added in turn and scored by Brier score, for the evidence table. */
export interface OddsEvidenceTerm {
  label: string;
  brier_loo: number;
  brier_wf: number;
  verdict: string;
}

/** The fit tested held out, three ways, with the evidence tables behind it. */
export interface ModelValidation {
  r2: number;
  n_fitted: number;
  holdout_n: number;
  holdout_median_abs_pct_error: number;
  holdout_median_factor: number;
  loo_n: number;
  loo_median_abs_pct_error: number;
  loo_median_factor: number;
  walkforward_n: number;
  walkforward_median_abs_pct_error: number;
  walkforward_median_factor: number;
  /** The flat median multiple's median miss, leave-one-out and walk-forward. */
  flat_loo_median_factor: number;
  flat_wf_median_factor: number;
  /** Share of held-out caps inside the printed P25-P75 and P10-P90 bands (leave-one-out). */
  range_p25_holdout_pct: number;
  range_p90_holdout_pct: number;
  /** Brier scores for the odds: the full model and the base rate alone. */
  odds_brier_loo: number;
  odds_base_brier_loo: number;
  odds_brier_wf: number;
  odds_base_brier_wf: number;
  /** Bootstrap standard errors (200 seeded refits) for the fitted slope and the multiple at $100M TVL. */
  slope_se: number;
  multiple_at_100m: number;
  multiple_at_100m_se: number;
  value_terms: EvidenceTerm[];
  odds_terms: OddsEvidenceTerm[];
}

/** A farm step: the action, what it costs, and how long it takes. */
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
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  rank_best: number;
  rank_worst: number;
  launch_odds: number;
  expected_value_usd: number;
  farm_cost_usd: number;
  net_expected_value_usd: number;
  /** The farmer's own economics: deposit, expected drop, net, net per hour, verdict. */
  deposit_usd: number;
  farmer_drop_usd: number;
  farmer_net_usd: number;
  farmer_net_per_hour_usd: number;
  farm_verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  farm_hours: number;
  model: {
    category_multiple: number;
    category_n: number;
    category_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  rank_best: number;
  rank_worst: number;
  launch_odds: number;
  expected_value_usd: number;
  farm_cost_usd: number;
  net_expected_value_usd: number;
  deposit_usd: number;
  farmer_drop_usd: number;
  farmer_net_usd: number;
  farmer_net_per_hour_usd: number;
  farm_verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  farm_hours: number;
  category_multiple: number;
  category_n: number;
  category_fallback: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
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
  mcap_tvl: number | null;
}

/** One group of the snapshot's ledger: every protocol sits in exactly one group. */
export interface AuditGroup {
  label: string;
  count: number;
}

/** One traded protocol's TVL and market cap, for the cap-on-TVL scatter. */
export interface TradingPoint {
  tvl_usd: number;
  mcap_usd: number;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
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
  global_multiple: number;
  median_change_7d: number;
  fit: { intercept: number; slope: number; r2: number; n_fitted: number; ratio_min: number; ratio_max: number };
  validation: ModelValidation;
  multiples: CategoryMultiple[];
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  /** The ledger: every snapshot protocol in exactly one group. */
  audit: AuditGroup[];
  /** The first 8 hex characters of the sha256 of board.json's own bytes. */
  board_checksum: string;
  /** The traded protocols behind the fit, for the cap-on-TVL scatter. */
  trading: TradingPoint[];
  /** The farm verdicts across the board, and the best net per hour. */
  farm_counts: { farm: number; marginal: number; skip: number };
  best_net_per_hour: { name: string; slug: string; net_usd: number; net_per_hour_usd: number };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot's median seven-day TVL change across its protocols; 0 when none report one. */
export function medianChange7d(snapshot: Snapshot): number {
  const changes = snapshot.protocols
    .map((p) => p.change_7d)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    .sort((a, b) => a - b);
  return median(changes) ?? 0;
}

/** A quantile of a sorted list; null when empty. */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** The protocols the fit can learn from: trading, with a positive market cap and TVL. */
function tradingProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Whether a trading protocol joins the fit: its mcap/TVL must sit inside the model's band. */
function inFitPopulation(p: SnapshotProtocol, model: ModelConstants): boolean {
  const r = (p.mcap_usd ?? 0) / p.tvl_usd;
  return r >= model.fit_ratio_min && r <= model.fit_ratio_max;
}

/** Ordinary least squares for y = a + b x; R-squared floored at 0. */
function ols(points: { x: number; y: number }[]): { intercept: number; slope: number; r2: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    sst += (p.y - my) ** 2;
  }
  if (sxx === 0 || sst === 0) return { intercept: my, slope: 0, r2: 0 };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const p of points) sse += (p.y - (intercept + slope * p.x)) ** 2;
  return { intercept, slope, r2: Math.max(0, 1 - sse / sst) };
}

/** The fitted multiple at one protocol's TVL, from an intercept, a slope and shrunk effects. */
function fittedMultipleFrom(
  intercept: number,
  slope: number,
  effects: Map<string, { effect: number; raw: number; n: number }>,
  p: SnapshotProtocol,
  model: ModelConstants,
): number {
  const key = p.category ?? '(uncategorised)';
  const effect = effects.get(key)?.effect ?? 0;
  const tvl = Math.max(p.tvl_usd, 1);
  return Math.min(model.multiple_max, Math.max(model.multiple_min, Math.exp(intercept + effect + (slope - 1) * Math.log(tvl))));
}

/** The fitted curve's parameters, without the residual lists: the shared core of every fit. */
interface ValueFit {
  intercept: number;
  slope: number;
  r2: number;
  effects: Map<string, { effect: number; raw: number; n: number }>;
  globalMed: number;
}

/** Which terms a value variant uses. */
interface ValueTerms {
  size: boolean;
  cat: boolean;
  growth: boolean;
  maturity: boolean;
}

/**
 * Fit one value variant on `train`: the log-log curve (when size), the shrunk category effects
 * (when cat), and the flat median multiple (the baseline every variant is measured against).
 * With fewer than 10 training protocols the curve falls back to a flat multiple at the median
 * ratio, so the fit never invents a slope from nothing.
 */
function fitVariant(train: SnapshotProtocol[], model: ModelConstants, terms: ValueTerms): ValueFit {
  const points = train.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!), p }));
  let intercept: number;
  let slope: number;
  let r2: number;
  if (train.length < 10 || !terms.size) {
    const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    intercept = Math.log(median(ratios) ?? 0.25);
    slope = 1;
    r2 = 0;
  } else {
    const f = ols(points);
    intercept = f.intercept;
    slope = f.slope;
    r2 = f.r2;
  }
  const byCat = new Map<string, number[]>();
  for (const pt of points) {
    const r = pt.y - (intercept + slope * pt.x);
    const key = pt.p.category ?? '(uncategorised)';
    const list = byCat.get(key) ?? [];
    list.push(r);
    byCat.set(key, list);
  }
  const effects = new Map<string, { effect: number; raw: number; n: number }>();
  for (const [category, list] of byCat) {
    list.sort((a, b) => a - b);
    const raw = median(list) ?? 0;
    const n = list.length;
    const shrink = n < 3 ? 0.1 : n / (n + model.multiple_shrink_k);
    effects.set(category, { effect: raw * shrink, raw, n });
  }
  const ratios = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return { intercept, slope, r2, effects, globalMed: median(ratios) ?? 0.25 };
}

/** One protocol's implied value under a fitted variant, with the variant's own terms. */
function predictVariant(
  p: SnapshotProtocol,
  fit: ValueFit,
  model: ModelConstants,
  terms: ValueTerms,
  medianChange: number,
  asOf: string,
): number {
  const age = ageDays(asOf, p.listed_at);
  let mult: number;
  if (!terms.size) {
    mult = fit.globalMed;
  } else {
    const key = p.category ?? '(uncategorised)';
    const e = terms.cat ? (fit.effects.get(key)?.effect ?? 0) : 0;
    mult = Math.min(model.multiple_max, Math.max(model.multiple_min, Math.exp(fit.intercept + e + (fit.slope - 1) * Math.log(Math.max(p.tvl_usd, 1)))));
  }
  let m = p.tvl_usd * mult;
  if (terms.growth) {
    const raw = finite(p.change_7d, medianChange);
    const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
    m *= 1 + (growthPct / 100) * model.growth_weight;
  }
  if (terms.maturity) {
    const ageM = age ?? model.unknown_age_days;
    m *= model.maturity_floor + (Math.min(Math.max(ageM, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  return Math.max(1, Math.round(m));
}

/**
 * The fitted curve: log mcap = intercept + slope x log TVL over the snapshot's trading protocols
 * whose mcap/TVL sits inside the model's band, with a per-category effect from the median
 * residual of that category's fit protocols, shrunk toward the global curve — a category with
 * fewer than 3 comparables keeps only 10% of its effect, one with many stands mostly on its
 * own. `train` restricts the fit to a subset (the hold-out and walk-forward validations);
 * without it, the whole fit population is used.
 */
export function fitModel(snapshot: Snapshot, model: ModelConstants, train?: SnapshotProtocol[]): FitResult {
  const pool = (train ?? tradingProtocols(snapshot)).filter((p) => inFitPopulation(p, model));
  const v = fitVariant(pool, model, { size: true, cat: true, growth: false, maturity: false });
  const points = pool.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!), p }));
  // Log residuals around the fitted multiple itself, for the uncertainty ranges.
  const residualsByCat = new Map<string, number[]>();
  const globalResiduals: number[] = [];
  for (const pt of points) {
    const r = pt.y - Math.log(pt.p.tvl_usd * fittedMultipleFrom(v.intercept, v.slope, v.effects, pt.p, model));
    globalResiduals.push(r);
    const key = pt.p.category ?? '(uncategorised)';
    const list = residualsByCat.get(key) ?? [];
    list.push(r);
    residualsByCat.set(key, list);
  }
  globalResiduals.sort((a, b) => a - b);
  const categoryResiduals = new Map<string, number[]>();
  for (const [category, list] of residualsByCat) {
    if (list.length >= 5) categoryResiduals.set(category, [...list].sort((a, b) => a - b));
  }
  return { intercept: v.intercept, slope: v.slope, r2: v.r2, n: pool.length, effects: v.effects, globalResiduals, categoryResiduals };
}

/** One protocol's fitted multiple: the curve at its own TVL, clamped to the model's band. */
export function fittedMultiple(p: SnapshotProtocol, fit: FitResult, model: ModelConstants): number {
  return fittedMultipleFrom(fit.intercept, fit.slope, fit.effects, p, model);
}

/** The multiple one protocol gets: its fitted multiple, with the comparable count behind it. */
export function multipleFor(p: SnapshotProtocol, fit: FitResult, model: ModelConstants): { multiple: number; n: number; fallback: boolean } {
  const key = p.category ?? '(uncategorised)';
  const n = fit.effects.get(key)?.n ?? 0;
  return { multiple: fittedMultiple(p, fit, model), n, fallback: n === 0 };
}

/**
 * The multiples table for the dashboard: one row per category, the fitted multiple at the
 * category's median fit-population TVL (its pre-token median when it has no fit protocols),
 * with the comparable count the effect rests on.
 */
export function multiplesTable(snapshot: Snapshot, fit: FitResult, model: ModelConstants): CategoryMultiple[] {
  const fitPool = tradingProtocols(snapshot).filter((p) => inFitPopulation(p, model));
  const fitSet = new Set(fitPool);
  const globalTvl = median(fitPool.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 1;
  const cats = new Map<string, { fitTvls: number[]; preTvls: number[] }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(uncategorised)';
    const c = cats.get(key) ?? { fitTvls: [], preTvls: [] };
    if (fitSet.has(p)) c.fitTvls.push(p.tvl_usd);
    if (isPreToken(p)) c.preTvls.push(p.tvl_usd);
    cats.set(key, c);
  }
  const table: CategoryMultiple[] = [];
  for (const [category, c] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const refList = c.fitTvls.length > 0 ? c.fitTvls : c.preTvls;
    const refTvl = median([...refList].sort((a, b) => a - b)) ?? globalTvl;
    const n = fit.effects.get(category)?.n ?? 0;
    const probe: SnapshotProtocol = {
      slug: '',
      name: '',
      category: category === '(uncategorised)' ? null : category,
      chains: [],
      tvl_usd: refTvl,
      change_7d: null,
      mcap_usd: null,
      listed_at: null,
      gecko_id: null,
      symbol: null,
    };
    table.push({ category, n, multiple: round4(fittedMultiple(probe, fit, model)), at_tvl_usd: Math.round(refTvl) });
  }
  return table;
}

/**
 * The fit tested held out, three ways, with the evidence tables behind it. Hold-out: a
 * deterministic 70/30 split of the fit population by sorted slug. Leave-one-out: every fit
 * protocol priced from a fit on the other 103. Walk-forward: the fit on the oldest 60/70/80% of
 * dated listings, tested on the newer rest; the number shown is the median of the three splits'
 * median errors. Each value term is added in turn and tested both ways; each odds term is scored
 * by Brier score. The printed ranges are checked leave-one-out: the share of held-out caps that
 * fall inside the printed P25-P75 and P10-P90 bands. A seeded bootstrap (200 refits) gives the
 * standard error of the fitted slope and of the multiple at $100M TVL.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants): ModelValidation {
  const fitSet = tradingProtocols(snapshot).filter((p) => inFitPopulation(p, model));
  const medianChange = medianChange7d(snapshot);
  const asOf = snapshot.as_of;
  const full: ValueTerms = { size: true, cat: true, growth: true, maturity: true };
  const missFactor = (pred: number, actual: number): number => Math.max(pred / actual, actual / pred);
  const stats = (pairs: { pred: number; actual: number }[]): { medPct: number; medFactor: number } => {
    const pcts = pairs.map(({ pred, actual }) => (Math.abs(pred - actual) / actual) * 100).sort((a, b) => a - b);
    const factors = pairs.map(({ pred, actual }) => missFactor(pred, actual)).sort((a, b) => a - b);
    return { medPct: median(pcts) ?? 0, medFactor: median(factors) ?? 0 };
  };
  const looPairs = (terms: ValueTerms): { pred: number; actual: number }[] => {
    const pairs: { pred: number; actual: number }[] = [];
    for (const held of fitSet) {
      const fit = fitVariant(fitSet.filter((p) => p.slug !== held.slug), model, terms);
      pairs.push({ pred: predictVariant(held, fit, model, terms, medianChange, asOf), actual: held.mcap_usd! });
    }
    return pairs;
  };
  const datedFit = fitSet
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!) || a.slug.localeCompare(b.slug));
  const wfStatsFor = (terms: ValueTerms): { medPct: number; medFactor: number } => {
    const medPcts: number[] = [];
    const medFactors: number[] = [];
    for (const frac of [0.6, 0.7, 0.8]) {
      const cut = Math.floor(datedFit.length * frac);
      const fit = fitVariant(datedFit.slice(0, cut), model, terms);
      const pairs = datedFit.slice(cut).map((p) => ({ pred: predictVariant(p, fit, model, terms, medianChange, asOf), actual: p.mcap_usd! }));
      const s = stats(pairs);
      medPcts.push(s.medPct);
      medFactors.push(s.medFactor);
    }
    return { medPct: median([...medPcts].sort((a, b) => a - b)) ?? 0, medFactor: median([...medFactors].sort((a, b) => a - b)) ?? 0 };
  };
  // Hold-out: the deterministic 70/30 split by sorted slug.
  const bySlug = [...fitSet].sort((a, b) => a.slug.localeCompare(b.slug));
  const holdTrain = bySlug.filter((_, i) => i % 10 < 7);
  const holdTest = bySlug.filter((_, i) => i % 10 >= 7);
  const holdFit = fitVariant(holdTrain, model, full);
  const holdStats = stats(holdTest.map((p) => ({ pred: predictVariant(p, holdFit, model, full, medianChange, asOf), actual: p.mcap_usd! })));
  // Leave-one-out for the full model, with the range-honesty check on the same fits: the train
  // set's residuals around each leave-one-out fit give the bands a held-out cap is tested in.
  const looFullPairs: { pred: number; actual: number }[] = [];
  let in2575 = 0;
  let in1090 = 0;
  for (const held of fitSet) {
    const train = fitSet.filter((p) => p.slug !== held.slug);
    const fit = fitVariant(train, model, full);
    const pred = predictVariant(held, fit, model, full, medianChange, asOf);
    looFullPairs.push({ pred, actual: held.mcap_usd! });
    const residuals = train
      .map((p) => Math.log(p.mcap_usd!) - Math.log(predictVariant(p, fit, model, full, medianChange, asOf)))
      .sort((a, b) => a - b);
    const lo90 = pred * Math.exp(quantile(residuals, 0.1) ?? 0);
    const hi90 = pred * Math.exp(quantile(residuals, 0.9) ?? 0);
    const lo75 = pred * Math.exp(quantile(residuals, 0.25) ?? 0);
    const hi75 = pred * Math.exp(quantile(residuals, 0.75) ?? 0);
    if (held.mcap_usd! >= lo75 && held.mcap_usd! <= hi75) in2575++;
    if (held.mcap_usd! >= lo90 && held.mcap_usd! <= hi90) in1090++;
  }
  const looStats = stats(looFullPairs);
  const wfStats = wfStatsFor(full);
  // The flat baseline, for the "versus flat" comparison.
  const flatTerms: ValueTerms = { size: false, cat: false, growth: false, maturity: false };
  const flatLoo = stats(looPairs(flatTerms));
  const flatWf = wfStatsFor(flatTerms);
  // The value terms, added in turn, each tested both ways. A term is kept when it lowers both
  // held-out errors; a term that gains on one test and stays within noise on the other is kept
  // with the reason stated; a term that moves neither by more than a point is kept because the
  // task asks for it (the value follows from TVL, seven-day growth and how long it has run).
  const termDefs: { label: string; terms: ValueTerms }[] = [
    { label: 'Flat median multiple', terms: flatTerms },
    { label: '+ size curve', terms: { size: true, cat: false, growth: false, maturity: false } },
    { label: '+ category effect', terms: { size: true, cat: true, growth: false, maturity: false } },
    { label: '+ 7-day growth', terms: { size: true, cat: true, growth: true, maturity: false } },
    { label: '+ maturity', terms: full },
  ];
  const valueTerms: EvidenceTerm[] = [];
  let prev: { looPct: number; wfPct: number } | null = null;
  for (const def of termDefs) {
    const loo = def.terms === full ? looStats : stats(looPairs(def.terms));
    const wf = def.terms === full ? wfStats : wfStatsFor(def.terms);
    let verdict: string;
    if (prev === null) verdict = 'baseline';
    else if (loo.medPct < prev.looPct && wf.medPct < prev.wfPct) verdict = 'kept';
    else if (loo.medPct < prev.looPct && wf.medPct - prev.wfPct < 5) verdict = 'kept — LOO gain, walk-forward within noise';
    else if (wf.medPct < prev.wfPct && loo.medPct - prev.looPct < 5) verdict = 'kept — walk-forward gain, leave-one-out within noise';
    else if (Math.abs(loo.medPct - prev.looPct) <= 1 && Math.abs(wf.medPct - prev.wfPct) <= 1) verdict = 'kept — within noise; the task asks for the term';
    else verdict = 'tested, not kept';
    valueTerms.push({
      label: def.label,
      loo_median_abs_pct_error: round1(loo.medPct),
      loo_median_factor: round2(loo.medFactor),
      wf_median_abs_pct_error: round1(wf.medPct),
      wf_median_factor: round2(wf.medFactor),
      verdict,
    });
    prev = { looPct: loo.medPct, wfPct: wf.medPct };
  }
  // The odds, scored by Brier score against the base rate alone. Leave-one-out excludes the
  // protocol itself from its category's counts; walk-forward takes the base rates from the
  // training period only.
  const peers = snapshot.protocols;
  const oddsCounts = (
    list: SnapshotProtocol[],
  ): { counts: Map<string, { t: number; n: number }>; gT: number; gN: number } => {
    const counts = new Map<string, { t: number; n: number }>();
    let gT = 0;
    for (const p of list) {
      const key = p.category ?? '(uncategorised)';
      const c = counts.get(key) ?? { t: 0, n: 0 };
      c.n++;
      if (p.mcap_usd !== null) {
        c.t++;
        gT++;
      }
      counts.set(key, c);
    }
    return { counts, gT, gN: list.length };
  };
  const oddsPredict = (
    p: SnapshotProtocol,
    br: { counts: Map<string, { t: number; n: number }>; gT: number; gN: number },
    useAge: boolean,
    useGrowth: boolean,
    exclude: SnapshotProtocol | null,
  ): number => {
    const key = p.category ?? '(uncategorised)';
    const c = br.counts.get(key);
    let base: number;
    if (c) {
      let t = c.t;
      let n = c.n;
      if (exclude !== null && exclude.slug === p.slug) {
        t -= p.mcap_usd !== null ? 1 : 0;
        n -= 1;
      }
      base = n > 0 ? t / n : br.gT / br.gN;
    } else base = br.gT / br.gN;
    if (!useAge && !useGrowth) return Math.min(model.odds_cap, Math.max(model.odds_floor, base));
    const age = ageDays(asOf, p.listed_at);
    let o = base;
    if (useAge) {
      const ageM = age ?? model.unknown_age_days;
      o *= 1 - model.odds_age_decay * (Math.min(Math.max(ageM, 0), model.maturity_days) / model.maturity_days);
    }
    if (useGrowth) {
      const raw = finite(p.change_7d, medianChange);
      o *= 1 + model.odds_growth_weight * (Math.min(model.growth_cap, Math.max(model.growth_floor, raw)) / 100);
    }
    return Math.min(model.odds_cap, Math.max(model.odds_floor, o));
  };
  const brier = (pairs: { odds: number; actual: number }[]): number =>
    pairs.reduce((s, x) => s + (x.odds - x.actual) ** 2, 0) / pairs.length;
  const oddsLoo = (useAge: boolean, useGrowth: boolean): number => {
    const br = oddsCounts(peers);
    return brier(peers.map((p) => ({ odds: oddsPredict(p, br, useAge, useGrowth, p), actual: p.mcap_usd !== null ? 1 : 0 })));
  };
  const oddsWf = (useAge: boolean, useGrowth: boolean): number => {
    const dated = peers
      .filter((p) => p.listed_at !== null)
      .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!) || a.slug.localeCompare(b.slug));
    const scores: number[] = [];
    for (const frac of [0.6, 0.7, 0.8]) {
      const cut = Math.floor(dated.length * frac);
      const br = oddsCounts(dated.slice(0, cut));
      scores.push(
        brier(dated.slice(cut).map((p) => ({ odds: oddsPredict(p, br, useAge, useGrowth, null), actual: p.mcap_usd !== null ? 1 : 0 }))),
      );
    }
    return median([...scores].sort((a, b) => a - b)) ?? 0;
  };
  const oddsDefs = [
    { label: 'Base rate only', age: false, growth: false },
    { label: '+ age', age: true, growth: false },
    { label: '+ age + growth', age: true, growth: true },
  ];
  const oddsTerms: OddsEvidenceTerm[] = [];
  let prevOdds: { loo: number; wf: number } | null = null;
  for (const def of oddsDefs) {
    const loo = oddsLoo(def.age, def.growth);
    const wf = oddsWf(def.age, def.growth);
    let verdict: string;
    if (prevOdds === null) verdict = 'baseline';
    else if (loo < prevOdds.loo && wf < prevOdds.wf) verdict = 'kept';
    else if (loo < prevOdds.loo && wf - prevOdds.wf < 0.005) verdict = 'kept — LOO gain, walk-forward within noise';
    else if (wf < prevOdds.wf && loo - prevOdds.loo < 0.005) verdict = 'kept — walk-forward gain, leave-one-out within noise';
    else if (Math.abs(loo - prevOdds.loo) < 0.005 && Math.abs(wf - prevOdds.wf) < 0.005) verdict = 'kept — within noise; the task asks for the term';
    else verdict = 'tested, not kept';
    oddsTerms.push({ label: def.label, brier_loo: round3(loo), brier_wf: round3(wf), verdict });
    prevOdds = { loo, wf };
  }
  // Bootstrap standard errors: 200 refits on resamples of the fit population, seeded so the
  // build is deterministic.
  let seed = 123456789;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const slopes: number[] = [];
  const mults100: number[] = [];
  for (let i = 0; i < 200; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < fitSet.length; j++) sample.push(fitSet[Math.floor(rnd() * fitSet.length)]!);
    const f = fitVariant(sample, model, { size: true, cat: false, growth: false, maturity: false });
    slopes.push(f.slope);
    mults100.push(Math.exp(f.intercept + (f.slope - 1) * Math.log(1e8)));
  }
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = (xs: number[]): number => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  };
  const fullFit = fitModel(snapshot, model);
  const wfTestN = datedFit.length - Math.floor(datedFit.length * 0.7);
  return {
    r2: round4(fullFit.r2),
    n_fitted: fullFit.n,
    holdout_n: holdTest.length,
    holdout_median_abs_pct_error: round1(holdStats.medPct),
    holdout_median_factor: round2(holdStats.medFactor),
    loo_n: fitSet.length,
    loo_median_abs_pct_error: round1(looStats.medPct),
    loo_median_factor: round2(looStats.medFactor),
    walkforward_n: wfTestN,
    walkforward_median_abs_pct_error: round1(wfStats.medPct),
    walkforward_median_factor: round2(wfStats.medFactor),
    flat_loo_median_factor: round2(flatLoo.medFactor),
    flat_wf_median_factor: round2(flatWf.medFactor),
    range_p25_holdout_pct: round1((100 * in2575) / fitSet.length),
    range_p90_holdout_pct: round1((100 * in1090) / fitSet.length),
    odds_brier_loo: round3(oddsTerms[2]!.brier_loo),
    odds_base_brier_loo: round3(oddsTerms[0]!.brier_loo),
    odds_brier_wf: round3(oddsTerms[2]!.brier_wf),
    odds_base_brier_wf: round3(oddsTerms[0]!.brier_wf),
    slope_se: round3(sd(slopes)),
    multiple_at_100m: round3(mean(mults100)),
    multiple_at_100m_se: round3(sd(mults100)),
    value_terms: valueTerms,
    odds_terms: oddsTerms,
  };
}

/** The launch base rates: the share of the snapshot's protocols in each category that already trade. */
export function launchBaseRates(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const counts = new Map<string, { trading: number; total: number }>();
  let gTrading = 0;
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(uncategorised)';
    const c = counts.get(key) ?? { trading: 0, total: 0 };
    c.total++;
    if (p.mcap_usd !== null) {
      c.trading++;
      gTrading++;
    }
    counts.set(key, c);
  }
  const byCategory = new Map<string, number>();
  for (const [category, c] of counts) byCategory.set(category, c.total > 0 ? c.trading / c.total : 0);
  return { byCategory, global: snapshot.protocols.length > 0 ? gTrading / snapshot.protocols.length : 0 };
}

/**
 * One protocol's launch odds: its category's base rate, adjusted for age (older with no token,
 * slightly less likely to launch soon) and seven-day growth (growing, slightly more likely),
 * clamped to the model's odds band. A transparent score from the snapshot's own figures.
 */
export function launchOdds(
  p: SnapshotProtocol,
  age: number | null,
  baseRates: { byCategory: Map<string, number>; global: number },
  model: ModelConstants,
  medianChange: number,
): number {
  const key = p.category ?? '(uncategorised)';
  const base = baseRates.byCategory.get(key) ?? baseRates.global;
  const ageM = age ?? model.unknown_age_days;
  const ageFactor = 1 - model.odds_age_decay * (Math.min(Math.max(ageM, 0), model.maturity_days) / model.maturity_days);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : medianChange;
  const growthFactor = 1 + model.odds_growth_weight * (Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth)) / 100);
  return Math.min(model.odds_cap, Math.max(model.odds_floor, base * ageFactor * growthFactor));
}

/** A row's p10-p90 implied-value range from the fit's log-residual dispersion. */
export function valueRange(implied: number, p: SnapshotProtocol, fit: FitResult): { low: number; high: number } {
  const key = p.category ?? '(uncategorised)';
  const residuals = fit.categoryResiduals.get(key) ?? fit.globalResiduals;
  const lo = quantile(residuals, 0.1) ?? 0;
  const hi = quantile(residuals, 0.9) ?? 0;
  return {
    low: Math.max(1, Math.min(implied, Math.round(implied * Math.exp(lo)))),
    high: Math.max(implied, Math.round(implied * Math.exp(hi))),
  };
}

/** The farm plan's gas cost in whole dollars: set-up gas, $2 a week over the hold, $1 to claim. */
export function farmCostUsd(p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL): number {
  const capital = capitalFor(p, model);
  const gas = capital >= 150 ? 8 : 4;
  const hold = holdDaysFor(age);
  return gas + 2 * Math.ceil(hold / 7) + 1;
}

/** The hours one farm plan takes: the plan's own stated times — wallet, set-up, a weekly action over the hold, the claim, and the log. */
export function farmHours(age: number | null): number {
  const hold = holdDaysFor(age);
  return (35 + 10 * Math.ceil(hold / 7)) / 60;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: FitResult,
  medianChange = 0,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  // Unknown growth scores the snapshot's median change, not zero: a missing figure is no
  // reason to rank a protocol above the typical one.
  const rawGrowth = finite(protocol.change_7d, medianChange);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { multiple } = multipleFor(protocol, fit, model);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange names that mark a protocol as an exchange's own product, not a farmable protocol. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitModel(snapshot, model);
  const medianChange = medianChange7d(snapshot);
  const baseRates = launchBaseRates(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol below the watchlist floor.
  // A chosen protocol stays chosen; the early set only adds.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, fit, medianChange);
    const key = p.category ?? '(uncategorised)';
    const categoryN = fit.effects.get(key)?.n ?? 0;
    const fallback = categoryN === 0;
    const { low, high } = valueRange(implied, p, fit);
    const odds = launchOdds(p, age, baseRates, model, medianChange);
    // The stored odds are rounded to 4 places, and the expected value is computed from the
    // rounded odds, so the board's own figures agree with each other exactly.
    const oddsRounded = round4(odds);
    const expected = Math.round(implied * oddsRounded);
    const cost = farmCostUsd(p, age, model);
    // The farmer's own economics: the deposit is 0.02% of the protocol's TVL (at least $100),
    // the airdrop is assumed to be 7% of the token's value, and the farmer's share of it is
    // deposit / TVL. The protocol's expected value is not the farmer's: a $50 deposit in a
    // $100M protocol buys a $0.04 share of its drop, and a verdict on that is worthless.
    const deposit = capitalFor(p, model);
    const drop = expected * model.drop_share * (deposit / p.tvl_usd);
    const hours = farmHours(age);
    const net = drop - cost;
    const netPerHour = net / hours;
    const verdict: 'FARM' | 'MARGINAL' | 'SKIP' = net >= model.verdict_farm_usd ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
    return {
      p,
      implied,
      multiple,
      growthPct,
      growthMult,
      maturityMult,
      age,
      categoryN,
      fallback,
      low,
      high,
      odds: oddsRounded,
      expected,
      cost,
      netExpected: Math.max(0, expected - cost),
      deposit,
      drop,
      net,
      netPerHour,
      verdict,
      hours,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Rank ranges: where a row would sit at the top of its range (others at their point values)
  // and where at the bottom. A narrow range means a firm rank; a wide one, an honest doubt.
  const ranked = scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    rankBest: 1 + scored.filter((o) => o.implied > s.high).length,
    rankWorst: Math.min(scored.length, 1 + scored.filter((o) => o.implied > s.low).length),
  }));
  return ranked.map((s) => ({
    rank: s.rank,
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
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_value_low_usd: s.low,
    implied_value_high_usd: s.high,
    rank_best: s.rankBest,
    rank_worst: s.rankWorst,
    launch_odds: s.odds,
    expected_value_usd: s.expected,
    farm_cost_usd: s.cost,
    net_expected_value_usd: s.netExpected,
    deposit_usd: Math.round(s.deposit),
    farmer_drop_usd: round2(s.drop),
    farmer_net_usd: round2(s.net),
    farmer_net_per_hour_usd: round2(s.netPerHour),
    farm_verdict: s.verdict,
    farm_hours: round2(s.hours),
    model: {
      // The multiple is stored at 6 decimals so the dashboard's recomputation of a row's
      // implied value agrees with the stored value to well within 0.1%.
      category_multiple: round6(s.multiple),
      category_n: s.categoryN,
      category_fallback: s.fallback,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

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

/** How much capital one farm position needs: 0.02% of the protocol's TVL, at least $100. */
function capitalFor(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  return Math.max(model.deposit_min_usd, model.deposit_share * p.tvl_usd);
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield aggregator')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('liquid staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Stake $${capital} worth of the launchpad's required asset on ${name} to qualify for allocations.`;
  if (c.includes('gaming') || c.includes('gamefi')) return `Play ${name} on ${chain} with $${capital} of in-game assets and complete one daily quest.`;
  if (c.includes('nft')) return `Buy or list one NFT through ${name} on ${chain} and keep the position for the season.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s shielded pool on ${chain} and keep the note safe.`;
  if (c.includes('ai') || c.includes('compute')) return `Run one paid job or stake $${capital} of compute credit on ${name}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly recurring action, so the farm stays active between snapshots. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Make one qualifying action each week, such as a fresh supply, a small borrow or a repay.`;
  if (c.includes('dex')) return `Make one swap or one liquidity adjustment each week so the wallet stays active.`;
  if (c.includes('bridge')) return `Bridge a small amount each week, alternating direction when the route allows it.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small position each week, keeping the margin deposited.`;
  if (c.includes('staking') || c.includes('restak')) return `Top up the stake by a small amount each week and claim any rewards the protocol shows.`;
  if (c.includes('prediction')) return `Place one new market position each week and settle the ones that resolved.`;
  return `Make one qualifying action each week, such as a deposit, a swap, a vote or a claim.`;
}

/** The position a farmer holds in a protocol, in the category's own words, for the farm log. */
function positionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'supply position';
  if (c.includes('dex') || c.includes('yield aggregator')) return 'liquidity position';
  if (c.includes('yield') || c.includes('leveraged farm')) return 'vault shares';
  if (c.includes('bridge')) return 'bridged funds';
  if (c.includes('liquid staking') || c.includes('restak')) return 'stake';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'margin position';
  if (c.includes('prediction')) return 'market positions';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'vault shares';
  if (c.includes('stable')) return 'stable asset balance';
  if (c.includes('rwa') || c.includes('real world')) return 'yield-bearing asset';
  if (c.includes('insurance')) return 'cover policy';
  if (c.includes('launchpad')) return 'staked allocation';
  if (c.includes('gaming') || c.includes('gamefi')) return 'in-game assets';
  if (c.includes('nft')) return 'NFT position';
  if (c.includes('privacy')) return 'shielded deposit';
  if (c.includes('ai') || c.includes('compute')) return 'compute credit';
  return 'position';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL): FarmStep[] {
  const chain = chainOf(p);
  const capital = Math.round(capitalFor(p, model));
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction for the ${positionFor(p)} in a farm log so you can repeat it or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
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
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_value_low_usd: row.implied_value_low_usd,
    implied_value_high_usd: row.implied_value_high_usd,
    rank_best: row.rank_best,
    rank_worst: row.rank_worst,
    launch_odds: row.launch_odds,
    expected_value_usd: row.expected_value_usd,
    farm_cost_usd: row.farm_cost_usd,
    net_expected_value_usd: row.net_expected_value_usd,
    deposit_usd: row.deposit_usd,
    farmer_drop_usd: row.farmer_drop_usd,
    farmer_net_usd: row.farmer_net_usd,
    farmer_net_per_hour_usd: row.farmer_net_per_hour_usd,
    farm_verdict: row.farm_verdict,
    farm_hours: row.farm_hours,
    category_multiple: row.model.category_multiple,
    category_n: row.model.category_n,
    category_fallback: row.model.category_fallback,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/**
 * The ledger: every snapshot protocol in exactly one group, in order — ranked on the watchlist,
 * ranked early, live and shown, token trades but not shown, token recorded with no usable cap,
 * then set aside for one stated reason each. A group with no protocols is left out.
 */
export function auditSnapshot(snapshot: Snapshot, board: BoardRow[], live: LiveRow[]): AuditGroup[] {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const liveSlugs = new Set(live.map((r) => r.slug));
  const watchSet = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  const groups: AuditGroup[] = [];
  const count = (label: string, pred: (p: SnapshotProtocol) => boolean): void => {
    let n = 0;
    for (const p of snapshot.protocols) {
      if (!seen.has(p.slug) && pred(p)) {
        seen.add(p.slug);
        n++;
      }
    }
    if (n > 0) groups.push({ label, count: n });
  };
  count('Ranked · watchlist', (p) => boardSlugs.has(p.slug) && watchSet.has(p.slug));
  count('Ranked · early, below the floor', (p) => boardSlugs.has(p.slug) && !watchSet.has(p.slug));
  count('Live token · shown', (p) => liveSlugs.has(p.slug));
  count('Token trades · not shown', (p) => p.mcap_usd !== null && p.mcap_usd > 0);
  count('Token recorded · no usable cap', (p) => (p.mcap_usd === null || p.mcap_usd <= 0) && (p.gecko_id !== null || p.symbol !== null));
  count('Set aside · bridge', (p) => (p.category ?? '') === 'Bridge');
  count('Set aside · liquid staking', (p) => ['Liquid Staking', 'Restaking', 'Liquid Restaking'].includes(p.category ?? ''));
  count('Set aside · exchange', (p) => p.category === 'CEX' || EXCHANGE_PREFIX.test(p.name));
  count('Set aside · versioned or wrapped', (p) => VERSIONED.test(p.name) || /wrapped|staked/i.test(p.name));
  count('Set aside · above the floor, not on the watchlist', (p) => isRankable(p) && p.tvl_usd >= snapshot.floor_usd);
  count('Set aside · other', () => true);
  return groups;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const fit = fitModel(snapshot, model);
  const validation = validateModel(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const fitPool = tradingProtocols(snapshot).filter((p) => inFitPopulation(p, model));
  const globalTvl = median(fitPool.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 1;
  const globalProbe: SnapshotProtocol = {
    slug: '',
    name: '',
    category: null,
    chains: [],
    tvl_usd: globalTvl,
    change_7d: null,
    mcap_usd: null,
    listed_at: null,
    gecko_id: null,
    symbol: null,
  };
  // The board's checksum: the first 8 hex characters of the sha256 of board.json's own bytes,
  // so the dashboard's integrity strip can be checked against the file it claims to show.
  const boardChecksum = createHash('sha256')
    .update(`${JSON.stringify({ rows: board })}\n`)
    .digest('hex')
    .slice(0, 8);
  const trading = tradingProtocols(snapshot)
    .map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }))
    .sort((a, b) => a.tvl_usd - b.tvl_usd);
  const farmCounts = { farm: 0, marginal: 0, skip: 0 };
  let best: BoardRow | null = null;
  for (const r of board) {
    if (r.farm_verdict === 'FARM') farmCounts.farm++;
    else if (r.farm_verdict === 'MARGINAL') farmCounts.marginal++;
    else farmCounts.skip++;
    if (best === null || r.farmer_net_per_hour_usd > best.farmer_net_per_hour_usd) best = r;
  }
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
    global_multiple: round4(fittedMultiple(globalProbe, fit, model)),
    median_change_7d: round4(medianChange7d(snapshot)),
    fit: { intercept: round4(fit.intercept), slope: round4(fit.slope), r2: round4(fit.r2), n_fitted: fit.n, ratio_min: model.fit_ratio_min, ratio_max: model.fit_ratio_max },
    validation,
    multiples: multiplesTable(snapshot, fit, model),
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
    audit: auditSnapshot(snapshot, board, live),
    board_checksum: boardChecksum,
    trading,
    farm_counts: farmCounts,
    best_net_per_hour: best
      ? { name: best.name, slug: best.slug, net_usd: best.farmer_net_usd, net_per_hour_usd: best.farmer_net_per_hour_usd }
      : { name: '', slug: '', net_usd: 0, net_per_hour_usd: 0 },
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.implied_value_low_usd >= 1 && r.implied_value_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_value_high_usd)) {
      return `${r.slug} has a range ${r.implied_value_low_usd}–${r.implied_value_high_usd} that does not contain its implied value ${r.implied_value_usd}`;
    }
    if (!(r.rank_best >= 1 && r.rank_best <= r.rank && r.rank <= r.rank_worst && r.rank_worst <= board.length)) {
      return `${r.slug} has a rank range ${r.rank_best}–${r.rank_worst} that does not contain its rank ${r.rank}`;
    }
    if (r.farm_verdict !== 'FARM' && r.farm_verdict !== 'MARGINAL' && r.farm_verdict !== 'SKIP') return `${r.slug} has verdict ${r.farm_verdict}`;
    if (r.deposit_usd < 100) return `${r.slug} has a deposit of $${r.deposit_usd}`;
    if (Math.abs(r.farmer_net_usd - (r.farmer_drop_usd - r.farm_cost_usd)) > 0.05) return `${r.slug} has a farmer net that is not drop minus cost`;
    if (Math.abs(r.expected_value_usd - Math.round(r.implied_value_usd * r.launch_odds)) > 1) return `${r.slug} has an expected value that is not implied x odds`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
