/**
 * Term Finance market fetcher.
 *
 * Term Finance is a fixed-rate, fixed-maturity repo protocol. Each market
 * borrows ONE purchase token (the debt asset, e.g. USDC / WETH) against a
 * single collateral. Icons place the collateral logo in the center with the
 * debt asset shown as a top-right token badge (see `generateTermFinance.ts`).
 *
 * Source: 1delta-DAO/lender-metadata → data/term-finance-markets.json
 *   { [chainId]: TermMarket[] }
 *
 * There is no established margin-fetcher label for Term Finance yet, so the
 * lender key follows the hash-keyed Midnight convention:
 *   `term_finance_${termRepoId}`  (0x-stripped, lower-cased).
 */

const TERM_FINANCE_MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/term-finance-markets.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TermCollateralParam {
  token: string
  maintenanceRatio: string
  decimals: number
  liquidatedDamages: string
}

export interface TermMarket {
  /** bytes32 repo id; part of the lender key. */
  termRepoId: string
  /** Debt / loan asset borrowed against the collateral. */
  purchaseToken: string
  loanDecimals: number
  /** Collateral legs — Term markets in practice carry exactly one. */
  collateralParams: TermCollateralParam[]
  maturity: string
  /** Display label, e.g. "USDC / cbBTC — 2026-07-22". */
  name?: string
  [key: string]: unknown
}

export type TermMarketsByChain = Record<string, TermMarket[]>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the full Term Finance markets file (all chains). */
export async function fetchTermFinanceMarkets(): Promise<TermMarketsByChain> {
  const res = await fetch(TERM_FINANCE_MARKETS_URL)
  if (!res.ok) {
    throw new Error(`Term Finance markets fetch failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as TermMarketsByChain
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Canonical lender-key filename: `term_finance_${termRepoId}` (0x-stripped). */
export function termFinanceEnumName(termRepoId: string): string {
  return `term_finance_${termRepoId.replace(/^0x/i, '').toLowerCase()}`
}
