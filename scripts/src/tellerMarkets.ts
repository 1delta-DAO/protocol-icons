/**
 * Teller pool fetcher.
 *
 * Teller V2 is a fixed-term, fixed-APR pool lender. Each `LenderCommitmentGroup`
 * pool borrows ONE principal token (the debt asset, e.g. USDC / WETH) against a
 * single collateral. Icons place the collateral logo on the left half and the
 * principal (debt) asset on the right, with the Teller badge overlay (same
 * layout as the Term Finance / River / Liquity generators).
 *
 * Source: 1delta-DAO/lender-metadata → data/teller-pools.json
 *   { [chainId]: TellerPool[] }
 *
 * The lender key follows the margin-fetcher convention `TELLER_<POOL_ADDR>`, so
 * the icon filename is `teller_${pool}` (0x-stripped, lower-cased).
 */

const TELLER_POOLS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/teller-pools.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TellerPool {
  /** LenderCommitmentGroup pool address — the lender-key body. */
  pool: string
  /** Principal (loan / debt) token borrowed against the collateral. */
  principal: string
  principalSymbol?: string
  principalDecimals?: number
  /** Collateral token. */
  collateral: string
  collateralSymbol?: string
  collateralDecimals?: number
  name?: string
  [key: string]: unknown
}

export type TellerPoolsByChain = Record<string, TellerPool[]>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the full Teller pools file (all chains). */
export async function fetchTellerPools(): Promise<TellerPoolsByChain> {
  const res = await fetch(TELLER_POOLS_URL)
  if (!res.ok) {
    throw new Error(
      `Teller pools fetch failed: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as TellerPoolsByChain
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Canonical lender-key filename: `teller_${pool}` (0x-stripped, lower-cased). */
export function tellerEnumName(pool: string): string {
  return `teller_${pool.replace(/^0x/i, '').toLowerCase()}`
}
