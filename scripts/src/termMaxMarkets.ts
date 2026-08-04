/**
 * TermMax market fetcher.
 *
 * TermMax is a fixed-rate, fixed-maturity AMM over zero-coupon bonds. Each
 * market is one (debtToken, collateral, maturity) tuple, so icons render the
 * collateral and the debt asset as split halves with the TermMax badge — the
 * same layout as the Term Finance / River / Liquity generators.
 *
 * SOURCE IS THE PROTOCOL API, NOT lender-metadata — unlike every other
 * generator here. `lender-metadata` deliberately carries only TermMax's per-
 * chain config and NO market roster: markets churn on every maturity roll
 * (~15% of the book turned over on a single date in Jul-2026) and matured ones
 * vanish from upstream entirely, so a checked-in list would be stale within
 * weeks. The API is the only current source.
 *
 * Lender key follows the address-keyed convention used by margin-fetcher
 * (`TERMMAX_<MARKET_ADDR>`), lower-cased for the filename:
 *   `termmax_${marketAddr}`  (0x-stripped, lower-cased)
 */

const API_BASE = 'https://api.termmax.ts.finance'
const SUPPORT_CHAINS_URL = `${API_BASE}/market/config/support-chains`

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TermMaxMarket {
  /** Market contract address — the lender-key body. */
  market: string
  /** Debt / loan asset borrowed against the collateral. */
  debtToken: string
  collateral: string
  /** Unix seconds. */
  maturity: number
  /** Display label, e.g. `"USDC/PT-sUSDE-13AUG2026@16AUG2026"`. */
  symbol?: string
}

export type TermMaxMarketsByChain = Record<string, TermMaxMarket[]>

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)

/** `TERMMAX_<ADDR>` → the icon filename stem. */
export function termMaxEnumName(market: string): string {
  return `termmax_${market.replace(/^0x/i, '').toLowerCase()}`
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return res.json()
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Fetch every live TermMax market across every supported chain.
 *
 * Matured / disabled markets are dropped: they are gone from the product, and
 * rendering an icon for one only leaves a file nothing references. A chain that
 * fails is skipped with a warning rather than aborting the run — one bad chain
 * should not cost the others their icons.
 */
export async function fetchTermMaxMarkets(): Promise<TermMaxMarketsByChain> {
  const chains: string[] = (
    (await fetchJson(SUPPORT_CHAINS_URL))?.data ?? []
  ).map((c: unknown) => String(c))
  if (chains.length === 0) {
    throw new Error('TermMax: no supported chains returned')
  }

  const out: TermMaxMarketsByChain = {}
  const nowSec = Math.floor(Date.now() / 1000)

  for (const chainId of chains) {
    let rows: any[]
    try {
      const data = await fetchJson(`${API_BASE}/market/data?chainId=${chainId}`)
      rows = Array.isArray(data?.data?.markets) ? data.data.markets : []
    } catch (err) {
      console.warn(
        `  [chain ${chainId}] TermMax market fetch failed: ${(err as Error).message}`,
      )
      continue
    }

    const markets: TermMaxMarket[] = []
    for (const r of rows) {
      const c = r?.contracts
      if (!isAddr(c?.marketAddr) || !isAddr(c?.underlyingAddr) || !isAddr(c?.collateralAddr)) {
        continue
      }
      if (r.isEnabled === false || r.isMatured === true) continue
      const maturity = Math.floor(Date.parse(String(r.maturity ?? '')) / 1000)
      if (Number.isFinite(maturity) && maturity > 0 && maturity <= nowSec) continue

      markets.push({
        market: c.marketAddr.toLowerCase(),
        debtToken: c.underlyingAddr.toLowerCase(),
        collateral: c.collateralAddr.toLowerCase(),
        maturity,
        symbol: r.symbol,
      })
    }
    if (markets.length > 0) out[chainId] = markets
  }

  return out
}
