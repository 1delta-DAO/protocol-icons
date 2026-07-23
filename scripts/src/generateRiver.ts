#!/usr/bin/env tsx
/**
 * River (Satoshi Protocol) Icon Generator
 *
 * Fetches River markets for all chains from the lender-metadata repo, resolves
 * collateral + debt-token logos via the delta token list, and renders
 * split-half market icons with the River badge overlay:
 *
 *   left half  = collateral token
 *   right half = debt token (satUSD)
 *   badge      = lender/river.webp, top-right
 *
 *   npm run generate:river
 *   npm run generate:river -- --force     # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/market don't stop the others
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchRiverMarkets,
  fetchRiverConfig,
  riverMarketEnumName,
  type RiverConfig,
  type RiverMarketsByChain,
} from './riverMarkets.js'
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
  byChain: RiverMarketsByChain,
  config: RiverConfig,
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  const markets = byChain[chainId]?.markets ?? []
  if (markets.length === 0) return stats

  const debtToken = config[chainId]?.debtToken?.toLowerCase()
  if (!debtToken) {
    console.warn(`  [${name}] River: no debt token in config — skipping`)
    return stats
  }

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  const debtLogo = tokenMap[debtToken]?.logoURI
  if (!debtLogo) {
    stats.total += markets.length
    stats.missingLogos += markets.length
    console.warn(`  [${name}] River: no logo for debt token ${debtToken} — skipping ${markets.length} markets`)
    return stats
  }

  console.log(`  [${name}] river: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`)

  for (const market of markets) {
    stats.total++

    const collAddr = market.collToken?.toLowerCase()
    if (!collAddr) continue

    const collToken = tokenMap[collAddr]
    const collLogo = collToken?.logoURI
    if (!collLogo) {
      stats.missingLogos++
      continue
    }

    const enumName = riverMarketEnumName(chainId, market.index)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
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
  const badgePath = outPath('river')
  if (!fs.existsSync(badgePath)) {
    console.error(`River badge missing at ${badgePath}`)
    console.error(`Place a circular river.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`River Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: RiverMarketsByChain
  let config: RiverConfig
  try {
    ;[byChain, config] = await Promise.all([fetchRiverMarkets(), fetchRiverConfig()])
  } catch (err) {
    console.error(`River: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nRiver: ${chainIds.length} chains`)

  const grand = newStats()
  for (const chainId of chainIds) {
    const stats = await processChain(chainId, byChain, config, badgePath, force)
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
