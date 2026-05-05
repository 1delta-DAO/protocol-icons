/**
 * On-chain Morpho Blue market discovery.
 *
 * Used as the fallback path for chains where:
 *   - the official Morpho GraphQL API is unreliable / incomplete, AND
 *   - we have no Goldsky subgraph configured.
 *
 * Strategy: read every `CreateMarket` event from the MorphoBlue contract
 * via chunked `eth_getLogs` and reshape into the unified `MorphoMarket`
 * shape that the icon pipeline consumes.
 *
 * Per-chain RPC override: set `MORPHO_RPC_<chainId>` in the environment.
 */

import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  parseAbiItem,
  type Chain,
  type PublicClient,
  type Transport,
} from 'viem'
import type { MorphoMarket } from './morphoMarkets.js'

const CREATE_MARKET_EVENT = parseAbiItem(
  'event CreateMarket(bytes32 indexed id, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)',
)

interface OnchainConfig {
  morpho: `0x${string}`
  fromBlock: bigint
  /** Max block range per `getLogs` call. Public RPCs commonly cap at 1k–10k. */
  blockChunk: bigint
  rpcUrls: string[]
  chain: Chain
}

// Most modern Morpho Blue deployments share this canonical CreateX address.
// Override per-chain in `ONCHAIN_CONFIGS` if a deployment used a different one.
const CANONICAL_MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFFb' as const

const REQUEST_TIMEOUT_MS = 15_000

export const ONCHAIN_CONFIGS: Record<string, OnchainConfig> = {
  // Berachain (80094)
  '80094': {
    morpho: CANONICAL_MORPHO,
    fromBlock: 0n,
    blockChunk: 9_000n,
    rpcUrls: ['https://rpc.berachain.com'],
    chain: defineChain({
      id: 80094,
      name: 'Berachain',
      nativeCurrency: { name: 'BERA', symbol: 'BERA', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.berachain.com'] } },
    }),
  },
  // Corn (21000000)
  '21000000': {
    morpho: CANONICAL_MORPHO,
    fromBlock: 0n,
    blockChunk: 9_000n,
    rpcUrls: ['https://maizenet-rpc.usecorn.com', 'https://rpc.usecorn.com'],
    chain: defineChain({
      id: 21000000,
      name: 'Corn',
      nativeCurrency: { name: 'BTCN', symbol: 'BTCN', decimals: 18 },
      rpcUrls: { default: { http: ['https://maizenet-rpc.usecorn.com'] } },
    }),
  },
  // Abstract (2741)
  '2741': {
    morpho: CANONICAL_MORPHO,
    fromBlock: 0n,
    blockChunk: 9_000n,
    rpcUrls: ['https://api.mainnet.abs.xyz'],
    chain: defineChain({
      id: 2741,
      name: 'Abstract',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://api.mainnet.abs.xyz'] } },
    }),
  },
}

export const ONCHAIN_CHAINS = Object.keys(ONCHAIN_CONFIGS)
export const hasOnchain = (chainId: string): boolean =>
  chainId in ONCHAIN_CONFIGS

function makeClient(chainId: string, cfg: OnchainConfig): PublicClient {
  const override = process.env[`MORPHO_RPC_${chainId}`]
  const urls = [override, ...cfg.rpcUrls].filter(Boolean) as string[]
  const transports: Transport[] = urls.map((u) =>
    http(u, { timeout: REQUEST_TIMEOUT_MS, retryCount: 1 }),
  )
  return createPublicClient({
    chain: cfg.chain,
    transport: transports.length === 1 ? transports[0] : fallback(transports),
  })
}

async function getLogsChunked(
  client: PublicClient,
  cfg: OnchainConfig,
  toBlock: bigint,
) {
  const all: any[] = []
  for (
    let start = cfg.fromBlock;
    start <= toBlock;
    start += cfg.blockChunk + 1n
  ) {
    const end = start + cfg.blockChunk > toBlock ? toBlock : start + cfg.blockChunk
    const logs = await client.getLogs({
      address: cfg.morpho,
      event: CREATE_MARKET_EVENT,
      fromBlock: start,
      toBlock: end,
    })
    all.push(...logs)
  }
  return all
}

export async function fetchFromOnchain(
  chainId: string,
): Promise<MorphoMarket[]> {
  const cfg = ONCHAIN_CONFIGS[chainId]
  if (!cfg) throw new Error(`No on-chain config for chain ${chainId}`)

  const client = makeClient(chainId, cfg)
  const head = await client.getBlockNumber()
  const logs = await getLogsChunked(client, cfg, head)

  const seen = new Set<string>()
  const out: MorphoMarket[] = []
  for (const log of logs) {
    const args = log.args as
      | {
          id?: `0x${string}`
          marketParams?: {
            loanToken: `0x${string}`
            collateralToken: `0x${string}`
            lltv: bigint
          }
        }
      | undefined
    const id = args?.id
    const params = args?.marketParams
    if (!id || !params) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      uniqueKey: id,
      lltv: params.lltv.toString(),
      loanAsset: {
        address: params.loanToken.toLowerCase(),
        symbol: '',
        decimals: 18,
      },
      collateralAsset: {
        address: params.collateralToken.toLowerCase(),
        symbol: '',
        decimals: 18,
      },
    })
  }
  return out
}
