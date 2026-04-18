/**
 * Gearbox V3 credit manager metadata fetcher + parser.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/lender-labels.json    – names keyed by GEARBOX_V3_<ADDRESS>
 *   config/gearbox-resolvers.json – supported chains (ethereum / optimism / arbitrum)
 *
 * Each GEARBOX_V3_* key's suffix is the credit-manager (or pool) contract address.
 * The human label contains the quote symbol and — usually — a tier suffix like
 * "Tier 1". We parse both out of the label so we can look up the token logo in
 * the delta token list and stamp a Roman-numeral tier badge on the icon.
 */

import type { TokenEntry, TokenMap } from './tokenList.js'

const LENDER_LABELS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/lender-labels.json'

const GEARBOX_RESOLVERS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/gearbox-resolvers.json'

const GEARBOX_V3_PREFIX = 'GEARBOX_V3_'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GearboxCreditManager {
  /** Original enum key, e.g. GEARBOX_V3_3EB95430FDB99439A86D3C6D7D01C3C561393556 */
  enumKey: string
  /** Credit-manager / pool address, 0x-prefixed, lowercased */
  address: string
  /** Chain id as string, e.g. '1', '10', '42161' */
  chainId: string
  /** Original human label, e.g. "Gearbox Trade WETH Tier 1 Arbitrum" */
  label: string
  /** Parsed quote symbol, e.g. "WETH" */
  symbol: string
  /** Parsed tier number, if present (1/2/3) */
  tier?: number
}

// ─── Chain + symbol parsing ──────────────────────────────────────────────────

/** Label suffix → chain id. Anything else falls back to Ethereum mainnet. */
const CHAIN_KEYWORD_TO_ID: Array<[string, string]> = [
  ['Arbitrum', '42161'],
  ['Optimism', '10'],
  ['Ethereum', '1'],
  ['Mainnet', '1'],
]

/**
 * Symbols we recognise inside Gearbox labels. Order matters – longer / more
 * specific symbols come first so "USDC.e" wins over "USDC", etc.
 */
const KNOWN_SYMBOLS = [
  'USDC.e',
  'wstETH',
  'crvUSD',
  'tBTC',
  'WETH',
  'WBTC',
  'USDT',
  'USDC',
  'DOLA',
  'GHO',
  'DAI',
]

function parseChain(label: string): string {
  for (const [kw, id] of CHAIN_KEYWORD_TO_ID) {
    if (label.includes(kw)) return id
  }
  return '1'
}

function parseTier(label: string): number | undefined {
  const m = label.match(/Tier\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : undefined
}

function parseSymbol(label: string): string | undefined {
  const tokens = label.split(/\s+/)
  for (const sym of KNOWN_SYMBOLS) {
    if (tokens.includes(sym)) return sym
  }
  return undefined
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

interface LenderLabels {
  names?: Record<string, string>
  shortNames?: Record<string, string>
}

export async function fetchGearboxResolverChains(): Promise<string[]> {
  const res = await fetch(GEARBOX_RESOLVERS_URL)
  if (!res.ok) {
    throw new Error(`gearbox resolvers fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as Record<string, unknown>
  return Object.keys(json)
}

export async function fetchGearboxCreditManagers(): Promise<GearboxCreditManager[]> {
  const [labelsRes, chains] = await Promise.all([
    fetch(LENDER_LABELS_URL),
    fetchGearboxResolverChains(),
  ])
  if (!labelsRes.ok) {
    throw new Error(`lender-labels fetch failed: ${labelsRes.status} ${labelsRes.statusText}`)
  }
  const labels = (await labelsRes.json()) as LenderLabels
  const allowed = new Set(chains)
  const names = labels.names ?? {}

  const seen = new Set<string>()
  const out: GearboxCreditManager[] = []

  for (const [key, label] of Object.entries(names)) {
    if (!key.startsWith(GEARBOX_V3_PREFIX)) continue
    const hex = key.slice(GEARBOX_V3_PREFIX.length)
    if (!/^[0-9A-Fa-f]{40}$/.test(hex)) continue
    if (seen.has(key)) continue
    seen.add(key)

    const chainId = parseChain(label)
    if (!allowed.has(chainId)) continue

    const symbol = parseSymbol(label)
    if (!symbol) continue

    out.push({
      enumKey: key,
      address: '0x' + hex.toLowerCase(),
      chainId,
      label,
      symbol,
      tier: parseTier(label),
    })
  }
  return out
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Canonical output filename (no extension), e.g. `gearbox_v3_3eb9...6`. */
export function gearboxEnumName(address: string): string {
  return `gearbox_v3_${address.replace(/^0x/i, '').toLowerCase()}`
}

/** Build a case-insensitive symbol → TokenEntry map from a TokenMap. */
export function tokensBySymbol(tokenMap: TokenMap): Record<string, TokenEntry> {
  const out: Record<string, TokenEntry> = {}
  for (const t of Object.values(tokenMap)) {
    if (!t.symbol) continue
    const k = t.symbol.toLowerCase()
    // First write wins; token lists are usually deduped so this is a no-op.
    if (!out[k]) out[k] = t
  }
  return out
}
