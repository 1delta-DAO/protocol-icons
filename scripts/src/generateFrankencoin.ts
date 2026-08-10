#!/usr/bin/env tsx
/**
 * Frankencoin (ZCHF) Icon Generator
 *
 * Fetches the curated original-position roster from the lender-metadata repo,
 * resolves the collateral artwork (token list → SmolDapp CDN → on-chain LP
 * legs) plus the ZCHF logo, and renders split-half market icons with the
 * Frankencoin badge overlay:
 *
 *   left half  = collateral (WBTC / cbBTC / GNO / …)
 *   right half = debt token (ZCHF)
 *   badge      = lender/frankencoin.webp, top-right
 *
 *   npm run generate:frankencoin
 *   npm run generate:frankencoin -- --force     # re-render existing icons
 *
 * One icon per ORIGINAL position (clones are sub-accounts of their original
 * and share its artwork), so the file count matches the curated market roster
 * rather than the ~72 live positions.
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
  fetchFrankencoinMarkets,
  fetchFrankencoinConfig,
  frankencoinMarketEnumName,
  type FrankencoinConfig,
  type FrankencoinMarketsByChain,
} from './frankencoinMarkets.js'
// Shared with the Inverse generator: token list → SmolDapp CDN → on-chain LP
// legs. Generic in (chainId, token, tokenMap) despite living in that module.
import { resolveCollateralArt } from './inverseMarkets.js'
import {
  mergeMultiCollateralWithBadge,
  mergeStackedCollateralWithBadge,
  outPath,
} from './iconMerger.js'

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
  byChain: FrankencoinMarketsByChain,
  config: FrankencoinConfig,
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  const markets = byChain[chainId]?.markets ?? []
  if (markets.length === 0) return stats

  const debtToken = config[chainId]?.zchf?.toLowerCase()
  if (!debtToken) {
    console.warn(`  [${name}] Frankencoin: no ZCHF address in config — skipping`)
    return stats
  }

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  // Resolve ZCHF through the SAME resolver as the collateral rather than a
  // bare token-list lookup: ZCHF is a Swiss-franc stablecoin with thinner list
  // coverage than DAI/USDC, and a list gap would otherwise drop every market.
  let debtLogo: string | undefined
  try {
    debtLogo = (await resolveCollateralArt(chainId, debtToken, tokenMap))?.sources[0]
  } catch (err) {
    console.error(`  [${name}] ZCHF art lookup: ${(err as Error).message}`)
  }
  if (!debtLogo) {
    stats.total += markets.length
    stats.missingLogos += markets.length
    console.warn(
      `  [${name}] Frankencoin: no logo for ZCHF ${debtToken} — skipping ${markets.length} markets`,
    )
    return stats
  }

  console.log(
    `  [${name}] frankencoin: ${markets.length} positions, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collAddr = market.collToken?.toLowerCase()
    if (!collAddr || !market.position) continue

    const enumName = frankencoinMarketEnumName(chainId, market.position)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    let art
    try {
      art = await resolveCollateralArt(chainId, collAddr, tokenMap)
    } catch (err) {
      console.error(`    ! ${enumName}: collateral art lookup: ${(err as Error).message}`)
    }
    if (!art) {
      stats.missingLogos++
      console.warn(
        `    ? ${market.name ?? market.collSymbol ?? enumName}: no artwork for collateral ${collAddr}`,
      )
      continue
    }

    try {
      // A single logo fills the collateral half as usual; a decomposed basket
      // gets one scaled-to-fit band per leg, so no leg is rendered as a slice.
      const merge =
        art.sources.length > 1 ? mergeStackedCollateralWithBadge : mergeMultiCollateralWithBadge
      await merge(art.sources, debtLogo, badgePath, filePath, { badgePadding: 2 })
      stats.created++
      const v = market.version ? ` v${market.version}` : ''
      console.log(`    + ${market.name ?? enumName}${v} → ${enumName}.webp (${art.via})`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('frankencoin')
  if (!fs.existsSync(badgePath)) {
    console.error(`Frankencoin badge missing at ${badgePath}`)
    console.error(`Place a circular frankencoin.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Frankencoin Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: FrankencoinMarketsByChain
  let config: FrankencoinConfig
  try {
    ;[byChain, config] = await Promise.all([
      fetchFrankencoinMarkets(),
      fetchFrankencoinConfig(),
    ])
  } catch (err) {
    console.error(`Frankencoin: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nFrankencoin: ${chainIds.length} chains`)

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
