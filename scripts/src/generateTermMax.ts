#!/usr/bin/env tsx
/**
 * TermMax Icon Generator
 *
 * Fetches live TermMax markets for all chains, resolves collateral + debt-token
 * logos via the delta token list, and renders split-half market icons with the
 * TermMax badge overlay (same layout as the Term Finance / River / Liquity
 * generators):
 *
 *   left half  = collateral token
 *   right half = debt asset (the market's loan token)
 *   badge      = lender/termmax.webp, top-right
 *
 *   npm run generate:termmax
 *   npm run generate:termmax -- --force     # re-render existing icons
 *
 * Note markets come from the TermMax API rather than lender-metadata — see
 * `termMaxMarkets.ts` for why there is no checked-in roster.
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
  fetchTermMaxMarkets,
  termMaxEnumName,
  type TermMaxMarket,
} from './termMaxMarkets.js'
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
  markets: TermMaxMarket[],
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
    `  [${name}] termmax: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const debtLogo = tokenMap[market.debtToken]?.logoURI
    const collLogo = tokenMap[market.collateral]?.logoURI
    if (!debtLogo || !collLogo) {
      // Common for TermMax: collateral is often a Pendle PT or a freshly-listed
      // RWA that the token list has not picked up yet.
      stats.missingLogos++
      continue
    }

    const enumName = termMaxEnumName(market.market)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = debt asset, badge = TermMax
      await mergeSplitWithBadge(collLogo, debtLogo, badgePath, filePath, {
        badgePadding: 2,
      })
      stats.created++
      console.log(`    + ${market.symbol ?? enumName} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('termmax')
  if (!fs.existsSync(badgePath)) {
    console.error(`TermMax badge missing at ${badgePath}`)
    console.error(`Place a circular termmax.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`TermMax Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, TermMaxMarket[]>
  try {
    byChain = await fetchTermMaxMarkets()
  } catch (err) {
    console.error(`TermMax: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nTermMax: ${chainIds.length} chains`)

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
