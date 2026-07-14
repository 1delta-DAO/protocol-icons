#!/usr/bin/env tsx
/**
 * Morpho Midnight Icon Generator
 *
 * Morpho Midnight markets have ONE loan token and a *set* of collateral legs.
 * Icons follow the same split-half card as the Blue pairs, except the
 * collateral (left) half is sliced into one vertical column per collateral,
 * with a black-and-white Morpho "Midnight" badge overlaid top-right.
 *
 *   npm run generate:midnight
 *   npm run generate:midnight -- --force     # overwrite existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - A market is skipped if the loan logo or ANY collateral logo is missing
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchMidnightMarkets,
  midnightMarketEnumName,
  type MidnightMarketConfig,
  type MidnightMarketsByChain,
} from './midnightMarkets.js'
import {
  mergeMultiCollateralWithBadge,
  morphoMidnightBadgeBuffer,
  writeMorphoMidnightBaseIcon,
  outPath,
} from './iconMerger.js'

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
  markets: MidnightMarketConfig[],
  badge: Buffer,
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
    `  [${name}] midnight: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const loanAddr = market.loanToken?.toLowerCase()
    if (!loanAddr) continue

    const loanLogo = tokenMap[loanAddr]?.logoURI
    const collLogos = market.collateralParams.map(
      (c) => tokenMap[c.token?.toLowerCase()]?.logoURI,
    )

    if (!loanLogo || collLogos.length === 0 || collLogos.some((l) => !l)) {
      stats.missingLogos++
      continue
    }

    const enumName = midnightMarketEnumName(market.marketId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      await mergeMultiCollateralWithBadge(
        collLogos as string[], // collateral slices (left half)
        loanLogo, //              loan (right half)
        badge, //                 black-and-white Midnight badge
        filePath,
      )
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
  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Morpho Midnight Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: MidnightMarketsByChain
  try {
    byChain = await fetchMidnightMarkets()
  } catch (err) {
    console.error('Failed to fetch Midnight markets:', (err as Error).message)
    process.exit(1)
  }

  // Badge is deterministic — render once and reuse across every market.
  const badge = await morphoMidnightBadgeBuffer()

  // Generic dark fallback icon (`morpho_midnight.webp`), served when a
  // market-specific icon is missing. Mirrors `morpho_blue.webp`.
  const basePath = outPath('morpho_midnight')
  if (force || !fs.existsSync(basePath)) {
    await writeMorphoMidnightBaseIcon(basePath)
    console.log(`  base fallback → morpho_midnight.webp`)
  }

  const grand = newStats()
  const chainIds = Object.keys(byChain)
  console.log(`\n${chainIds.length} chains`)

  for (const chainId of chainIds) {
    const markets = byChain[chainId] ?? []
    if (markets.length === 0) continue
    const s = await processChain(chainId, markets, badge, force)
    grand.total += s.total
    grand.created += s.created
    grand.skipped += s.skipped
    grand.failed += s.failed
    grand.missingLogos += s.missingLogos
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
