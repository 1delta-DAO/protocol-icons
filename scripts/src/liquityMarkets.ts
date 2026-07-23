/**
 * Liquity V2 (and Liquity-fork) market fetcher.
 *
 * Liquity V2 and its forks are CDP protocols: each deployment mints ONE debt
 * token (its stablecoin — BOLD / USDaf / feUSD / USND / …) against a set of
 * collateral branches. Every branch is its own market, so an icon needs the
 * branch's collateral logo plus the deployment's debt-token logo. Icons follow
 * the same split-half card as Morpho Blue (collateral left, debt right) with a
 * per-protocol badge overlay.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/liquity-markets.json  →  { [protocol]: { [chainId]: LiquityMarket[] } }
 *   config/liquity.json        →  { [protocol]: { [chainId]: { boldToken, … } } }
 *
 * Protocols include LIQUITY_V2 plus forks (USDAF, FELIX, NERITE, QUILL,
 * ENOSYS_LOANS, SONETA, EBISU, …). The lender key mirrors margin-fetcher:
 *   `${protocol}_${chainId}_${collIndex}`  →  e.g. `liquity_v2_1_0`.
 */

const LIQUITY_MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/liquity-markets.json'

const LIQUITY_CONFIG_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/liquity.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LiquityMarket {
  /** Branch index; part of the lender key. */
  collIndex: number
  /** Collateral token address (the branch's collateral). */
  collToken: string
  troveManager: string
  collDecimals: number
  /** Display label, e.g. "BOLD / WETH" (`<debtSymbol> / <collSymbol>`). */
  name?: string
  [key: string]: unknown
}

export type LiquityMarketsByChain = Record<string, LiquityMarket[]>
export type LiquityMarketsByProtocol = Record<string, LiquityMarketsByChain>

export interface LiquityChainConfig {
  /** Deployment debt/stablecoin token (BOLD-equivalent). */
  boldToken?: string
  [key: string]: unknown
}

export type LiquityConfig = Record<string, Record<string, LiquityChainConfig>>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the full Liquity markets file (all protocols, all chains). */
export async function fetchLiquityMarkets(): Promise<LiquityMarketsByProtocol> {
  const res = await fetch(LIQUITY_MARKETS_URL)
  if (!res.ok) {
    throw new Error(`Liquity markets fetch failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as LiquityMarketsByProtocol
}

/** Fetch the Liquity config (per-protocol / per-chain debt token addresses). */
export async function fetchLiquityConfig(): Promise<LiquityConfig> {
  const res = await fetch(LIQUITY_CONFIG_URL)
  if (!res.ok) {
    throw new Error(`Liquity config fetch failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as LiquityConfig
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Canonical lender-key filename: `${protocol}_${chainId}_${collIndex}` lowercased. */
export function liquityMarketEnumName(protocol: string, chainId: string, index: number): string {
  return `${protocol}_${chainId}_${index}`.toLowerCase()
}

/** Local protocol badge basename (lender/<protocol>.webp), e.g. `liquity_v2`. */
export function liquityBadgeName(protocol: string): string {
  return protocol.toLowerCase()
}
