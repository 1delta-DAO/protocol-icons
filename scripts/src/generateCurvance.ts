#!/usr/bin/env tsx
/**
 * Curvance Icon Generator
 *
 * Walks the Curvance registry on Monad, resolves each market's collateral and
 * borrowed-token logos from the delta token list, and renders split-half market
 * icons with the Curvance badge — the same layout as the LlamaLend / Term
 * Finance / River / Liquity / TermMax generators:
 *
 *   left half  = collateral token
 *   right half = borrowed token
 *   badge      = lender/curvance.webp, top-right
 *
 *   npm run generate:curvance
 *   npm run generate:curvance -- --force     # re-render existing icons
 *
 * Output filenames are `curvance_143_<marketManagerLower>.webp`. Curvance is the
 * only per-market lender whose key carries a CHAIN ID segment
 * (`CURVANCE_<chainId>_<MM>`), so the stem has three parts, not two.
 *
 * Unlike every other generator here the market roster is read from the CHAIN,
 * not from published metadata — see `curvanceMarkets.ts` for why, and for why
 * the leg order must be taken from the protocol rather than computed.
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
import {
  fetchCurvanceMarkets,
  curvanceEnumName,
  type CurvanceMarket,
} from './curvanceMarkets.js'
import { mergeSplitWithBadge, outPath } from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({
  total: 0,
  created: 0,
  skipped: 0,
  failed: 0,
  missingLogos: 0,
})

// ─── Per-chain processing ────────────────────────────────────────────────────

async function processChain(
  chainId: string,
  markets: CurvanceMarket[],
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
    `  [${name}] curvance: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collLogo = tokenMap[market.collateralToken.toLowerCase()]?.logoURI
    const borrowLogo = tokenMap[market.borrowedToken.toLowerCase()]?.logoURI
    if (!collLogo || !borrowLogo) {
      const missing = [
        !collLogo && (market.collateralSymbol || market.collateralToken),
        !borrowLogo && (market.borrowedSymbol || market.borrowedToken),
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`    ~ ${market.name ?? market.marketManager}: no logo for ${missing}`)
      stats.missingLogos++
      continue
    }

    const enumName = curvanceEnumName(market.marketManager, chainId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = borrowed token, badge = Curvance
      await mergeSplitWithBadge(collLogo, borrowLogo, badgePath, filePath, {
        badgePadding: 2,
      })
      stats.created++
      console.log(`    + ${market.name ?? enumName} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('curvance')
  if (!fs.existsSync(badgePath)) {
    console.error(`Curvance badge missing at ${badgePath}`)
    console.error(`Place a circular curvance.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Curvance Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, CurvanceMarket[]>
  try {
    byChain = await fetchCurvanceMarkets()
  } catch (err) {
    console.error(`Curvance: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nCurvance: ${chainIds.length} chain(s)`)

  const grand = newStats()
  for (const chainId of chainIds) {
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
