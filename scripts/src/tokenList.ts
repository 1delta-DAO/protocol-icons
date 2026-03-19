/**
 * Token list resolution.
 *
 * Uses `getDeltaTokenList` from @1delta/initializer-sdk as the primary source.
 * Falls back to the raw GitHub JSON if the SDK call fails.
 */

import { getDeltaTokenList } from '@1delta/initializer-sdk'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenEntry {
  address: string
  symbol: string
  decimals: number
  logoURI?: string
}

/** address (lowercase) → TokenEntry */
export type TokenMap = Record<string, TokenEntry>

// ─── GitHub fallback URL ─────────────────────────────────────────────────────

const GH_TOKEN_LIST_URL = (chainId: string) =>
  `https://raw.githubusercontent.com/1delta-DAO/token-lists/main/${chainId}.json`

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Resolves a token map for the given chain.
 * Keys are lower-cased addresses, values contain at minimum symbol + logoURI.
 */
export async function fetchTokenMap(chainId: string): Promise<TokenMap> {
  // Try SDK first
  try {
    const sdkList = await getDeltaTokenList(Number(chainId))
    if (sdkList && typeof sdkList === 'object' && Object.keys(sdkList).length > 0) {
      return normalizeTokenMap(sdkList)
    }
  } catch {
    // SDK unavailable or returned nothing – fall through
  }

  // Fallback: raw GitHub token list
  try {
    const res = await fetch(GH_TOKEN_LIST_URL(chainId))
    if (!res.ok) return {}
    const json: any = await res.json()
    const list = json.list ?? json
    return normalizeTokenMap(list)
  } catch {
    return {}
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeTokenMap(raw: Record<string, any>): TokenMap {
  const out: TokenMap = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue
    const addr = (val.address ?? key).toLowerCase()
    out[addr] = {
      address: addr,
      symbol: val.symbol ?? '',
      decimals: val.decimals ?? 18,
      logoURI: val.logoURI ?? val.logoUri ?? val.logo ?? undefined,
    }
  }
  return out
}
