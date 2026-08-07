/**
 * Curvance market fetcher.
 *
 * Every market is an isolated `MarketManagerIsolated` over exactly two
 * `BorrowableCToken` legs, so an icon is the same split-half card the
 * LlamaLend / Term Finance / River / Liquity / TermMax generators render:
 *
 *   left half  = collateral token
 *   right half = borrowed token
 *   badge      = lender/curvance.webp
 *
 * ## Why this one reads the CHAIN instead of a published roster
 *
 * Unlike LlamaLend there is NO checked-in roster to read: Curvance publishes no
 * market list, and Monad's public RPCs cap `eth_getLogs` at a 100-block range,
 * which makes the registry's own events unscannable. In the SDK the roster is a
 * built-in seed (`CURVANCE_MONAD_CONFIG` in @1delta/data-sdk) and lender-metadata
 * carries only labels. So the only reproducible source here is the registry
 * itself, walked live:
 *
 *   CentralRegistry.marketManagers() -> MarketManager.queryTokensListed()
 *                                    -> cToken.asset()
 *
 * This mirrors `lender-metadata/src/fetch/curvance/labels.ts` deliberately —
 * the two must agree on market identity and leg ORDER or a market's icon and
 * its label disagree about which asset is on the left.
 *
 * ## Leg order is the protocol's, not ours
 *
 * `queryTokensListed()`'s array order is canonical, verified on all 25 live
 * markets (2026-08-07): the collateral-only leg is first in 20/20 markets with a
 * single borrowable side, and on the 5 markets where BOTH legs are borrowable
 * (WMON|AUSD, WMON|USDC, WBTC|USDC, WETH|USDC, eBTC|WBTC) it reproduces
 * Curvance's own app naming exactly. Do NOT re-sort — a derived tiebreak such as
 * "lower debt cap first" inverts every one of those five.
 *
 * The lender key mirrors margin-fetcher — `CURVANCE_<chainId>_<MARKET_MANAGER>`
 * — so the icon filename is `curvance_143_${marketManagerLower}`. Note the CHAIN
 * ID segment: Curvance is the only per-market lender whose key carries one
 * (LlamaLend/Inverse are `<BRAND>_<ADDR>`).
 */

import { createPublicClient, http, fallback, type Address } from 'viem'

/** Curvance is Monad-only. */
export const CURVANCE_CHAIN_ID = '143'

export const CURVANCE_CENTRAL_REGISTRY: Address =
  '0x1310f352f1389969Ece6741671c4B919523912fF'

const MONAD_RPCS = [
  'https://rpc-mainnet.monadinfra.com',
  'https://rpc.monad.xyz',
  'https://rpc1.monad.xyz',
  'https://rpc2.monad.xyz',
]

// ─── ABIs (minimal, inline — this repo has no @1delta/abis dependency) ───────

const CENTRAL_REGISTRY_ABI = [
  {
    name: 'marketManagers',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const

const MARKET_MANAGER_ABI = [
  {
    name: 'queryTokensListed',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const

const CTOKEN_ABI = [
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

const ERC20_ABI = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CurvanceMarket {
  /** The MarketManagerIsolated — the lender-key body. */
  marketManager: string
  /** Collateral token (left half) — `queryTokensListed()[0]`. */
  collateralToken: string
  /** Borrowed / debt token (right half) — `queryTokensListed()[1]`. */
  borrowedToken: string
  collateralSymbol?: string
  borrowedSymbol?: string
  /** Display label, e.g. `"WMON / USDC"`. */
  name?: string
}

export type CurvanceMarketsByChain = Record<string, CurvanceMarket[]>

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)

/** `CURVANCE_<chainId>_<MM>` → the icon filename stem. */
export function curvanceEnumName(
  marketManager: string,
  chainId: string = CURVANCE_CHAIN_ID,
): string {
  return `curvance_${chainId}_${marketManager.replace(/^0x/i, '').toLowerCase()}`
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Walk the registry and return every market, grouped by chain (one key, `143`).
 *
 * Deliberately NOT batched through Multicall3: the canonical Multicall3 is
 * deployed on Monad but the address our SDK carries is a Uniswap multicall that
 * does not answer `aggregate3`, and a batched read that silently returns empty
 * would look here like "the protocol has no markets". A few dozen plain reads,
 * run rarely, cannot under-report.
 *
 * A market missing either leg is dropped rather than rendered with a
 * placeholder — a half-blank icon is worse than no icon, because the fallback
 * path shows the lender badge instead.
 */
export async function fetchCurvanceMarkets(): Promise<CurvanceMarketsByChain> {
  const pc = createPublicClient({
    transport: fallback(MONAD_RPCS.map((u) => http(u))),
  })

  const managers = (await pc.readContract({
    address: CURVANCE_CENTRAL_REGISTRY,
    abi: CENTRAL_REGISTRY_ABI,
    functionName: 'marketManagers',
  })) as readonly Address[]

  const usable: CurvanceMarket[] = []

  for (const mm of managers) {
    let cTokens: readonly Address[]
    try {
      cTokens = (await pc.readContract({
        address: mm,
        abi: MARKET_MANAGER_ABI,
        functionName: 'queryTokensListed',
      })) as readonly Address[]
    } catch (err) {
      console.log(`    ~ ${mm}: queryTokensListed failed — ${(err as Error).message}`)
      continue
    }
    // Array order IS the canonical order — see the header. Never re-sort.
    if (!cTokens || cTokens.length < 2) continue

    try {
      const legs: { underlying: string; symbol: string }[] = []
      for (const cToken of cTokens.slice(0, 2)) {
        const underlying = (await pc.readContract({
          address: cToken,
          abi: CTOKEN_ABI,
          functionName: 'asset',
        })) as Address
        let symbol = ''
        try {
          symbol = (await pc.readContract({
            address: underlying,
            abi: ERC20_ABI,
            functionName: 'symbol',
          })) as string
        } catch {
          // A missing symbol is cosmetic — the icon keys on addresses.
        }
        legs.push({ underlying, symbol })
      }

      if (!isAddr(legs[0]?.underlying) || !isAddr(legs[1]?.underlying)) continue

      usable.push({
        marketManager: mm,
        collateralToken: legs[0].underlying,
        borrowedToken: legs[1].underlying,
        collateralSymbol: legs[0].symbol,
        borrowedSymbol: legs[1].symbol,
        name: `${legs[0].symbol} / ${legs[1].symbol}`,
      })
    } catch (err) {
      console.log(`    ~ ${mm}: leg resolution failed — ${(err as Error).message}`)
    }
  }

  if (usable.length === 0)
    throw new Error(
      'Curvance: the registry returned no usable markets — treat this as an RPC ' +
        'failure rather than a delisting and do not proceed.',
    )

  return { [CURVANCE_CHAIN_ID]: usable }
}
