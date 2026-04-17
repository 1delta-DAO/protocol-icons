#!/usr/bin/env tsx
/**
 * Silo v2 / v3 Icon Generator
 *
 * Fetches Silo market metadata for all chains from the lender-metadata repo,
 * resolves token logos via the delta token list, and generates split-half
 * market icons with the local Silo badge overlay.
 *
 *   npm run generate:silo
 *   npm run generate:silo -- --version=v2     # only v2
 *   npm run generate:silo -- --version=v3     # only v3
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName, SILO_BADGE_PATH } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchSiloMarkets,
  siloMarketEnumName,
  type SiloMarket,
  type SiloMarketsByChain,
  type SiloVersion,
} from './siloMarkets.js'
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
  version: SiloVersion,
  chainId: string,
  markets: SiloMarket[],
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

  console.log(`  [${name}] silo ${version}: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`)

  for (const market of markets) {
    stats.total++

    const t0 = market.silo0?.token?.toLowerCase()
    const t1 = market.silo1?.token?.toLowerCase()
    if (!t0 || !t1) continue

    const tok0 = tokenMap[t0]
    const tok1 = tokenMap[t1]
    const logo0 = tok0?.logoURI
    const logo1 = tok1?.logoURI

    if (!logo0 || !logo1) {
      stats.missingLogos++
      continue
    }

    const enumName = siloMarketEnumName(version, market.siloConfig)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      await mergeSplitWithBadge(logo0, logo1, SILO_BADGE_PATH, filePath, {
        badgePadding: 2,
      })
      stats.created++
      console.log(`    + ${market.name} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Per-version processing ──────────────────────────────────────────────────

async function processVersion(version: SiloVersion, force: boolean): Promise<Stats> {
  const totals = newStats()

  let byChain: SiloMarketsByChain
  try {
    byChain = await fetchSiloMarkets(version)
  } catch (err) {
    console.error(`Silo ${version}: ${(err as Error).message}`)
    return totals
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nSilo ${version}: ${chainIds.length} chains`)

  for (const chainId of chainIds) {
    const markets = byChain[chainId] ?? []
    if (markets.length === 0) continue
    const stats = await processChain(version, chainId, markets, force)
    totals.total += stats.total
    totals.created += stats.created
    totals.skipped += stats.skipped
    totals.failed += stats.failed
    totals.missingLogos += stats.missingLogos
  }

  return totals
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(SILO_BADGE_PATH)) {
    console.error(`Silo badge missing at ${SILO_BADGE_PATH}`)
    console.error(`Place a circular silo.webp in lender/ before running.`)
    process.exit(1)
  }

  const versionArg = process.argv.find((a) => a.startsWith('--version='))
  const requested = versionArg?.split('=')[1] as SiloVersion | undefined
  const versions: SiloVersion[] = requested ? [requested] : ['v2', 'v3']
  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Silo Icon Generator — ${new Date().toISOString()}`)
  console.log(`Versions: ${versions.join(', ')}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  const grand = newStats()
  for (const v of versions) {
    const s = await processVersion(v, force)
    grand.total += s.total
    grand.created += s.created
    grand.skipped += s.skipped
    grand.failed += s.failed
    grand.missingLogos += s.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:  ${grand.total}`)
  console.log(`  Icons created:  ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  Missing logos:  ${grand.missingLogos}`)
  console.log(`  Failed:         ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
