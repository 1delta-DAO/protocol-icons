#!/usr/bin/env tsx
/**
 * Fraxlend Icon Generator
 *
 * Reads the published Fraxlend pair allowlist, resolves each pair's collateral
 * and asset legs on-chain, looks their logos up in the delta token list, and
 * renders split-half market icons with the Fraxlend badge — the same layout as
 * the LlamaLend / Curvance / Term Finance / River / Liquity / TermMax
 * generators:
 *
 *   left half  = collateral token
 *   right half = asset (the borrowable / lent token)
 *   badge      = lender/fraxlend.webp, top-right
 *
 *   npm run generate:fraxlend
 *   npm run generate:fraxlend -- --force     # re-render existing icons
 *
 * The roster is metadata-driven and the legs are chain-driven — see
 * `fraxlendMarkets.ts` for why it has to be that split, and why walking the
 * on-chain deployer instead would render dozens of icons for FraxlendV1 and
 * Peapods test pairs.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/pair don't stop the others
 *   - A pair is skipped if either token logo is missing (a half-blank card is
 *     worse than the lender-badge fallback)
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchFraxlendMarkets,
  fraxlendEnumName,
  type FraxlendMarket,
} from './fraxlendMarkets.js'
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
  markets: FraxlendMarket[],
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
    `  [${name}] fraxlend: ${markets.length} pairs, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collLogo = tokenMap[market.collateralToken.toLowerCase()]?.logoURI
    const assetLogo = tokenMap[market.assetToken.toLowerCase()]?.logoURI
    if (!collLogo || !assetLogo) {
      const missing = [
        !collLogo && market.collateralToken,
        !assetLogo && market.assetToken,
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`    ~ ${market.name ?? market.pair}: no logo for ${missing}`)
      stats.missingLogos++
      continue
    }

    const enumName = fraxlendEnumName(market.pair, chainId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = asset, badge = Fraxlend.
      // The order comes from the CONTRACT getters, never from the pair symbol —
      // Fraxlend's own symbols are asset-first (`ffrxUSD(sfrxETH)-58`), so
      // deriving it from the string would mirror every icon.
      await mergeSplitWithBadge(collLogo, assetLogo, badgePath, filePath, {
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
  const badgePath = outPath('fraxlend')
  if (!fs.existsSync(badgePath)) {
    console.error(`Fraxlend badge missing at ${badgePath}`)
    console.error(`Place a circular fraxlend.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Fraxlend Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, FraxlendMarket[]>
  try {
    byChain = await fetchFraxlendMarkets()
  } catch (err) {
    console.error(`Fraxlend: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nFraxlend: ${chainIds.length} chain(s)`)

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
  console.log(`  Pairs found:     ${grand.total}`)
  console.log(`  Icons created:   ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  Missing logos:   ${grand.missingLogos}`)
  console.log(`  Failed:          ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
