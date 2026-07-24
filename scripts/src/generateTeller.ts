#!/usr/bin/env tsx
/**
 * Teller Icon Generator
 *
 * Fetches Teller pools for all chains from the lender-metadata repo, resolves
 * collateral + principal (debt) token logos via the delta token list, and
 * renders split-half pool icons with the Teller badge overlay (same layout as
 * the Term Finance / River / Liquity generators):
 *
 *   left half  = collateral token (the pool's single collateral)
 *   right half = principal / debt asset (what you borrow)
 *   badge      = lender/teller.webp, top-right
 *
 *   npm run generate:teller
 *   npm run generate:teller -- --force     # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/pool don't stop the others
 *   - A pool is skipped if the collateral or principal logo is missing
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchTellerPools,
  tellerEnumName,
  type TellerPool,
} from './tellerMarkets.js'
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
  pools: TellerPool[],
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(
      `  [${name}] Failed to fetch token list:`,
      (err as Error).message,
    )
    return stats
  }

  console.log(
    `  [${name}] teller: ${pools.length} pools, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const pool of pools) {
    stats.total++

    const debtAddr = pool.principal?.toLowerCase()
    const collAddr = pool.collateral?.toLowerCase()
    if (!debtAddr || !collAddr) continue

    const debtLogo = tokenMap[debtAddr]?.logoURI
    const collLogo = tokenMap[collAddr]?.logoURI
    if (!debtLogo || !collLogo) {
      stats.missingLogos++
      continue
    }

    const enumName = tellerEnumName(pool.pool)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = principal (debt), badge = Teller
      await mergeSplitWithBadge(collLogo, debtLogo, badgePath, filePath, {
        badgePadding: 2,
      })
      stats.created++
      console.log(`    + ${pool.name ?? enumName} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('teller')
  if (!fs.existsSync(badgePath)) {
    console.error(`Teller badge missing at ${badgePath}`)
    console.error(`Place a circular teller.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Teller Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, TellerPool[]>
  try {
    byChain = await fetchTellerPools()
  } catch (err) {
    console.error(`Teller: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nTeller: ${chainIds.length} chains`)

  const grand = newStats()
  for (const chainId of chainIds) {
    const pools = byChain[chainId] ?? []
    if (pools.length === 0) continue
    const stats = await processChain(chainId, pools, badgePath, force)
    grand.total += stats.total
    grand.created += stats.created
    grand.skipped += stats.skipped
    grand.failed += stats.failed
    grand.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Pools found:     ${grand.total}`)
  console.log(`  Icons created:   ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  Missing logos:   ${grand.missingLogos}`)
  console.log(`  Failed:          ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
