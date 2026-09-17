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
  // TAC is 239 — the earlier '2390' was wrong and so its subgraph was never
  // queried (2026-09-16).
  TAC: '239',
  HEMI: '43111',
  BERACHAIN: '80094',
  // Katana is 747474 — the earlier '824' was wrong and returned 0 markets from
  // the API on every run (2026-09-16).
  KATANA: '747474',
  HYPEREVM: '999',
  ABSTRACT: '2741',
  // blue-api chains added 2026-09-16 (its `{ chains }` roster).
  STABLE: '988',
  TEMPO: '4217',
  ROBINHOOD: '4663',
  ARC: '5042',
  // Morpho chain with neither API nor subgraph — markets come from the
  // `CreateMarket` log replay in `onchainMorpho.ts`.
  XDC: '50',
  // Curvance (Monad-only, not a Morpho fork — listed here for chainName/token-list
  // resolution used by the Curvance generator)
  MONAD: '143',
  // Mystic Finance (Morpho Blue fork) chains
  FLARE: '14',
  CITREA: '4114',
  PLUME: '98866',
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
  ChainId.BERACHAIN,
  ChainId.KATANA,
  ChainId.HYPEREVM,
  ChainId.ABSTRACT,
  // Checked against blue-api's own `{ chains { id } }` on 2026-09-16, which
  // lists exactly: 1, 10, 130, 137, 143, 480, 988, 999, 4217, 4663, 5042,
  // 8453, 42161, 747474. Chains above that the API no longer indexes simply
  // fall through to their subgraph / on-chain source.
  ChainId.MONAD,
  ChainId.STABLE,
  ChainId.TEMPO,
  ChainId.ROBINHOOD,
  ChainId.ARC,
]

/** Chains served by subgraph only */
export const SUBGRAPH_CHAINS: string[] = Object.keys(MORPHO_SUBGRAPH_URLS)

/**
 * Chains served only by the on-chain log replay (`onchainMorpho.ts`): not in
 * the API roster and no subgraph, so they'd never enter ALL_CHAINS otherwise.
 */
export const ONCHAIN_ONLY_CHAINS: string[] = [ChainId.XDC]

/** Chains served by the Mystic Finance Morpho-fork API */
export const MYSTIC_CHAINS: string[] = [
  ChainId.FLARE,
  ChainId.CITREA,
  ChainId.PLUME,
]

/** All chains we attempt to generate icons for */
export const ALL_CHAINS: string[] = [
  ...API_CHAINS,
  ...SUBGRAPH_CHAINS.filter((c) => !API_CHAINS.includes(c)),
  ...ONCHAIN_ONLY_CHAINS.filter(
    (c) => !API_CHAINS.includes(c) && !SUBGRAPH_CHAINS.includes(c),
  ),
  ...MYSTIC_CHAINS.filter(
    (c) => !API_CHAINS.includes(c) && !SUBGRAPH_CHAINS.includes(c),
  ),
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
  [ChainId.ABSTRACT]: 'Abstract',
  [ChainId.XDC]: 'XDC',
  [ChainId.MONAD]: 'Monad',
  [ChainId.STABLE]: 'Stable',
  [ChainId.TEMPO]: 'Tempo',
  [ChainId.ROBINHOOD]: 'Robinhood',
  [ChainId.ARC]: 'Arc',
  [ChainId.FLARE]: 'Flare',
  [ChainId.CITREA]: 'Citrea',
  [ChainId.PLUME]: 'Plume',
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

/** Local Fluid badge — used as the protocol overlay for Fluid vault icons. */
export const FLUID_BADGE_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '../../lender/fluid.webp',
)

/** Local Gearbox core icon — used as the LEFT half for Gearbox v3 market icons. */
export const GEARBOX_CORE_ICON_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '../../lender/gearbox_v3.webp',
)

/** Local Aave v4 badge — used as the protocol overlay for spoke icons. */
export const AAVE_V4_BADGE_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '../../lender/aave_v4.webp',
)

/**
 * Published Aave v4 spoke roster (1delta lender-metadata).
 *
 * chainId → spoke address → { label, reserves[] }. This is the same file the
 * app reads, so icon names stay in lockstep with the lender keys it emits.
 */
export const AAVE_V4_SPOKES_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/aave-v4-spokes.json'

/**
 * Local white Morpho glyph — rendered onto a dark circle to form the
 * black-and-white "Midnight" protocol badge (see `morphoMidnightBadgeBuffer`).
 */
export const MORPHO_W_SVG_PATH = path.resolve(
  import.meta.dirname ?? '.',
  '../../lender/morpho_w.svg',
)

// ─── Cycle interval (default 30 min) ─────────────────────────────────────────

export const DEFAULT_CYCLE_INTERVAL_MS = 30 * 60 * 1000
