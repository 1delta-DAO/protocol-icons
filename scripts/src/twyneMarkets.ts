/**
 * Twyne market fetcher.
 *
 * A Twyne market is a whitelisted `(intermediateVault, targetVault,
 * targetAsset)` triple over Aave V3 or Euler V2, so an icon is the same
 * split-half card the Curvance / LlamaLend / Term Finance / River generators
 * render:
 *
 *   left half  = the collateral UNDERLYING (a Pendle PT, wstETH, WETH)
 *   right half = the borrowed target asset (USDe, WETH, USDC, USDT, WBTC)
 *   badge      = lender/twyne.webp
 *
 * ## Why this reads the CHAIN
 *
 * `VaultManager` keeps its whitelists as un-enumerable mappings and governance
 * adds markets by multisig, so there is no getter that lists them and (at time
 * of writing) no published roster either. The only complete source is the event
 * log, replayed in order:
 *
 *   T_SetIntermediateVault      (a later `false` RETIRES a vault)
 *   T_AddAllowedTargetVault     (Euler: the pair IS the market)
 *   T_AddAllowedTargetVaultAsset(Aave: the Pool serves many assets)
 *
 * then enriched on chain: intermediate vault -> its asset (the RECEIPT token,
 * an eToken or Twyne's aToken wrapper) -> that wrapper's own `asset()`, which is
 * the underlying a user recognises and the one the token list has a logo for.
 *
 * This mirrors `lender-metadata/src/fetch/twyne/twyne.ts` deliberately — the two
 * must agree on market identity or a market's icon and its label disagree.
 *
 * ## The filename
 *
 * The lender key is `TWYNE_<chainId>_<INTERMEDIATE_VAULT>_<TARGET_ASSET>`, so
 * the stem is `twyne_1_<iv>_<targetasset>` — FOUR segments. Like Curvance it
 * carries a chain id; unlike every other lender it carries TWO addresses,
 * because the credit vault alone does not identify a market (one credit vault
 * backs three of the eight markets, differing only in what they borrow).
 *
 * ## Two markets are already matured
 *
 * Three markets have Pendle PT collateral and two of those PTs have expired.
 * They are rendered anyway: existing positions still need an icon, and an icon
 * is not a recommendation. Maturity gating belongs on the action surface, not
 * here.
 */

import { createPublicClient, http, fallback, parseAbiItem, type Address } from 'viem'

/** Twyne is Ethereum-only. */
export const TWYNE_CHAIN_ID = '1'

export const TWYNE_VAULT_MANAGER: Address = '0x0acd3A3c8Ab6a5F7b5A594C88DFa28999dA858aC'

/**
 * A FULL-HISTORY, topic-filtered `eth_getLogs` in one request is what most free
 * endpoints refuse — and they refuse it in three different ways: `Method not
 * found`, a range cap, or (worst) an EMPTY result with no error. The gateway
 * below serves it in one request; the rest are fallbacks for the plain reads.
 */
const ETH_RPCS = [
  'https://gateway.tenderly.co/public/mainnet',
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
]

const ERC20_ASSET_ABI = [
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

const EVT_SET_IV = parseAbiItem(
  'event T_SetIntermediateVault(address indexed intermediateVault, bool value)',
)
const EVT_ADD_TV = parseAbiItem(
  'event T_AddAllowedTargetVault(address indexed intermediateVault, address indexed targetVault)',
)
const EVT_ADD_TVA = parseAbiItem(
  'event T_AddAllowedTargetVaultAsset(address indexed intermediateVault, address indexed targetVault, address indexed targetAsset)',
)

export interface TwyneMarket {
  chainId: string
  intermediateVault: string
  targetVault: string
  /** The borrowed asset — the RIGHT half of the card. */
  targetAsset: string
  targetSymbol?: string
  /** The collateral receipt the vault actually holds (eToken / aToken wrapper). */
  collateralAsset: string
  /** What the user recognises — the LEFT half of the card. */
  underlyingAsset: string
  underlyingSymbol?: string
  name?: string
}

/** `twyne_1_<iv>_<targetAsset>` — the raw lender key, lower-cased. */
export function twyneEnumName(
  intermediateVault: string,
  targetAsset: string,
  chainId: string = TWYNE_CHAIN_ID,
): string {
  return `twyne_${chainId}_${intermediateVault.replace(/^0x/i, '').toLowerCase()}_${targetAsset
    .replace(/^0x/i, '')
    .toLowerCase()}`
}

const lower = (a: string) => String(a).toLowerCase()

export async function fetchTwyneMarkets(): Promise<Record<string, TwyneMarket[]>> {
  const client = createPublicClient({
    transport: fallback(ETH_RPCS.map((u) => http(u))),
  })

  const [ivLogs, tvLogs, tvaLogs] = await Promise.all([
    client.getLogs({ address: TWYNE_VAULT_MANAGER, event: EVT_SET_IV, fromBlock: 0n, toBlock: 'latest' }),
    client.getLogs({ address: TWYNE_VAULT_MANAGER, event: EVT_ADD_TV, fromBlock: 0n, toBlock: 'latest' }),
    client.getLogs({ address: TWYNE_VAULT_MANAGER, event: EVT_ADD_TVA, fromBlock: 0n, toBlock: 'latest' }),
  ])

  if (ivLogs.length === 0) {
    throw new Error(
      'VaultManager whitelist scan returned nothing — the endpoint silently ' +
        'truncated the range. Refusing to render an empty roster.',
    )
  }

  // ORDER MATTERS: a later `false` retires an intermediate vault and every
  // market under it, so the events cannot be treated as a set.
  const activeIvs = new Set<string>()
  for (const log of ivLogs) {
    const iv = lower(log.args.intermediateVault as string)
    if (log.args.value) activeIvs.add(iv)
    else activeIvs.delete(iv)
  }

  const triples: { iv: string; tv: string; asset?: string }[] = []
  for (const log of tvaLogs) {
    triples.push({
      iv: lower(log.args.intermediateVault as string),
      tv: lower(log.args.targetVault as string),
      asset: lower(log.args.targetAsset as string),
    })
  }
  // An Euler-side market whitelists only the (iv, targetVault) PAIR: the debt
  // asset is the target eVault's own asset, so no `…TargetVaultAsset` event is
  // ever emitted for it.
  for (const log of tvLogs) {
    const iv = lower(log.args.intermediateVault as string)
    const tv = lower(log.args.targetVault as string)
    if (!triples.some((t) => t.iv === iv && t.tv === tv)) triples.push({ iv, tv })
  }

  const live = triples.filter((t) => activeIvs.has(t.iv))
  const markets: TwyneMarket[] = []

  for (const t of live) {
    try {
      const collateralAsset = lower(
        (await client.readContract({
          address: t.iv as Address,
          abi: ERC20_ASSET_ABI,
          functionName: 'asset',
        })) as string,
      )
      // The receipt token wraps what the user recognises — read through it
      // rather than assuming, because the two integrations nest differently
      // (an eToken wraps the ERC-20; Twyne's wrapper wraps an aToken).
      const underlyingAsset = lower(
        (await client.readContract({
          address: collateralAsset as Address,
          abi: ERC20_ASSET_ABI,
          functionName: 'asset',
        })) as string,
      )
      const targetAsset =
        t.asset ??
        lower(
          (await client.readContract({
            address: t.tv as Address,
            abi: ERC20_ASSET_ABI,
            functionName: 'asset',
          })) as string,
        )

      const [underlyingSymbol, targetSymbol] = await Promise.all([
        client
          .readContract({ address: underlyingAsset as Address, abi: ERC20_ASSET_ABI, functionName: 'symbol' })
          .catch(() => undefined),
        client
          .readContract({ address: targetAsset as Address, abi: ERC20_ASSET_ABI, functionName: 'symbol' })
          .catch(() => undefined),
      ])

      markets.push({
        chainId: TWYNE_CHAIN_ID,
        intermediateVault: t.iv,
        targetVault: t.tv,
        targetAsset,
        targetSymbol: targetSymbol as string | undefined,
        collateralAsset,
        underlyingAsset,
        underlyingSymbol: underlyingSymbol as string | undefined,
        name: `${underlyingSymbol ?? underlyingAsset} / ${targetSymbol ?? targetAsset}`,
      })
    } catch (err) {
      console.error(`    ! ${t.iv} -> ${t.tv}: ${(err as Error).message}`)
    }
  }

  return { [TWYNE_CHAIN_ID]: markets }
}
