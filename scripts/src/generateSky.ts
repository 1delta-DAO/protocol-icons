#!/usr/bin/env tsx
/**
 * Sky (the original MakerDAO) Icon Generator
 *
 * Fetches the curated class-1 ilk roster from the lender-metadata repo,
 * resolves the collateral artwork (token list → SmolDapp CDN → on-chain LP
 * legs) plus the DAI logo, and renders split-half market icons with the Sky
 * badge overlay:
 *
 *   left half  = collateral (WETH / WBTC / wstETH)
 *   right half = debt token (DAI)
 *   badge      = lender/sky.webp, top-right
 *
 *   npm run generate:sky
 *   npm run generate:sky -- --force     # re-render existing icons
 *
 * Offboarded ilks (debt ceiling 0, e.g. every WBTC-*) still get an icon:
 * positions remain open and repay/withdraw stays routable, so they render in
 * the UI exactly like live markets.
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
  fetchDssMarkets,
  fetchDssConfig,
  dssMarketEnumName,
  dssDebtToken,
  type DssConfig,
  type DssMarketsByChain,
} from './dssMarkets.js'
// Shared with the Inverse generator: token list → SmolDapp CDN → on-chain LP
// legs. Generic in (chainId, token, tokenMap) despite living in that module.
import { resolveCollateralArt } from './inverseMarkets.js'
import {
  mergeMultiCollateralWithBadge,
  mergeStackedCollateralWithBadge,
  outPath,
} from './iconMerger.js'

const BRAND = 'SKY' as const

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
  byChain: DssMarketsByChain,
  config: DssConfig,
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  const markets = byChain[chainId]?.markets ?? []
  if (markets.length === 0) return stats

  const cfg = config[chainId]
  const debtToken = dssDebtToken(cfg)
  if (!debtToken) {
    console.warn(`  [${name}] Sky: no debt token in config — skipping`)
    return stats
  }
  const debtSymbol = cfg?.debtSymbol ?? 'DAI'

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  // Resolve the debt logo through the SAME resolver as the collateral rather
  // than a bare token-list lookup, so a list gap falls back to the CDN instead
  // of dropping every market on the chain.
  let debtLogo: string | undefined
  try {
    debtLogo = (await resolveCollateralArt(chainId, debtToken, tokenMap))?.sources[0]
  } catch (err) {
    console.error(`  [${name}] ${debtSymbol} art lookup: ${(err as Error).message}`)
  }
  if (!debtLogo) {
    stats.total += markets.length
    stats.missingLogos += markets.length
    console.warn(
      `  [${name}] Sky: no logo for ${debtSymbol} ${debtToken} — skipping ${markets.length} markets`,
    )
    return stats
  }

  console.log(`  [${name}] sky: ${markets.length} ilks, ${Object.keys(tokenMap).length} tokens`)

  for (const market of markets) {
    stats.total++

    const collAddr = market.collToken?.toLowerCase()
    if (!collAddr || !market.ilk) continue

    const enumName = dssMarketEnumName(BRAND, chainId, market.ilk)
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
      console.warn(`    ? ${market.ilk}: no artwork for collateral ${collAddr}`)
      continue
    }

    try {
      // A single logo fills the collateral half as usual; a decomposed basket
      // gets one scaled-to-fit band per leg, so no leg is rendered as a slice.
      const merge =
        art.sources.length > 1 ? mergeStackedCollateralWithBadge : mergeMultiCollateralWithBadge
      await merge(art.sources, debtLogo, badgePath, filePath, { badgePadding: 2 })
      stats.created++
      const flag = market.offboarded ? ' [offboarded]' : ''
      console.log(`    + ${market.ilk} (${market.name ?? ''}) → ${enumName}.webp (${art.via})${flag}`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('sky')
  if (!fs.existsSync(badgePath)) {
    console.error(`Sky badge missing at ${badgePath}`)
    console.error(`Place a circular sky.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Sky (MakerDAO) Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: DssMarketsByChain
  let config: DssConfig
  try {
    ;[byChain, config] = await Promise.all([fetchDssMarkets(BRAND), fetchDssConfig(BRAND)])
  } catch (err) {
    console.error(`Sky: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nSky: ${chainIds.length} chains`)

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
