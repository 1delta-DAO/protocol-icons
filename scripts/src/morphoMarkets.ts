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

// Page size for market pagination. 1000 is the API's max `first`; its
// per-request complexity (~165k) stays well under the 1M ceiling.
const API_PAGE_SIZE = 1000
// Safety backstop against a runaway pagination loop (1000 pages = 1M markets).
const API_MAX_PAGES = 1000

// NOTE: no `listed`/`whitelisted` filter — we want EVERY permissionless market.
// Order by `UniqueKey` (a stable id present on every market) so skip-based
// pagination is consistent AND doesn't drop idle markets the way ordering by a
// numeric metric (e.g. SupplyAssetsUsd) does.
const apiQuery = (first: number, skip: number, chainId: string) => `
query GetMarkets {
  markets(first: ${first}, skip: ${skip}, where: {
    chainId_in: [${chainId}]
  },
  orderBy: UniqueKey,
  orderDirection: Asc
  ) {
    items {
      lltv
      uniqueKey: marketId
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
    pageInfo {
      count
      countTotal
    }
  }
}
`

async function fetchFromApi(chainId: string): Promise<MorphoMarket[]> {
  const results: MorphoMarket[] = []

  // Paginate until every market is fetched. `countTotal` tells us the full set;
  // a short (or empty) page is the natural terminator past the last one.
  for (let page = 0; page < API_MAX_PAGES; page++) {
    const res = await fetch(MORPHO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: apiQuery(API_PAGE_SIZE, page * API_PAGE_SIZE, chainId),
        variables: {},
      }),
    })
    if (!res.ok) {
      throw new Error(`Morpho API error (chain ${chainId}): ${res.status} ${res.statusText}`)
    }
    const json: any = await res.json()
    // Surface GraphQL validation errors loudly (a 200 can still carry errors);
    // otherwise a silent schema change reads as "0 markets" with no explanation.
    if (json?.errors?.length) {
      throw new Error(`Morpho API error (chain ${chainId}): ${json.errors[0].message}`)
    }

    const marketsPage = json?.data?.markets
    const items: MorphoMarket[] = marketsPage?.items ?? []
    results.push(...items)

    const countTotal: number = marketsPage?.pageInfo?.countTotal ?? results.length
    if (items.length < API_PAGE_SIZE || results.length >= countTotal) break
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
