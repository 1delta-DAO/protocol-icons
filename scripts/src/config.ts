/**
 * Chain IDs and Morpho Blue subgraph endpoints.
 *
 * Chains fall into two buckets:
 *   1. API-supported  – served by the official Morpho Blue GraphQL API
 *   2. Subgraph-only  – served by Goldsky (or other) subgraphs
 *
 * The generator tries the API first, then falls back to the subgraph,
 * so every chain listed here will be attempted.
 */

// ─── Chain IDs ───────────────────────────────────────────────────────────────

export const ChainId = {
  ETHEREUM: '1',
  OPTIMISM: '10',
  BNB: '56',
  POLYGON: '137',
  BASE: '8453',
  ARBITRUM: '42161',
  AVALANCHE: '43114',
  UNICHAIN: '130',
  MANTLE: '5000',
  SCROLL: '534352',
  LINEA: '59144',
  GNOSIS: '100',
  WORLDCHAIN: '480',
  INK: '57073',
  CORN: '21000000',
  // Subgraph-only chains
  SEI: '1329',
  CELO: '42220',
  LISK: '1135',
  SONEIUM: '1868',
  TAC: '2390',
  HEMI: '43111',
  BERACHAIN: '80094',
  KATANA: '824',
  HYPEREVM: '999',
} as const

export type ChainIdValue = (typeof ChainId)[keyof typeof ChainId]

// ─── Subgraph URLs ───────────────────────────────────────────────────────────

export const MORPHO_SUBGRAPH_URLS: Record<string, string> = {
  [ChainId.SEI]:
    'https://api.goldsky.com/api/public/project_cmiergfbv4vma01vb642yaeam/subgraphs/morphoblue-sei/1.0.1/gn',
  [ChainId.CELO]:
    'https://api.goldsky.com/api/public/project_cmiergfbv4vma01vb642yaeam/subgraphs/morphoblue-celo/1.0.4/gn',
  [ChainId.LISK]:
    'https://api.goldsky.com/api/public/project_cmiergfbv4vma01vb642yaeam/subgraphs/morphobluelisk/1.0.1/gn',
  [ChainId.SONEIUM]:
    'https://api.goldsky.com/api/public/project_cmiergfbv4vma01vb642yaeam/subgraphs/morphobluesoneium/1.0.2/gn',
  [ChainId.TAC]:
    'https://api.goldsky.com/api/public/project_cmiergfbv4vma01vb642yaeam/subgraphs/morphoblue-tac/1.0.0/gn',
  [ChainId.HEMI]:
    'https://feather.securesecrets.org/hemi-mopho-blue/',
}

// ─── Chains to process ───────────────────────────────────────────────────────

/** Chains served by the official Morpho Blue GraphQL API */
export const API_CHAINS: string[] = [
  ChainId.ETHEREUM,
  ChainId.BASE,
  ChainId.ARBITRUM,
  ChainId.OPTIMISM,
  ChainId.UNICHAIN,
  ChainId.POLYGON,
  ChainId.SCROLL,
  ChainId.LINEA,
  ChainId.GNOSIS,
  ChainId.WORLDCHAIN,
  ChainId.INK,
  ChainId.CORN,
  ChainId.MANTLE,
  ChainId.BNB,
  ChainId.AVALANCHE,
]

/** Chains served by subgraph only */
export const SUBGRAPH_CHAINS: string[] = Object.keys(MORPHO_SUBGRAPH_URLS)

/** All chains we attempt to generate icons for */
export const ALL_CHAINS: string[] = [
  ...API_CHAINS,
  ...SUBGRAPH_CHAINS.filter((c) => !API_CHAINS.includes(c)),
]

// ─── Human-readable chain names (for logging) ───────────────────────────────

export const CHAIN_NAMES: Record<string, string> = {
  [ChainId.ETHEREUM]: 'Ethereum',
  [ChainId.OPTIMISM]: 'Optimism',
  [ChainId.BNB]: 'BNB Chain',
  [ChainId.POLYGON]: 'Polygon',
  [ChainId.BASE]: 'Base',
  [ChainId.ARBITRUM]: 'Arbitrum',
  [ChainId.AVALANCHE]: 'Avalanche',
  [ChainId.UNICHAIN]: 'Unichain',
  [ChainId.MANTLE]: 'Mantle',
  [ChainId.SCROLL]: 'Scroll',
  [ChainId.LINEA]: 'Linea',
  [ChainId.GNOSIS]: 'Gnosis',
  [ChainId.WORLDCHAIN]: 'Worldchain',
  [ChainId.INK]: 'Ink',
  [ChainId.CORN]: 'Corn',
  [ChainId.SEI]: 'Sei',
  [ChainId.CELO]: 'Celo',
  [ChainId.LISK]: 'Lisk',
  [ChainId.SONEIUM]: 'Soneium',
  [ChainId.TAC]: 'TAC',
  [ChainId.HEMI]: 'Hemi',
  [ChainId.BERACHAIN]: 'Berachain',
  [ChainId.KATANA]: 'Katana',
  [ChainId.HYPEREVM]: 'HyperEVM',
}

export const chainName = (id: string) => CHAIN_NAMES[id] ?? `Chain(${id})`

// ─── Icon defaults ───────────────────────────────────────────────────────────

export const ICON_DEFAULTS = {
  diameter: 150,
  badgeSize: { width: 50, height: 50 },
  badgePadding: 10,
  badgeOffsetX: 0,
  badgeOffsetY: -15,
  centerPadding: 15,
} as const

export const MORPHO_BADGE_URL =
  'https://raw.githubusercontent.com/1delta-DAO/protocol-icons/main/lender/morpho_blue.webp'

import path from 'path'

/** Local Silo badge — used as the protocol overlay for v2/v3 market icons. */
export const SILO_BADGE_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '../../lender/silo.webp',
)

// ─── Cycle interval (default 30 min) ─────────────────────────────────────────

export const DEFAULT_CYCLE_INTERVAL_MS = 30 * 60 * 1000
