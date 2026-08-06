/**
 * Curve LlamaLend market fetcher.
 *
 * Every market is an isolated `{Vault, Controller, AMM}` triplet over exactly
 * one (collateral, borrowed) pair, so an icon is the same split-half card the
 * Term Finance / River / Liquity / TermMax generators render:
 *
 *   left half  = collateral token
 *   right half = borrowed token
 *   badge      = lender/llamalend.webp
 *
 * Source (1delta-DAO/lender-metadata):
 *   data/llamalend-markets.json  →  { LLAMALEND: { [chainId]: { markets: [...] } } }
 *
 * Unlike TermMax there IS a checked-in roster: LlamaLend markets are permanent
 * (no maturity roll), so the published metadata is the right source and the
 * generator stays reproducible.
 *
 * The lender key mirrors margin-fetcher — `LLAMALEND_<CONTROLLER_ADDR_UPPER>`
 * — so the icon filename is `llamalend_${controllerAddrLower}`.
 *
 * ## Both generations, one icon set
 *
 * Ethereum runs v1 (`oneway`) and v2 (`oneway-v2`) side by side and their write
 * ABIs differ, but that is invisible here: the lender key is keyed on the
 * CONTROLLER address either way, so v1 and v2 markets each get their own icon
 * with no special-casing. Do not filter on `version` — dropping v2 would leave
 * 5 of 42 markets iconless.
 */

const LLAMALEND_MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/llamalend-markets.json'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LlamaLendMarket {
  /** The Controller contract — the lender-key body. */
  controller: string
  /** Collateral token (left half). */
  collateralToken: string
  /** Borrowed / loan token (right half). */
  borrowedToken: string
  collateralSymbol?: string
  borrowedSymbol?: string
  /** 1 = `oneway`, 2 = `oneway-v2`. Carried for logging only. */
  version?: number
  /** Display label, e.g. `"crvUSD / sfrxUSD"`. */
  name?: string
}

export type LlamaLendMarketsByChain = Record<string, LlamaLendMarket[]>

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)

/** `LLAMALEND_<ADDR>` → the icon filename stem. */
export function llamaLendEnumName(controller: string): string {
  return `llamalend_${controller.replace(/^0x/i, '').toLowerCase()}`
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return res.json()
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Fetch every published LlamaLend market, grouped by chain.
 *
 * Markets missing either token address are dropped rather than rendered with a
 * placeholder — a half-blank icon is worse than no icon, because the fallback
 * path shows the lender badge instead.
 */
export async function fetchLlamaLendMarkets(): Promise<LlamaLendMarketsByChain> {
  const raw = await fetchJson(LLAMALEND_MARKETS_URL)
  const byLender = raw?.LLAMALEND
  if (!byLender || typeof byLender !== 'object')
    throw new Error('llamalend-markets.json has no LLAMALEND key')

  const out: LlamaLendMarketsByChain = {}

  for (const [chainId, chainData] of Object.entries<any>(byLender)) {
    const markets = Array.isArray(chainData?.markets) ? chainData.markets : []
    const usable: LlamaLendMarket[] = []

    for (const m of markets) {
      if (
        !isAddr(m?.controller) ||
        !isAddr(m?.collateralToken) ||
        !isAddr(m?.borrowedToken)
      )
        continue
      usable.push({
        controller: m.controller,
        collateralToken: m.collateralToken,
        borrowedToken: m.borrowedToken,
        collateralSymbol: m.collateralSymbol,
        borrowedSymbol: m.borrowedSymbol,
        version: m.version,
        name: m.name,
      })
    }

    if (usable.length > 0) out[chainId] = usable
  }

  if (Object.keys(out).length === 0)
    throw new Error('llamalend-markets.json contained no usable markets')

  return out
}
