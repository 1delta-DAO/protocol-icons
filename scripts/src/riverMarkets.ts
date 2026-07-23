/**
 * River (Satoshi Protocol) market fetcher.
 *
 * River is a Liquity-style CDP: each chain mints ONE debt token (satUSD)
 * against a set of collateral TroveManagers. Every TroveManager is a market,
 * so an icon needs the collateral logo plus the debt-token logo. Icons follow
 * the same split-half card as Morpho Blue / Liquity (collateral left, debt
 * right) with the River badge overlaid.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/river-markets.json  →  { RIVER: { [chainId]: { markets: RiverMarket[] } } }
 *   config/river.json        →  { RIVER: { [chainId]: { debtToken, … } } }
 *
 * The lender key mirrors margin-fetcher: `RIVER_${chainId}_${index}`.
 */

const RIVER_MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/river-markets.json'

const RIVER_CONFIG_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/river.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RiverMarket {
  /** TroveManager index; part of the lender key. */
  index: number
  troveManager: string
  /** Collateral token address. */
  collToken: string
  collDecimals: number
  /** Display label, e.g. "satUSD / WBTC" (`<debtSymbol> / <collSymbol>`). */
  name?: string
  [key: string]: unknown
}

export interface RiverChainMarkets {
  minNetDebt?: string
  markets: RiverMarket[]
}

export type RiverMarketsByChain = Record<string, RiverChainMarkets>

export interface RiverChainConfig {
  /** Debt/stablecoin token (satUSD). */
  debtToken?: string
  [key: string]: unknown
}

export type RiverConfig = Record<string, RiverChainConfig>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the River markets file (all chains), unwrapped from the RIVER root. */
export async function fetchRiverMarkets(): Promise<RiverMarketsByChain> {
  const res = await fetch(RIVER_MARKETS_URL)
  if (!res.ok) {
    throw new Error(`River markets fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { RIVER?: RiverMarketsByChain }
  return json.RIVER ?? {}
}

/** Fetch the River config (per-chain debt token addresses). */
export async function fetchRiverConfig(): Promise<RiverConfig> {
  const res = await fetch(RIVER_CONFIG_URL)
  if (!res.ok) {
    throw new Error(`River config fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { RIVER?: RiverConfig }
  return json.RIVER ?? {}
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Canonical lender-key filename: `river_${chainId}_${index}`. */
export function riverMarketEnumName(chainId: string, index: number): string {
  return `river_${chainId}_${index}`
}
