/**
 * Inverse Finance (FiRM) market fetcher.
 *
 * FiRM is a CDP: every market is a per-collateral `Market` contract that mints
 * ONE debt token (DOLA). So an icon needs the collateral logo plus DOLA, the
 * same split-half card as River / Liquity (collateral left, debt right) with
 * the Inverse badge overlaid.
 *
 * Sources (1delta-DAO/lender-metadata):
 *   data/inverse-markets.json  →  { INVERSE: { [chainId]: { markets: [...] } } }
 *   config/inverse.json        →  { INVERSE: { [chainId]: { dola, … } } }
 *
 * The lender key mirrors margin-fetcher: `INVERSE_${MARKET_ADDR_HEX_UPPER}`,
 * so the icon filename is `inverse_${marketAddrLower}`.
 *
 * Several FiRM collaterals are Curve LPs (sUSDe-DOLA, sUSDS-DOLA,
 * scrvUSD-sDOLA) or Yearn wrappers over them (yv-sUSDe-DOLA, yv-sUSDS-DOLA),
 * which carry no logo in the delta token list. `resolveCollateralArt` therefore
 * layers three sources: token list → SmolDapp tokenAssets CDN → on-chain leg
 * decomposition (`coins(i)`, unwrapping `token()`/`asset()` first), the last of
 * which renders the collateral half as one column per leg. Unwrapping always
 * descends to the pool's coins rather than reusing the underlying LP's own
 * logo, so a `yv-` market never renders identically to its bare LP market.
 */

import { createPublicClient, fallback, http, type PublicClient, type Transport } from 'viem'
import { mainnet } from 'viem/chains'
import type { TokenMap } from './tokenList.js'

const INVERSE_MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/inverse-markets.json'

const INVERSE_CONFIG_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/inverse.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InverseMarket {
  /** The `Market` contract; part of the lender key. */
  address: string
  /** Collateral token address. */
  collToken: string
  collDecimals: number
  /** Display label, e.g. "wstETH" (collateral symbol). */
  name?: string
  borrowPaused?: boolean
  [key: string]: unknown
}

export interface InverseChainMarkets {
  markets: InverseMarket[]
}

export type InverseMarketsByChain = Record<string, InverseChainMarkets>

export interface InverseChainConfig {
  /** Debt token (DOLA). */
  dola?: string
  [key: string]: unknown
}

export type InverseConfig = Record<string, InverseChainConfig>

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Fetch the Inverse markets file (all chains), unwrapped from the INVERSE root. */
export async function fetchInverseMarkets(): Promise<InverseMarketsByChain> {
  const res = await fetch(INVERSE_MARKETS_URL)
  if (!res.ok) {
    throw new Error(`Inverse markets fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { INVERSE?: InverseMarketsByChain }
  return json.INVERSE ?? {}
}

/** Fetch the Inverse config (per-chain DOLA address). */
export async function fetchInverseConfig(): Promise<InverseConfig> {
  const res = await fetch(INVERSE_CONFIG_URL)
  if (!res.ok) {
    throw new Error(`Inverse config fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as { INVERSE?: InverseConfig }
  return json.INVERSE ?? {}
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Canonical lender-key filename: `inverse_${marketAddressLower}` (no 0x). */
export function inverseMarketEnumName(marketAddress: string): string {
  return `inverse_${marketAddress.toLowerCase().replace(/^0x/, '')}`
}

// ─── RPC ─────────────────────────────────────────────────────────────────────

/**
 * Public RPC fallbacks per chain; override with `INVERSE_RPC_<chainId>`.
 * FiRM is Ethereum-only today — the map is keyed anyway so a second
 * deployment needs no code change beyond an entry here.
 */
const RPC_FALLBACKS: Record<string, string[]> = {
  '1': [
    'https://ethereum-rpc.publicnode.com',
    'https://cloudflare-eth.com',
    'https://rpc.flashbots.net',
  ],
}

const RPC_TIMEOUT_MS = 10_000

function transportFor(chainId: string): Transport {
  const override = process.env[`INVERSE_RPC_${chainId}`]
  const urls = [override, ...(RPC_FALLBACKS[chainId] ?? [])].filter(Boolean) as string[]
  const transports: Transport[] =
    urls.length > 0
      ? urls.map((u) => http(u, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }))
      : [http(undefined, { timeout: RPC_TIMEOUT_MS, retryCount: 1 })]
  return transports.length === 1 ? transports[0] : fallback(transports)
}

const clientCache = new Map<string, PublicClient>()

function clientFor(chainId: string): PublicClient | null {
  // Only Ethereum carries a viem chain here; other chains would need a
  // `defineChain` entry before their collaterals can be decomposed on-chain.
  if (chainId !== '1') return null
  const cached = clientCache.get(chainId)
  if (cached) return cached
  const client = createPublicClient({
    chain: mainnet,
    transport: transportFor(chainId),
  }) as PublicClient
  clientCache.set(chainId, client)
  return client
}

// ─── Logo fallback CDN ───────────────────────────────────────────────────────

/**
 * SmolDapp tokenAssets — carries the Curve LP logos the delta token list has no
 * entry for. Returns the URL only when it actually resolves to an image.
 */
const SMOL_LOGO_URL = (chainId: string, address: string) =>
  `https://assets.smold.app/api/token/${chainId}/${address.toLowerCase()}/logo-128.png`

const cdnCache = new Map<string, string | null>()

async function cdnLogo(chainId: string, address: string): Promise<string | null> {
  const key = `${chainId}:${address.toLowerCase()}`
  const cached = cdnCache.get(key)
  if (cached !== undefined) return cached

  const url = SMOL_LOGO_URL(chainId, address)
  let resolved: string | null = null
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) {
      resolved = url
    }
  } catch {
    // network hiccup — treat as "no logo", the caller falls through to legs
  }
  cdnCache.set(key, resolved)
  return resolved
}

// ─── On-chain leg decomposition ──────────────────────────────────────────────

const COINS_ABI = [
  {
    name: 'coins',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'i', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

const UNWRAP_ABI = [
  { name: 'token', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'asset', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const

const MAX_LEGS = 4

/** Curve-style `coins(i)` enumeration; `[]` when the token is not a pool. */
async function poolCoins(client: PublicClient, token: string): Promise<string[]> {
  const legs: string[] = []
  for (let i = 0; i < MAX_LEGS; i++) {
    try {
      const coin = (await client.readContract({
        address: token as `0x${string}`,
        abi: COINS_ABI,
        functionName: 'coins',
        args: [BigInt(i)],
      })) as string
      if (!coin || /^0x0{40}$/i.test(coin.slice(2))) break
      legs.push(coin.toLowerCase())
    } catch {
      break
    }
  }
  return legs
}

/** ERC-4626 / Yearn-style wrapper unwrap; `null` when the token wraps nothing. */
async function unwrap(client: PublicClient, token: string): Promise<string | null> {
  for (const fn of ['token', 'asset'] as const) {
    try {
      const under = (await client.readContract({
        address: token as `0x${string}`,
        abi: UNWRAP_ABI,
        functionName: fn,
      })) as string
      if (under && !/^0x0{40}$/i.test(under.slice(2))) return under.toLowerCase()
    } catch {
      // not this interface — try the next one
    }
  }
  return null
}

const legsCache = new Map<string, string[]>()

/**
 * Decompose a collateral into the underlying assets worth drawing: the pool's
 * coins, unwrapping wrappers first. Returns `[]` when nothing decomposes.
 */
export async function collateralLegs(chainId: string, token: string): Promise<string[]> {
  const key = `${chainId}:${token.toLowerCase()}`
  const cached = legsCache.get(key)
  if (cached) return cached

  const client = clientFor(chainId)
  if (!client) return []

  let current = token.toLowerCase()
  let legs: string[] = []
  // At most two unwraps: yv-<LP> → <LP> → coins.
  for (let depth = 0; depth < 3; depth++) {
    legs = await poolCoins(client, current)
    if (legs.length > 0) break
    const under = await unwrap(client, current)
    if (!under || under === current) break
    current = under
  }

  legsCache.set(key, legs)
  return legs
}

// ─── Collateral artwork resolution ───────────────────────────────────────────

export interface CollateralArt {
  /** One source per column of the collateral (left) half; never empty. */
  sources: string[]
  /** How the artwork was resolved — logged for auditability. */
  via: 'token-list' | 'cdn' | 'legs'
}

/** Token list → CDN, for a single address. */
async function singleLogo(
  chainId: string,
  address: string,
  tokenMap: TokenMap,
): Promise<{ url: string; via: 'token-list' | 'cdn' } | null> {
  const listed = tokenMap[address.toLowerCase()]?.logoURI
  if (listed) return { url: listed, via: 'token-list' }
  const cdn = await cdnLogo(chainId, address)
  return cdn ? { url: cdn, via: 'cdn' } : null
}

/**
 * Resolve the artwork for a market's collateral half, or `null` when no source
 * covers it (the caller then skips the market rather than drawing a blank).
 */
export async function resolveCollateralArt(
  chainId: string,
  collateral: string,
  tokenMap: TokenMap,
): Promise<CollateralArt | null> {
  const direct = await singleLogo(chainId, collateral, tokenMap)
  if (direct) return { sources: [direct.url], via: direct.via }

  const legs = await collateralLegs(chainId, collateral)
  if (legs.length === 0) return null

  const resolved = await Promise.all(legs.map((leg) => singleLogo(chainId, leg, tokenMap)))
  if (resolved.some((r) => !r)) return null

  return { sources: resolved.map((r) => r!.url), via: 'legs' }
}
