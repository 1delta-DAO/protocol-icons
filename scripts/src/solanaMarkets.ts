/**
 * Solana lending roster.
 *
 * Every Solana family fans out to per-market lender keys whose suffix is
 * BASE58 and case-significant:
 *
 *   KAMINO_<marketPubkey>                 pooled market (Aave-shaped)
 *   SAVE_<lendingMarketPubkey>            pooled market (Aave-shaped)
 *   PROJECT_0_<groupPubkey>               pooled group  (Aave-shaped)
 *   JUPITER_LEND_<market>_<vaultId>       collateral / debt vault (Fluid)
 *   LOOPSCALE_<principal>_<collateral>    collateral / principal pair (Midnight)
 *
 * The roster comes from `@1delta/margin-fetcher-sol` — the same fetch
 * yield-tracer's Solana lending job and lender-metadata's
 * `update-solana-labels` run — so icon names stay in lockstep with the keys
 * the API emits. The app resolves `lender/<lenderKey.toLowerCase()>.webp`, so
 * the icon stem is the WHOLE key lower-cased, base58 suffix included.
 *
 * Asset art rides on the rows themselves (`row.asset.logoURI`, filled from the
 * 1delta Solana token list); mints the list does not carry fall back to
 * Jupiter's token search.
 */

import {
  SVM_LENDERS,
  describeBasket,
  getLenderPublicDataAll,
  lenderBrandKey,
} from '@1delta/margin-fetcher-sol'

const TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/1delta-DAO/token-lists/main/solana.json'

const JUPITER_SEARCH_URL = (mint: string) =>
  `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SolanaAsset {
  mint: string
  symbol: string
  logoURI?: string
  totalDepositsUSD: number
}

export interface SolanaMarket {
  /** Verbatim lender key, e.g. `KAMINO_7u3HeHxY…`. */
  lenderKey: string
  /** Family: KAMINO | JUPITER_LEND | SAVE | LOOPSCALE | PROJECT_0. */
  brand: string
  /** Basket display name, e.g. `SOL/BTC Market`, `JLP / USDC`. */
  name: string
  /** Every row in the basket, in roster order. */
  assets: SolanaAsset[]
  /** Pair families only: the collateral (left) and debt (right) leg. */
  pair?: { collateral: string; debt: string }
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/** Icon filename stem — the app's `lenderKey.toLowerCase()`. */
export const solanaEnumName = (lenderKey: string) => lenderKey.toLowerCase()

/** Brand badge stem — `lender/<brand>.webp`. */
export const solanaBrandEnumName = (brand: string) => brand.toLowerCase()

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchSolanaTokenList(): Promise<Record<string, any>> {
  const res = await fetch(TOKEN_LIST_URL)
  if (!res.ok) throw new Error(`solana token list: HTTP ${res.status}`)
  const raw: any = await res.json()
  const list = raw?.list ?? raw?.tokens ?? raw
  const out: Record<string, any> = {}
  if (Array.isArray(list)) {
    for (const t of list) if (t?.address) out[t.address] = t
  } else if (list && typeof list === 'object') {
    Object.assign(out, list)
  }
  if (Object.keys(out).length === 0) throw new Error('solana token list: no tokens parsed')
  return out
}

type JupiterToken = { symbol?: string; icon?: string }

const jupiterCache = new Map<string, Promise<JupiterToken | undefined>>()

/** Jupiter's token search for one mint, once per run. */
function jupiterToken(mint: string): Promise<JupiterToken | undefined> {
  let p = jupiterCache.get(mint)
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(JUPITER_SEARCH_URL(mint))
        if (!res.ok) return undefined
        const hits: any = await res.json()
        const hit = Array.isArray(hits) ? hits.find((h) => h?.id === mint) : undefined
        return hit ? { symbol: hit.symbol, icon: hit.icon } : undefined
      } catch {
        // cosmetic: the leg stays unresolved
        return undefined
      }
    })()
    jupiterCache.set(mint, p)
  }
  return p
}

/** Jupiter's art for a mint — the fallback when the listed logo's host is dead. */
export const jupiterLogo = async (mint: string) => (await jupiterToken(mint))?.icon

/**
 * All Solana lending markets, optionally limited to some families
 * (`KAMINO`, `SAVE`, …).
 */
export async function fetchSolanaMarkets(families: string[] = SVM_LENDERS): Promise<SolanaMarket[]> {
  const tokenList = await fetchSolanaTokenList()
  const bundles: Record<string, any> = await getLenderPublicDataAll('solana', families, { tokenList })

  const markets: SolanaMarket[] = []
  for (const [lenderKey, bundle] of Object.entries(bundles)) {
    const brand = lenderBrandKey(lenderKey)
    if (!brand) continue
    const basket = describeBasket(lenderKey, bundle)

    const assets: SolanaAsset[] = Object.values(bundle.data as Record<string, any>).map((row) => ({
      mint: row.underlying,
      symbol: row.asset?.symbol ?? '',
      logoURI: row.asset?.logoURI ?? tokenList[row.underlying]?.logoURI ?? undefined,
      totalDepositsUSD: Number(row.totalDepositsUSD) || 0,
    }))

    let pair: SolanaMarket['pair']
    const jl = bundle.params?.jupiterLendVault
    const ls = bundle.params?.loopscaleMarket
    if (jl) pair = { collateral: jl.supplyToken, debt: jl.borrowToken }
    else if (ls) pair = { collateral: ls.collateralMint, debt: ls.principalMint }

    markets.push({ lenderKey, brand, name: basket.name, assets, pair })
  }

  // Second pass: Jupiter art for every mint still without a logo.
  const missing = new Set<string>()
  for (const m of markets) for (const a of m.assets) if (!a.logoURI) missing.add(a.mint)
  for (const mint of missing) await jupiterToken(mint)
  for (const m of markets)
    for (const a of m.assets) {
      if (a.logoURI) continue
      const hit = await jupiterToken(a.mint)
      if (hit?.icon) a.logoURI = hit.icon
      if (hit?.symbol && (!a.symbol || a.symbol.includes('…'))) a.symbol = hit.symbol
    }

  return markets
}
