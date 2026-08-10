/**
 * Maker-`dss` CDP market fetcher — Sky (the original MakerDAO) and its forks.
 *
 * A dss deployment mints ONE debt token (DAI on Sky, USDD on the fork) against
 * a set of per-collateral ILKS. Every ilk is a market, so an icon needs the
 * collateral logo plus the debt-token logo — the same split-half card as
 * River / Liquity / Inverse, with the brand badge overlaid.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/<brand>-markets.json  →  { <BRAND>: { [chainId]: { markets: DssMarket[] } } }
 *   config/<brand>.json        →  { <BRAND>: { [chainId]: { debtToken | usdd, … } } }
 *
 * Brand-parameterised on purpose: USDD 2.0 IS a Maker fork and lending-sdks
 * serves both through a single shared `dss` provider. USDD's EVM ilk roster is
 * empty today (every user CDP is TRON-only), so only Sky has a generator
 * script — the day governance files an EVM ilk, `generateUsdd.ts` is a copy of
 * `generateSky.ts` with the brand swapped.
 *
 * ── THE KEY FORMAT IS LOAD-BEARING ──────────────────────────────────────────
 * Icons are looked up by the lender key, lower-cased, verbatim (yield-tracer
 * seeds `lender/<lenderKey.toLowerCase()>.webp` for every key in
 * `lender-labels.json`; a miss renders an initials tile, NOT the brand logo).
 * Market keys use `_` as their ONLY separator, so a Maker ilk's own hyphen is
 * re-spelled: `ETH-A` → `SKY_1_ETH_A` → `sky_1_eth_a.webp`. That mirrors
 * `dssLenderKey` in margin-fetcher — keep the two in step or every icon 404s.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Brands served by the shared dss provider. */
export type DssBrand = 'SKY' | 'USDD'

export interface DssMarket {
  /** Maker ilk, e.g. `ETH-A` / `WBTC-C`. Part of the lender key. */
  ilk: string
  /** Collateral token address. */
  collToken: string
  collDecimals?: number
  collSymbol?: string
  /** Display label, e.g. "DAI / WETH" (`<debtSymbol> / <collSymbol>`). */
  name?: string
  /** Debt ceiling is zero — exits only. Still gets an icon (positions exist). */
  offboarded?: boolean
  [key: string]: unknown
}

export interface DssChainMarkets {
  markets: DssMarket[]
  [key: string]: unknown
}

export type DssMarketsByChain = Record<string, DssChainMarkets>

export interface DssChainConfig {
  /** Sky spells the debt leg `debtToken`; USDD's published config says `usdd`. */
  debtToken?: string
  usdd?: string
  debtSymbol?: string
  [key: string]: unknown
}

export type DssConfig = Record<string, DssChainConfig>

// ─── Sources ─────────────────────────────────────────────────────────────────

const RAW_BASE = 'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main'

const marketsUrl = (brand: DssBrand) => `${RAW_BASE}/data/${brand.toLowerCase()}-markets.json`
const configUrl = (brand: DssBrand) => `${RAW_BASE}/config/${brand.toLowerCase()}.json`

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch a dss markets file (all chains), unwrapped from the brand root. */
export async function fetchDssMarkets(brand: DssBrand): Promise<DssMarketsByChain> {
  const res = await fetch(marketsUrl(brand))
  if (!res.ok) {
    throw new Error(`${brand} markets fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as Record<string, DssMarketsByChain | undefined>
  return json[brand] ?? {}
}

/** Fetch a dss config (per-chain debt token addresses). */
export async function fetchDssConfig(brand: DssBrand): Promise<DssConfig> {
  const res = await fetch(configUrl(brand))
  if (!res.ok) {
    throw new Error(`${brand} config fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as Record<string, DssConfig | undefined>
  return json[brand] ?? {}
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/**
 * Canonical icon filename: `sky_1_eth_a` for ilk `ETH-A` on chain 1.
 *
 * The ilk's own `-` becomes `_` because a market key never mixes separators —
 * see the header note. Injective: a Maker ilk never contains `_`.
 */
export function dssMarketEnumName(brand: DssBrand, chainId: string, ilk: string): string {
  return `${brand}_${chainId}_${ilk.replace(/-/g, '_')}`.toLowerCase()
}

/** Debt token of a dss deployment, tolerating both published spellings. */
export function dssDebtToken(cfg?: DssChainConfig): string | undefined {
  return (cfg?.debtToken ?? cfg?.usdd)?.toLowerCase()
}
