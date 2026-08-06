#!/usr/bin/env tsx
/**
 * Curve LlamaLend Icon Generator
 *
 * Reads the published LlamaLend market roster, resolves each market's collateral
 * and borrowed-token logos from the delta token list, and renders split-half
 * market icons with the LlamaLend badge — the same layout as the Term Finance /
 * River / Liquity / TermMax generators:
 *
 *   left half  = collateral token
 *   right half = borrowed token
 *   badge      = lender/llamalend.webp, top-right
 *
 *   npm run generate:llamalend
 *   npm run generate:llamalend -- --force     # re-render existing icons
 *
 * Covers BOTH generations. v1 (`oneway`) and v2 (`oneway-v2`) differ only in
 * their write ABI; the lender key is the controller address either way, so no
 * version branching is needed here — see `llamaLendMarkets.ts`.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/market don't stop the others
 *   - A market is skipped if either token logo is missing (a half-blank card is
 *     worse than the lender-badge fallback)
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchLlamaLendMarkets,
  llamaLendEnumName,
  type LlamaLendMarket,
} from './llamaLendMarkets.js'
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
  markets: LlamaLendMarket[],
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

  const v1 = markets.filter((m) => m.version === 1).length
  const v2 = markets.filter((m) => m.version === 2).length
  console.log(
    `  [${name}] llamalend: ${markets.length} markets (v1 ${v1}, v2 ${v2}), ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collLogo = tokenMap[market.collateralToken.toLowerCase()]?.logoURI
    const borrowLogo = tokenMap[market.borrowedToken.toLowerCase()]?.logoURI
    if (!collLogo || !borrowLogo) {
      const missing = [
        !collLogo && (market.collateralSymbol ?? market.collateralToken),
        !borrowLogo && (market.borrowedSymbol ?? market.borrowedToken),
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`    ~ ${market.name ?? market.controller}: no logo for ${missing}`)
      stats.missingLogos++
      continue
    }

    const enumName = llamaLendEnumName(market.controller)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = borrowed token, badge = LlamaLend
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
  const badgePath = outPath('llamalend')
  if (!fs.existsSync(badgePath)) {
    console.error(`LlamaLend badge missing at ${badgePath}`)
    console.error(`Place a circular llamalend.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`LlamaLend Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, LlamaLendMarket[]>
  try {
    byChain = await fetchLlamaLendMarkets()
  } catch (err) {
    console.error(`LlamaLend: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nLlamaLend: ${chainIds.length} chains`)

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
