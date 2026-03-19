#!/usr/bin/env tsx
/**
 * Morpho Blue Icon Generator
 *
 * Fetches all Morpho Blue markets across supported chains, resolves token
 * logos from the delta token list, and generates split-half market icons
 * with a Morpho badge overlay.
 *
 * Modes:
 *   npm run generate            # one-shot: run once and exit
 *   npm run generate:watch      # cyclical: repeat every 30 min (configurable)
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - All failures are logged with context
 */

import fs from 'fs'
import { ALL_CHAINS, DEFAULT_CYCLE_INTERVAL_MS, chainName, MORPHO_BADGE_URL } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import { fetchMarketsForChain, type MorphoMarket } from './morphoMarkets.js'
import {
  mergeSplitWithBadge,
  outPath,
  marketEnumName,
  marketDisplayName,
} from './iconMerger.js'

// ─── Per-chain processing ────────────────────────────────────────────────────

interface GenerationStats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

async function processChain(chainId: string): Promise<GenerationStats> {
  const stats: GenerationStats = { total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 }
  const name = chainName(chainId)

  // Fetch markets
  let markets: MorphoMarket[]
  try {
    markets = await fetchMarketsForChain(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch markets:`, (err as Error).message)
    return stats
  }

  if (markets.length === 0) {
    console.log(`  [${name}] No markets found`)
    return stats
  }

  // Fetch token list
  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  console.log(`  [${name}] ${markets.length} markets, ${Object.keys(tokenMap).length} tokens in list`)

  // Generate icons
  for (const market of markets) {
    stats.total++

    if (!market.loanAsset || !market.collateralAsset) continue

    const loanAddr = market.loanAsset.address.toLowerCase()
    const collAddr = market.collateralAsset.address.toLowerCase()

    const loanToken = tokenMap[loanAddr]
    const collToken = tokenMap[collAddr]

    const loanLogo = loanToken?.logoURI
    const collLogo = collToken?.logoURI

    if (!loanLogo || !collLogo) {
      stats.missingLogos++
      continue
    }

    const enumName = marketEnumName(market.uniqueKey)
    const filePath = outPath(enumName)

    // Safe: skip if icon already exists
    if (fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      await mergeSplitWithBadge(
        collLogo,   // left half = collateral
        loanLogo,   // right half = loan
        MORPHO_BADGE_URL,
        filePath,
      )
      stats.created++

      // Log the display name for reference
      const collSymbol = collToken?.symbol ?? market.collateralAsset.symbol
      const loanSymbol = loanToken?.symbol ?? market.loanAsset.symbol
      if (collSymbol && loanSymbol) {
        const display = marketDisplayName(collSymbol, loanSymbol, market.lltv)
        console.log(`    + ${display} → ${enumName}.webp`)
      }
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Main run ────────────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Morpho Icon Generator — ${new Date().toISOString()}`)
  console.log(`Processing ${ALL_CHAINS.length} chains...`)
  console.log('='.repeat(60))

  const totals: GenerationStats = { total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 }

  for (const chainId of ALL_CHAINS) {
    const stats = await processChain(chainId)
    totals.total += stats.total
    totals.created += stats.created
    totals.skipped += stats.skipped
    totals.failed += stats.failed
    totals.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:  ${totals.total}`)
  console.log(`  Icons created:  ${totals.created}`)
  console.log(`  Already existed: ${totals.skipped}`)
  console.log(`  Missing logos:  ${totals.missingLogos}`)
  console.log(`  Failed:         ${totals.failed}`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const isWatch = process.argv.includes('--watch')
const intervalArg = process.argv.find((a) => a.startsWith('--interval='))
const intervalMs = intervalArg
  ? parseInt(intervalArg.split('=')[1], 10) * 60 * 1000  // --interval=N  (minutes)
  : DEFAULT_CYCLE_INTERVAL_MS

async function main() {
  await runOnce()

  if (isWatch) {
    console.log(`\nWatch mode: next run in ${intervalMs / 60000} minutes. Press Ctrl+C to stop.`)
    setInterval(async () => {
      try {
        await runOnce()
      } catch (err) {
        console.error('Cycle error:', (err as Error).message)
      }
      console.log(`\nNext run in ${intervalMs / 60000} minutes...`)
    }, intervalMs)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
