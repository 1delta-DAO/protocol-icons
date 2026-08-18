#!/usr/bin/env tsx
/**
 * Twyne Icon Generator
 *
 * Replays Twyne's VaultManager whitelist on Ethereum, resolves each market's
 * collateral and borrowed-token logos from the delta token list, and renders
 * split-half market icons with the Twyne badge — the same layout as the
 * Curvance / LlamaLend / Term Finance / River / Liquity / TermMax generators:
 *
 *   left half  = collateral underlying (a Pendle PT, wstETH, WETH)
 *   right half = borrowed target asset (USDe, WETH, USDC, USDT, WBTC)
 *   badge      = lender/twyne.webp, top-right
 *
 *   npm run generate:twyne
 *   npm run generate:twyne -- --force     # re-render existing icons
 *
 * Output filenames are `twyne_1_<intermediateVault>_<targetAsset>.webp` — FOUR
 * segments, because a Twyne market is a (credit vault, borrowed asset) pair and
 * the credit vault alone does not identify one: a single credit vault backs
 * three of the eight markets, differing only in what they borrow.
 *
 * Like the Curvance generator the roster is read from the CHAIN, not from
 * published metadata — see `twyneMarkets.ts` for why.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - A market is skipped if either token logo is missing (a half-blank card is
 *     worse than the lender-badge fallback)
 *   - Errors on one market don't stop the others
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import { fetchTwyneMarkets, twyneEnumName, type TwyneMarket } from './twyneMarkets.js'
import { mergeSplitWithBadge, outPath } from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

async function processChain(
  chainId: string,
  markets: TwyneMarket[],
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  console.log(
    `  [${name}] twyne: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collLogo = tokenMap[market.underlyingAsset.toLowerCase()]?.logoURI
    const borrowLogo = tokenMap[market.targetAsset.toLowerCase()]?.logoURI
    if (!collLogo || !borrowLogo) {
      const missing = [
        !collLogo && (market.underlyingSymbol || market.underlyingAsset),
        !borrowLogo && (market.targetSymbol || market.targetAsset),
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`    ~ ${market.name}: no logo for ${missing}`)
      stats.missingLogos++
      continue
    }

    const enumName = twyneEnumName(market.intermediateVault, market.targetAsset, chainId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral underlying, right half = borrowed asset
      await mergeSplitWithBadge(collLogo, borrowLogo, badgePath, filePath, { badgePadding: 2 })
      stats.created++
      console.log(`    + ${market.name} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

async function main() {
  const badgePath = outPath('twyne')
  if (!fs.existsSync(badgePath)) {
    console.error(`Twyne badge missing at ${badgePath}`)
    console.error(`Place a circular twyne.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Twyne Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, TwyneMarket[]>
  try {
    byChain = await fetchTwyneMarkets()
  } catch (err) {
    console.error(`Twyne: ${(err as Error).message}`)
    process.exit(1)
  }

  const grand = newStats()
  for (const chainId of Object.keys(byChain)) {
    const markets = byChain[chainId] ?? []
    if (markets.length === 0) continue
    const stats = await processChain(chainId, markets, badgePath, force)
    grand.total += stats.total
    grand.created += stats.created
    grand.skipped += stats.skipped
    grand.failed += stats.failed
    grand.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:   ${grand.total}`)
  console.log(`  Icons created:   ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  Missing logos:   ${grand.missingLogos}`)
  console.log(`  Failed:          ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
