#!/usr/bin/env tsx
/**
 * Term Finance Icon Generator
 *
 * Fetches Term Finance markets for all chains from the lender-metadata repo,
 * resolves collateral + debt-token logos via the delta token list, and renders
 * split-half market icons with the Term Finance badge overlay (same layout as
 * the River / Liquity generators):
 *
 *   left half  = collateral token (the market's single collateral)
 *   right half = debt asset (purchaseToken)
 *   badge      = lender/term_finance.webp, top-right
 *
 *   npm run generate:term
 *   npm run generate:term -- --force     # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/market don't stop the others
 *   - A market is skipped if the collateral or debt logo is missing
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchTermFinanceMarkets,
  termFinanceEnumName,
  type TermMarket,
} from './termFinanceMarkets.js'
import { mergeSplitWithBadge, outPath } from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

// ─── Per-chain processing ────────────────────────────────────────────────────

async function processChain(
  chainId: string,
  markets: TermMarket[],
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

  console.log(`  [${name}] term finance: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`)

  for (const market of markets) {
    stats.total++

    const debtAddr = market.purchaseToken?.toLowerCase()
    const collAddr = market.collateralParams?.[0]?.token?.toLowerCase()
    if (!debtAddr || !collAddr) continue

    const debtLogo = tokenMap[debtAddr]?.logoURI
    const collLogo = tokenMap[collAddr]?.logoURI
    if (!debtLogo || !collLogo) {
      stats.missingLogos++
      continue
    }

    const enumName = termFinanceEnumName(market.termRepoId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = debt asset, badge = Term Finance
      await mergeSplitWithBadge(collLogo, debtLogo, badgePath, filePath, {
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
  const badgePath = outPath('term_finance')
  if (!fs.existsSync(badgePath)) {
    console.error(`Term Finance badge missing at ${badgePath}`)
    console.error(`Place a circular term_finance.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Term Finance Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, TermMarket[]>
  try {
    byChain = await fetchTermFinanceMarkets()
  } catch (err) {
    console.error(`Term Finance: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nTerm Finance: ${chainIds.length} chains`)

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
