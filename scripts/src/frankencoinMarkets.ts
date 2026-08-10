/**
 * Frankencoin (ZCHF) market fetcher.
 *
 * Frankencoin has no pools: borrowing happens in per-position CONTRACTS cloned
 * permissionlessly from an "original" position. lending-sdks models the
 * ORIGINAL as the market and each clone as a sub-account, so the curated
 * roster in lender-metadata is a list of original positions — one icon each.
 *
 * Every position mints the same debt token (ZCHF) against a single collateral,
 * so the card is the usual split half: collateral left, ZCHF right, brand badge
 * overlaid.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/frankencoin-markets.json → { FRANKENCOIN: { [chainId]: { markets: [...] } } }
 *   config/frankencoin.json       → { FRANKENCOIN: { [chainId]: { zchf, … } } }
 *
 * ── THE KEY FORMAT IS LOAD-BEARING ──────────────────────────────────────────
 * Icons are looked up by the lender key, lower-cased, verbatim (yield-tracer
 * seeds `lender/<lenderKey.toLowerCase()>.webp` for every key in
 * `lender-labels.json`; a miss renders an initials tile, NOT the brand logo).
 * The key is `FRANKENCOIN_<chainId>_<ORIGINAL_ADDR>` with the address
 * UN-PREFIXED and upper-cased, so the file is
 * `frankencoin_1_194e0d684f1cc6d93843fead521f3d54a5879f4e.webp`.
 *
 * NOTE the roster is CURATED, not exhaustive: ~40 % of the live book is
 * unpriceable RWA/equity collateral that lending-sdks deliberately excludes.
 * Only the allowlisted originals appear here, which is exactly the set that
 * needs art.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FrankencoinMarket {
  /** Original position contract — part of the lender key. */
  position: string
  /** Collateral token address. */
  collToken: string
  collDecimals?: number
  collSymbol?: string
  /** Display label, e.g. "ZCHF / WBTC". */
  name?: string
  /** MintingHub generation (1 or 2). */
  version?: number
  [key: string]: unknown
}

export interface FrankencoinChainMarkets {
  markets: FrankencoinMarket[]
  [key: string]: unknown
}

export type FrankencoinMarketsByChain = Record<string, FrankencoinChainMarkets>

export interface FrankencoinChainConfig {
  /** The debt/stablecoin token (ZCHF). */
  zchf?: string
  [key: string]: unknown
}

export type FrankencoinConfig = Record<string, FrankencoinChainConfig>

// ─── Sources ─────────────────────────────────────────────────────────────────

const RAW_BASE = 'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main'

const FRANKENCOIN_MARKETS_URL = `${RAW_BASE}/data/frankencoin-markets.json`
const FRANKENCOIN_CONFIG_URL = `${RAW_BASE}/config/frankencoin.json`

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the Frankencoin markets file, unwrapped from the FRANKENCOIN root. */
export async function fetchFrankencoinMarkets(): Promise<FrankencoinMarketsByChain> {
  const res = await fetch(FRANKENCOIN_MARKETS_URL)
  if (!res.ok) {
    throw new Error(`Frankencoin markets fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { FRANKENCOIN?: FrankencoinMarketsByChain }
  return json.FRANKENCOIN ?? {}
}

/** Fetch the Frankencoin config (per-chain ZCHF address). */
export async function fetchFrankencoinConfig(): Promise<FrankencoinConfig> {
  const res = await fetch(FRANKENCOIN_CONFIG_URL)
  if (!res.ok) {
    throw new Error(`Frankencoin config fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { FRANKENCOIN?: FrankencoinConfig }
  return json.FRANKENCOIN ?? {}
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/**
 * Canonical icon filename: `frankencoin_<chainId>_<addr-without-0x>`, all
 * lower-case. Mirrors the market key built in margin-fetcher.
 */
export function frankencoinMarketEnumName(chainId: string, position: string): string {
  return `frankencoin_${chainId}_${position.replace(/^0x/i, '')}`.toLowerCase()
}
