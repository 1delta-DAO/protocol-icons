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

import { createPublicClient, fallback, http, type Chain, type Transport } from 'viem'
import {
  arbitrum,
  bsc,
  etherlink,
  hemi,
  lisk,
  mainnet,
  monad,
  optimism,
  plasma,
  somnia,
  sonic,
} from 'viem/chains'
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

/**
 * Label keyword → chain id. Order matters; first match wins.
 * Anything unmatched falls back to Ethereum mainnet.
 * Keep this in sync with the chain set exposed by gearbox-resolvers.json.
 */
const CHAIN_KEYWORD_TO_ID: Array<[string, string]> = [
  ['Arbitrum', '42161'],
  ['Optimism', '10'],
  ['Etherlink', '42793'],
  ['Hyperliquid', '9745'],
  ['HyperEVM', '9745'],
  ['Berachain', '80094'],
  ['Monad', '143'],
  ['Sonic', '146'],
  ['Hemi', '43111'],
  ['Lisk', '1135'],
  ['BNB', '56'],
  ['BSC', '56'],
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

function parseChainKeyword(label: string): string | undefined {
  for (const [kw, id] of CHAIN_KEYWORD_TO_ID) {
    if (label.includes(kw)) return id
  }
  return undefined
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

// ─── Onchain chain-detection probe ───────────────────────────────────────────

/**
 * Allowed chain ids → viem Chain definitions. Only chains present here can be
 * probed onchain; others fall through to label-keyword parsing or the default.
 */
const VIEM_CHAIN_BY_ID: Record<string, Chain> = {
  '1': mainnet,
  '10': optimism,
  '56': bsc,
  '143': monad,
  '146': sonic,
  '1135': lisk,
  '5031': somnia,
  '9745': plasma,
  '42161': arbitrum,
  '42793': etherlink,
  '43111': hemi,
}

/**
 * Public RPC fallbacks per chain. The viem-default RPC for mainnet
 * (eth.merkle.io) rate-limits aggressively, so we layer alternatives in front
 * of it. For each chain the first successful response wins.
 *
 * Override for a given chain via `GEARBOX_RPC_<chainId>` env var, e.g.
 * `GEARBOX_RPC_1="https://eth-mainnet.g.alchemy.com/v2/<key>"`.
 */
const RPC_FALLBACKS: Record<string, string[]> = {
  '1': [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.llamarpc.com',
    'https://cloudflare-eth.com',
  ],
  '10': ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
  '56': ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
  '146': ['https://sonic-rpc.publicnode.com', 'https://rpc.soniclabs.com'],
  '1135': ['https://rpc.api.lisk.com'],
  '9745': ['https://rpc.plasma.to'],
  '42161': ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  '42793': ['https://node.mainnet.etherlink.com'],
  '43111': ['https://rpc.hemi.network/rpc'],
}

const PROBE_TIMEOUT_MS = 8_000

function transportFor(chainId: string): Transport {
  const override = process.env[`GEARBOX_RPC_${chainId}`]
  const urls = [override, ...(RPC_FALLBACKS[chainId] ?? [])].filter(Boolean) as string[]
  // No override + no curated list → fall back to the chain's built-in RPC.
  const transports: Transport[] =
    urls.length > 0
      ? urls.map((u) => http(u, { timeout: PROBE_TIMEOUT_MS, retryCount: 0 }))
      : [http(undefined, { timeout: PROBE_TIMEOUT_MS, retryCount: 0 })]
  return transports.length === 1 ? transports[0] : fallback(transports)
}

/**
 * Probe each allowed chain's RPC for bytecode at `address`.
 * Returns the first chain id that has a non-empty contract deployed, or
 * `undefined` if every probe fails / returns empty.
 */
async function probeAddressChain(
  address: `0x${string}`,
  allowedChains: string[],
): Promise<string | undefined> {
  const viable = allowedChains.filter((id) => VIEM_CHAIN_BY_ID[id])
  if (viable.length === 0) return undefined

  const probes = viable.map(async (chainId) => {
    const chain = VIEM_CHAIN_BY_ID[chainId]
    const client = createPublicClient({ chain, transport: transportFor(chainId) })
    try {
      const code = await client.getCode({ address })
      return code && code !== '0x' ? chainId : undefined
    } catch {
      return undefined
    }
  })

  const results = await Promise.allSettled(probes)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value
  }
  return undefined
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

interface LenderLabels {
  names?: Record<string, string>
  shortNames?: Record<string, string>
}

interface GearboxResolversFile {
  chains?: Record<string, unknown>
  // Older flat shape kept as a fallback: { [chainId]: { ... } }
  [key: string]: unknown
}

export async function fetchGearboxResolverChains(): Promise<string[]> {
  const res = await fetch(GEARBOX_RESOLVERS_URL)
  if (!res.ok) {
    throw new Error(`gearbox resolvers fetch failed: ${res.status} ${res.statusText}`)
  }
  const json = (await res.json()) as GearboxResolversFile
  if (json.chains && typeof json.chains === 'object') {
    return Object.keys(json.chains)
  }
  // Fallback: legacy flat-map shape — only keep numeric chain-id keys.
  return Object.keys(json).filter((k) => /^\d+$/.test(k))
}

interface Candidate {
  enumKey: string
  address: `0x${string}`
  label: string
  symbol: string
  tier?: number
  /** Set when a chain keyword was found in the label. */
  keywordChainId?: string
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

  // Pass 1: parse labels, collect candidates with (known-keyword | needs-probe).
  const seen = new Set<string>()
  const candidates: Candidate[] = []

  for (const [key, label] of Object.entries(names)) {
    if (!key.startsWith(GEARBOX_V3_PREFIX)) continue
    const hex = key.slice(GEARBOX_V3_PREFIX.length)
    if (!/^[0-9A-Fa-f]{40}$/.test(hex)) continue
    if (seen.has(key)) continue
    seen.add(key)

    const symbol = parseSymbol(label)
    if (!symbol) continue

    candidates.push({
      enumKey: key,
      address: ('0x' + hex.toLowerCase()) as `0x${string}`,
      label,
      symbol,
      tier: parseTier(label),
      keywordChainId: parseChainKeyword(label),
    })
  }

  // Pass 2: onchain-probe every candidate that lacks a label-keyword chain.
  // De-dup by address so we only probe once per contract.
  const toProbe = [
    ...new Set(candidates.filter((c) => !c.keywordChainId).map((c) => c.address)),
  ]
  const probedChainByAddress = new Map<string, string>()
  if (toProbe.length > 0) {
    await Promise.all(
      toProbe.map(async (addr) => {
        const chainId = await probeAddressChain(addr, chains)
        if (chainId) probedChainByAddress.set(addr, chainId)
      }),
    )
  }

  // Pass 3: assemble final list using keyword first, probe second.
  const out: GearboxCreditManager[] = []
  for (const c of candidates) {
    const chainId = c.keywordChainId ?? probedChainByAddress.get(c.address)
    if (!chainId || !allowed.has(chainId)) continue
    out.push({
      enumKey: c.enumKey,
      address: c.address,
      chainId,
      label: c.label,
      symbol: c.symbol,
      tier: c.tier,
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
