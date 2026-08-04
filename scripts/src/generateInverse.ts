#!/usr/bin/env tsx
/**
 * Inverse Finance (FiRM) Icon Generator
 *
 * Fetches FiRM markets from the lender-metadata repo, resolves the collateral
 * artwork (token list → SmolDapp CDN → on-chain LP legs) plus the DOLA logo,
 * and renders split-half market icons with the Inverse badge overlay:
 *
 *   left half  = collateral (one column per leg for LP collaterals)
 *   right half = debt token (DOLA)
 *   badge      = lender/inverse.webp, top-right
 *
 *   npm run generate:inverse
 *   npm run generate:inverse -- --force     # re-render existing icons
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
  fetchInverseMarkets,
  fetchInverseConfig,
  inverseMarketEnumName,
  resolveCollateralArt,
  type InverseConfig,
  type InverseMarketsByChain,
} from './inverseMarkets.js'
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
  byChain: InverseMarketsByChain,
  config: InverseConfig,
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  const markets = byChain[chainId]?.markets ?? []
  if (markets.length === 0) return stats

  const debtToken = config[chainId]?.dola?.toLowerCase()
  if (!debtToken) {
    console.warn(`  [${name}] Inverse: no DOLA address in config — skipping`)
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
    console.warn(`  [${name}] Inverse: no logo for DOLA ${debtToken} — skipping ${markets.length} markets`)
    return stats
  }

  console.log(`  [${name}] inverse: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`)

  for (const market of markets) {
    stats.total++

    const collAddr = market.collToken?.toLowerCase()
    if (!collAddr) continue

    const enumName = inverseMarketEnumName(market.address)
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
      console.warn(`    ? ${market.name ?? enumName}: no artwork for collateral ${collAddr}`)
      continue
    }

    try {
      // A single logo fills the collateral half as usual; a decomposed basket
      // gets one scaled-to-fit band per leg, so no leg is rendered as a slice.
      const merge =
        art.sources.length > 1 ? mergeStackedCollateralWithBadge : mergeMultiCollateralWithBadge
      await merge(art.sources, debtLogo, badgePath, filePath, {
        badgePadding: 2,
      })
      stats.created++
      console.log(`    + ${market.name ?? enumName} → ${enumName}.webp (${art.via})`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('inverse')
  if (!fs.existsSync(badgePath)) {
    console.error(`Inverse badge missing at ${badgePath}`)
    console.error(`Place a circular inverse.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Inverse Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: InverseMarketsByChain
  let config: InverseConfig
  try {
    ;[byChain, config] = await Promise.all([fetchInverseMarkets(), fetchInverseConfig()])
  } catch (err) {
    console.error(`Inverse: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nInverse: ${chainIds.length} chains`)

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
