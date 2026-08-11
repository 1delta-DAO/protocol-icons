/**
 * Fraxlend market fetcher.
 *
 * Every market is a single `FraxlendPair` contract holding exactly one
 * (collateral, asset) pair, so an icon is the same split-half card the
 * LlamaLend / Curvance / Term Finance / River / Liquity / TermMax generators
 * render:
 *
 *   left half  = collateral token
 *   right half = asset (the borrowable / lent token)
 *   badge      = lender/fraxlend.webp
 *
 * ## Roster from metadata, TOKENS from the chain
 *
 * This one is a hybrid, and deliberately so:
 *
 *  - The ROSTER comes from the published config
 *    (`config/fraxlend.json` → `FRAXLEND.<chainId>.pairs`), because Fraxlend
 *    discovery is **allowlist-only**. There is no safe on-chain enumeration:
 *    the mainnet deployer returns 71 pairs of which 12 are FraxlendV1 (a
 *    different ABI generation) and most of the rest hold single-digit dollars,
 *    and the *other* mainnet registry is 62 Peapods pod-token pairs, several
 *    literally named `aspTESTING1`. Walking either one would render dozens of
 *    icons for markets nobody can see. DefiLlama's own adapter carries the same
 *    warning.
 *  - The TOKEN ADDRESSES come from the chain, because the config carries only
 *    `{address, symbol, label}` — the pair addresses, not their legs. Reading
 *    `asset()` / `collateralContract()` live keeps this generator correct
 *    without widening the metadata schema, and those two values are immutable
 *    for the life of a pair, so there is nothing to go stale.
 *
 * That split is the opposite of Curvance (all on-chain, no roster exists) and
 * of LlamaLend (all metadata, tokens are published) — Fraxlend needs one of
 * each.
 *
 * ## Leg order
 *
 * `collateralContract()` is the left half and `asset()` the right, matching the
 * "collateral on the left, borrowed on the right" convention every other
 * split-half generator uses. Fraxlend's own symbols read the other way round
 * (`ffrxUSD(sfrxETH)-58` is asset-first), so do NOT derive the order from the
 * symbol string — it would silently mirror every icon.
 *
 * The lender key mirrors margin-fetcher — `FRAXLEND_<chainId>_<PAIR_ADDR>` —
 * so the icon filename is `fraxlend_1_${pairAddrLower}`. Note the CHAIN ID
 * segment, as with Curvance (LlamaLend/Inverse are `<BRAND>_<ADDR>`).
 */

import { createPublicClient, http, fallback, type Address } from 'viem'
import { mainnet } from 'viem/chains'

const FRAXLEND_CONFIG_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/fraxlend.json'

/** Fraxlend is Ethereum-only today; the roster is keyed by chain regardless. */
export const FRAXLEND_CHAIN_ID = '1'

/**
 * Ethereum RPCs, in preference order.
 *
 * `gateway.tenderly.co` is first because it answers batched `eth_call`
 * reliably; the rest are fallbacks. Only 26 reads are needed for the whole
 * roster, so this never approaches a rate limit.
 */
const ETHEREUM_RPCS = [
  'https://gateway.tenderly.co/public/mainnet',
  'https://rpc.mevblocker.io',
  'https://eth.llamarpc.com',
  'https://rpc.flashbots.net',
]

const PAIR_ABI = [
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    // NOT `collateral()` — that is the Resupply fork's spelling and reverts here.
    name: 'collateralContract',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FraxlendMarket {
  /** The `FraxlendPair` contract — the lender-key body. */
  pair: string
  /** Posted-collateral token (left half). */
  collateralToken: string
  /** Borrowable / lent token (right half). */
  assetToken: string
  /** The pair's own fToken symbol, e.g. `ffrxUSD(sfrxETH)-58`. Logging only. */
  symbol?: string
  /** Display label, e.g. `"frxUSD / sfrxETH"`. */
  name?: string
}

export type FraxlendMarketsByChain = Record<string, FraxlendMarket[]>

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)

/** `FRAXLEND_<chainId>_<PAIR>` → the icon filename stem. */
export function fraxlendEnumName(
  pair: string,
  chainId: string = FRAXLEND_CHAIN_ID,
): string {
  return `fraxlend_${chainId}_${pair.replace(/^0x/i, '').toLowerCase()}`
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return res.json()
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * Fetch every curated Fraxlend pair, grouped by chain, with its two legs
 * resolved on-chain.
 *
 * A pair whose legs cannot be read is DROPPED rather than rendered with a
 * placeholder — a half-blank card is worse than no icon, because the fallback
 * path shows the lender badge instead. That also means a stale allowlist entry
 * pointing at a FraxlendV1 contract (which lacks these getters in the v3 shape)
 * simply disappears instead of producing a broken icon.
 */
export async function fetchFraxlendMarkets(): Promise<FraxlendMarketsByChain> {
  const raw = await fetchJson(FRAXLEND_CONFIG_URL)
  const byLender = raw?.FRAXLEND
  if (!byLender || typeof byLender !== 'object')
    throw new Error('fraxlend.json has no FRAXLEND key')

  // `chain` is required for the batched path: viem resolves Multicall3 from the
  // chain definition, and without it `multicall` throws
  // "multicallAddress is required". Ethereum carries canonical Multicall3, so
  // batching is safe here — unlike Curvance, whose generator reads sequentially
  // because Monad's registered multicall does not answer `aggregate3`.
  const pc = createPublicClient({
    chain: mainnet,
    transport: fallback(ETHEREUM_RPCS.map((u) => http(u))),
  })

  const out: FraxlendMarketsByChain = {}

  for (const [chainId, chainData] of Object.entries<any>(byLender)) {
    const pairs = Array.isArray(chainData?.pairs) ? chainData.pairs : []
    const listed = pairs.filter((p: any) => isAddr(p?.address))
    if (listed.length === 0) continue

    // Two reads per pair. `allowFailure` so one dead entry cannot sink the run.
    const results = await pc.multicall({
      contracts: listed.flatMap((p: any) => [
        {
          address: p.address as Address,
          abi: PAIR_ABI,
          functionName: 'collateralContract' as const,
        },
        {
          address: p.address as Address,
          abi: PAIR_ABI,
          functionName: 'asset' as const,
        },
      ]),
      allowFailure: true,
    })

    const usable: FraxlendMarket[] = []
    listed.forEach((p: any, i: number) => {
      const coll = results[i * 2]
      const asset = results[i * 2 + 1]
      if (coll?.status !== 'success' || asset?.status !== 'success') {
        console.warn(
          `    ~ ${p.label ?? p.address}: could not read legs on-chain — skipped`,
        )
        return
      }
      if (!isAddr(coll.result) || !isAddr(asset.result)) return
      usable.push({
        pair: p.address,
        collateralToken: coll.result as string,
        assetToken: asset.result as string,
        symbol: p.symbol,
        name: p.label,
      })
    })

    if (usable.length > 0) out[chainId] = usable
  }

  if (Object.keys(out).length === 0)
    throw new Error('fraxlend.json contained no usable pairs')

  return out
}
