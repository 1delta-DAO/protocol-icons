/**
 * Morpho Blue market fetcher.
 *
 * Two data sources:
 *   1. Official Morpho Blue GraphQL API  (blue-api.morpho.org)
 *   2. Goldsky subgraph endpoints        (for chains the API doesn't cover)
 *
 * `fetchMarketsForChain` picks the right source automatically and returns
 * a unified `MorphoMarket[]`.
 */

import {
  API_CHAINS,
  MORPHO_SUBGRAPH_URLS,
  chainName,
} from './config.js'
import {
  hasMysticApi,
  fetchMarketsFromMysticApi,
} from './fetchMysticApi.js'
import { hasOnchain, fetchFromOnchain } from './onchainMorpho.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MorphoMarketAsset {
  address: string
  symbol: string
  decimals: number
}

export interface MorphoMarket {
  uniqueKey: string
  lltv: string
  loanAsset: MorphoMarketAsset | null
  collateralAsset: MorphoMarketAsset | null
}

// ─── Morpho Blue API ─────────────────────────────────────────────────────────

const MORPHO_API_URL = 'https://blue-api.morpho.org/graphql'

const apiQuery = (first: number, skip: number, chainId: string) => `
query GetMarkets {
  markets(first: ${first}, skip: ${skip}, where: {
    chainId_in: [${chainId}],
    whitelisted: true
  },
  orderBy: SupplyAssetsUsd,
  orderDirection: Desc
  ) {
    items {
      lltv
      uniqueKey
      loanAsset {
        address
        symbol
        decimals
      }
      collateralAsset {
        address
        symbol
        decimals
      }
    }
  }
}
`

async function fetchFromApi(chainId: string): Promise<MorphoMarket[]> {
  // Ethereum has >200 markets, paginate with two requests
  const isEth = chainId === '1'
  const requests = isEth
    ? [apiQuery(200, 0, chainId), apiQuery(200, 200, chainId)]
    : [apiQuery(500, 0, chainId)]

  const results: MorphoMarket[] = []
  for (const query of requests) {
    const res = await fetch(MORPHO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: {} }),
    })
    if (!res.ok) {
      throw new Error(`Morpho API error (chain ${chainId}): ${res.status} ${res.statusText}`)
    }
    const json: any = await res.json()
    const items = json?.data?.markets?.items ?? []
    results.push(...items)
  }
  return results
}

// ─── Goldsky Subgraph ────────────────────────────────────────────────────────

const SUBGRAPH_MARKETS_QUERY = `
{
  markets(first: 100, skip: 0) {
    id
    inputToken { id }
    borrowedToken { id }
    lltv
  }
}
`

async function fetchFromSubgraph(chainId: string): Promise<MorphoMarket[]> {
  const url = MORPHO_SUBGRAPH_URLS[chainId]
  if (!url) throw new Error(`No subgraph for chain ${chainId}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SUBGRAPH_MARKETS_QUERY, variables: {} }),
  })

  if (!res.ok) {
    throw new Error(`Subgraph error (chain ${chainId}): ${res.status} ${res.statusText}`)
  }

  const json: any = await res.json()
  const raw: any[] = json?.data?.markets ?? []

  return raw.map((m) => ({
    uniqueKey: m.id,
    lltv: m.lltv ?? '0',
    loanAsset: m.borrowedToken?.id
      ? { address: m.borrowedToken.id, symbol: '', decimals: 18 }
      : null,
    collateralAsset: m.inputToken?.id
      ? { address: m.inputToken.id, symbol: '', decimals: 18 }
      : null,
  }))
}

// ─── Unified fetcher ─────────────────────────────────────────────────────────

/**
 * Fetches all whitelisted Morpho Blue markets for a chain.
 * Automatically picks the right data source.
 */
export async function fetchMarketsForChain(chainId: string): Promise<MorphoMarket[]> {
  const hasApi = API_CHAINS.includes(chainId)
  const hasSubgraph = chainId in MORPHO_SUBGRAPH_URLS
  const hasOn = hasOnchain(chainId)
  const hasMystic = hasMysticApi(chainId)

  // Mystic Finance fork has its own API and shape; dispatch first.
  if (hasMystic) {
    try {
      const result = await fetchMarketsFromMysticApi(chainId)
      return (result.markets.items ?? []) as MorphoMarket[]
    } catch (err) {
      console.error(
        `  [${chainName(chainId)}] Mystic API failed:`,
        (err as Error).message,
      )
      return []
    }
  }

  // Try API first
  if (hasApi) {
    try {
      const markets = await fetchFromApi(chainId)
      if (markets.length > 0) return markets
    } catch (err) {
      console.warn(
        `  [${chainName(chainId)}] API failed, trying fallback...`,
        (err as Error).message,
      )
    }
  }

  // Subgraph fallback (preferred when configured)
  if (hasSubgraph) {
    try {
      return await fetchFromSubgraph(chainId)
    } catch (err) {
      console.error(
        `  [${chainName(chainId)}] Subgraph failed:`,
        (err as Error).message,
      )
    }
  } else if (hasOn) {
    // No subgraph → fall back to on-chain log scan.
    try {
      return await fetchFromOnchain(chainId)
    } catch (err) {
      console.error(
        `  [${chainName(chainId)}] On-chain fetch failed:`,
        (err as Error).message,
      )
    }
  }

  if (!hasApi && !hasSubgraph && !hasOn) {
    console.warn(`  [${chainName(chainId)}] No data source configured`)
  }
  return []
}
