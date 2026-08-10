/**
 * Lista DAO (Moolah) market fetcher.
 *
 * Moolah is a Morpho Blue *fork*, but it is NOT part of the Morpho icon run:
 * it has its own lender key (`LISTA_DAO_<MARKET_ID>`), its own badge
 * (`lender/lista.webp`) and its own data source — the published roster, not the
 * Morpho GraphQL API. Keeping it here means `index.ts` stays Morpho-only and a
 * Lista change can never regress Morpho icons (or vice versa).
 *
 * Sources (1delta-DAO/lender-metadata):
 *   config/morpho-type-markets.json  →  { LISTA_DAO: { [chainId]: [marketId, …] } }
 *   config/morpho-pools.json         →  { LISTA_DAO: { [chainId]: moolahAddress } }
 *
 * The roster carries market IDs only, so the (collateral, loan) pair behind each
 * ID is read on-chain from Moolah's `idToMarketParams` — the same shape Morpho
 * Blue exposes. That keeps the generator reproducible without a Lista API.
 *
 * The lender key mirrors margin-fetcher — `LISTA_DAO_<MARKET_ID_UPPER, no 0x>` —
 * so the icon filename is `lista_dao_${marketIdLower}`.
 */

import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  parseAbi,
  type Chain,
  type PublicClient,
  type Transport,
} from 'viem'
import { bsc, mainnet } from 'viem/chains'
import { ChainId, chainName } from './config.js'

// ─── Sources ─────────────────────────────────────────────────────────────────

const MARKETS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/morpho-type-markets.json'

const POOLS_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/config/morpho-pools.json'

/** Fallback Moolah addresses, used only if `morpho-pools.json` can't be read. */
const MOOLAH_FALLBACK: Record<string, string> = {
  [ChainId.ETHEREUM]: '0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70',
  [ChainId.BNB]: '0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C',
}

// ─── Chain wiring ────────────────────────────────────────────────────────────

interface ChainConfig {
  chain: Chain
  rpcUrls: string[]
}

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Chains we can read Moolah on. A roster chain missing from here is reported
 * loudly rather than skipped silently — that is the signal Lista deployed to a
 * new chain and this map needs an entry.
 *
 * Per-chain RPC override: `LISTA_RPC_<chainId>`.
 */
const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  [ChainId.ETHEREUM]: {
    chain: mainnet,
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.drpc.org',
      'https://rpc.ankr.com/eth',
    ],
  },
  [ChainId.BNB]: {
    chain: bsc,
    rpcUrls: [
      'https://bsc-dataseed.bnbchain.org',
      'https://bsc-rpc.publicnode.com',
      'https://bsc.drpc.org',
    ],
  },
}

/** Markets read per multicall — public RPCs choke on unbounded aggregate3 calls. */
const MULTICALL_CHUNK = 50

const MOOLAH_ABI = parseAbi([
  'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
])

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListaMarket {
  /** Moolah market id (`bytes32`) — the lender-key body. */
  id: string
  /** Collateral token (left half). */
  collateralToken: string
  /** Loan token (right half). */
  loanToken: string
  /** WAD-scaled liquidation LTV, for display only. */
  lltv: string
}

export type ListaMarketsByChain = Record<string, ListaMarket[]>

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isAddr = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)

const isMarketId = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)

/** `LISTA_DAO_<ID>` → the icon filename stem. */
export function listaEnumName(marketId: string): string {
  return `lista_dao_${marketId.replace(/^0x/i, '').toLowerCase()}`
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return res.json()
}

function makeClient(chainId: string, cfg: ChainConfig): PublicClient {
  const override = process.env[`LISTA_RPC_${chainId}`]
  const urls = [override, ...cfg.rpcUrls].filter(Boolean) as string[]
  const transports: Transport[] = urls.map((u) =>
    http(u, { timeout: REQUEST_TIMEOUT_MS, retryCount: 1 }),
  )
  // Keep the viem chain (multicall3 address + batching) but pin the transports.
  const chain = defineChain({
    ...cfg.chain,
    rpcUrls: { default: { http: urls } },
  })
  return createPublicClient({
    chain,
    transport: transports.length === 1 ? transports[0] : fallback(transports),
  })
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Resolve the (collateral, loan) pair behind each roster market id. */
async function resolveMarkets(
  chainId: string,
  moolah: string,
  ids: string[],
): Promise<ListaMarket[]> {
  const cfg = CHAIN_CONFIGS[chainId]
  if (!cfg) throw new Error(`no RPC config for chain ${chainId}`)

  const client = makeClient(chainId, cfg)
  const out: ListaMarket[] = []

  for (let i = 0; i < ids.length; i += MULTICALL_CHUNK) {
    const batch = ids.slice(i, i + MULTICALL_CHUNK)
    const results = await client.multicall({
      contracts: batch.map((id) => ({
        address: moolah as `0x${string}`,
        abi: MOOLAH_ABI,
        functionName: 'idToMarketParams',
        args: [id as `0x${string}`],
      })) as any,
      allowFailure: true,
    })

    results.forEach((res, j) => {
      // A failed entry is a dead/unknown id (or an RPC hiccup) — skip it rather
      // than render a half-blank card. `allowFailure` never throws, so a whole
      // failed chunk reads as "no markets": that shows up in the run summary as
      // resolve failures, not as silently missing icons.
      if (res.status !== 'success') return
      const [loanToken, collateralToken, , , lltv] = res.result as unknown as [
        string,
        string,
        string,
        string,
        bigint,
      ]
      if (!isAddr(loanToken) || !isAddr(collateralToken)) return
      out.push({
        id: batch[j],
        loanToken: loanToken.toLowerCase(),
        collateralToken: collateralToken.toLowerCase(),
        lltv: lltv.toString(),
      })
    })
  }

  return out
}

/**
 * Fetch every published Lista (Moolah) market, grouped by chain.
 *
 * Roster ids that don't resolve on-chain are dropped; chains present in the
 * roster but absent from `CHAIN_CONFIGS` are logged as a warning.
 */
export async function fetchListaMarkets(): Promise<ListaMarketsByChain> {
  const [rosterRaw, poolsRaw] = await Promise.all([
    fetchJson(MARKETS_URL),
    fetchJson(POOLS_URL).catch(() => null),
  ])

  const roster = rosterRaw?.LISTA_DAO
  if (!roster || typeof roster !== 'object')
    throw new Error('morpho-type-markets.json has no LISTA_DAO key')

  const pools: Record<string, string> = {
    ...MOOLAH_FALLBACK,
    ...(poolsRaw?.LISTA_DAO ?? {}),
  }

  const out: ListaMarketsByChain = {}

  for (const [chainId, rawIds] of Object.entries<any>(roster)) {
    const ids = (Array.isArray(rawIds) ? rawIds : []).filter(isMarketId)
    if (ids.length === 0) continue

    if (!CHAIN_CONFIGS[chainId]) {
      console.warn(
        `  [${chainName(chainId)}] Lista roster has ${ids.length} markets but no RPC config — add one to listaMarkets.ts`,
      )
      continue
    }

    const moolah = pools[chainId]
    if (!isAddr(moolah)) {
      console.warn(
        `  [${chainName(chainId)}] no Moolah address in morpho-pools.json — skipping`,
      )
      continue
    }

    try {
      const markets = await resolveMarkets(chainId, moolah, ids)
      if (markets.length > 0) out[chainId] = markets
      if (markets.length < ids.length) {
        console.warn(
          `  [${chainName(chainId)}] resolved ${markets.length}/${ids.length} market ids on-chain`,
        )
      }
    } catch (err) {
      console.error(
        `  [${chainName(chainId)}] Moolah read failed:`,
        (err as Error).message,
      )
    }
  }

  if (Object.keys(out).length === 0)
    throw new Error('no usable Lista markets resolved')

  return out
}
