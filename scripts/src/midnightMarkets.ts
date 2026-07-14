/**
 * Morpho Midnight market fetcher.
 *
 * Morpho Midnight is a fixed-rate, fixed-maturity order-book protocol — NOT a
 * Morpho Blue fork. Each market has ONE loan token and an ordered list of
 * collateral legs (`collateralParams`), so an icon needs the loan logo plus a
 * *set* of collateral logos (see `generateMidnight.ts` for the sliced layout).
 *
 * Source: 1delta-DAO/lender-metadata GitHub repo.
 *   data/midnight-markets.json   →  { [chainId]: MidnightMarketConfig[] }
 *
 * Mirrors the shape of `MidnightMarketConfig` in @1delta/data-sdk.
 */

const MIDNIGHT_METADATA_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/midnight-markets.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MidnightCollateralParam {
  token: string
  /** WAD-scaled liquidation LTV (as string). */
  lltv: string
  /** WAD-scaled liquidation cursor (as string). */
  liquidationCursor: string
  oracle: string
  decimals: number
}

export interface MidnightMarketConfig {
  /** bytes32 market id (IdLib hash of the Market struct). */
  marketId: string
  loanToken: string
  loanDecimals: number
  /** Ordered collateral legs; index = the on-chain `collateralIndex`. */
  collateralParams: MidnightCollateralParam[]
  /** Maturity, unix seconds (as string). */
  maturity: string
  rcfThreshold: string
  enterGate: string
  liquidatorGate: string
  /** Optional display label, e.g. "cbBTC/USDC - 2026-07-31". */
  name?: string
}

export type MidnightMarketsByChain = Record<string, MidnightMarketConfig[]>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the full Midnight markets file (all chains). */
export async function fetchMidnightMarkets(): Promise<MidnightMarketsByChain> {
  const res = await fetch(MIDNIGHT_METADATA_URL)
  if (!res.ok) {
    throw new Error(
      `Midnight metadata fetch failed: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as MidnightMarketsByChain
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/**
 * Canonical lender-key filename (lower-cased, no `.webp`).
 * Matches `midnightLenderKey` in margin-fetcher lowered:
 *   `MORPHO_MIDNIGHT_<ID>`  →  `morpho_midnight_<id>`
 */
export function midnightMarketEnumName(marketId: string): string {
  return `morpho_midnight_${marketId.replace(/^0x/i, '').toLowerCase()}`
}
