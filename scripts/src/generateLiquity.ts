#!/usr/bin/env tsx
/**
 * Liquity V2 (+ forks) Icon Generator
 *
 * Fetches every Liquity-family deployment (LIQUITY_V2 and forks such as USDAF,
 * FELIX, NERITE, QUILL, ENOSYS_LOANS, SONETA, EBISU) from the lender-metadata
 * repo, resolves collateral + debt-token logos via the delta token list, and
 * renders split-half market icons with the per-protocol badge overlay:
 *
 *   left half  = collateral token
 *   right half = deployment debt token (BOLD / USDaf / feUSD / …)
 *   badge      = protocol badge (lender/<protocol>.webp), top-right
 *
 *   npm run generate:liquity
 *   npm run generate:liquity -- --protocol=FELIX   # single deployment
 *   npm run generate:liquity -- --force            # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one protocol/chain/market don't stop the others
 *   - A protocol whose badge is missing is skipped with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchLiquityMarkets,
  fetchLiquityConfig,
  liquityMarketEnumName,
  liquityBadgeName,
  type LiquityConfig,
  type LiquityMarket,
} from './liquityMarkets.js'
import { mergeSplitWithBadge, outPath } from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

const addStats = (a: Stats, b: Stats): void => {
  a.total += b.total
  a.created += b.created
  a.skipped += b.skipped
  a.failed += b.failed
  a.missingLogos += b.missingLogos
}

// ─── Per-chain processing ────────────────────────────────────────────────────

async function processChain(
  protocol: string,
  chainId: string,
  markets: LiquityMarket[],
  config: LiquityConfig,
  tokenMap: TokenMap,
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  const debtToken = config[protocol]?.[chainId]?.boldToken?.toLowerCase()
  if (!debtToken) {
    console.warn(`  [${name}] ${protocol}: no debt token in config — skipping`)
    return stats
  }

  const debtLogo = tokenMap[debtToken]?.logoURI
  if (!debtLogo) {
    stats.total += markets.length
    stats.missingLogos += markets.length
    console.warn(`  [${name}] ${protocol}: no logo for debt token ${debtToken} — skipping ${markets.length} markets`)
    return stats
  }

  console.log(`  [${name}] ${protocol}: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`)

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

    const enumName = liquityMarketEnumName(protocol, chainId, market.collIndex)
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
  const force = process.argv.includes('--force')
  const protocolArg = process.argv.find((a) => a.startsWith('--protocol='))
  const onlyProtocol = protocolArg?.split('=')[1]?.toUpperCase()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Liquity Icon Generator — ${new Date().toISOString()}`)
  if (onlyProtocol) console.log(`Protocol filter: ${onlyProtocol}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byProtocol: Record<string, Record<string, LiquityMarket[]>>
  let config: LiquityConfig
  try {
    ;[byProtocol, config] = await Promise.all([fetchLiquityMarkets(), fetchLiquityConfig()])
  } catch (err) {
    console.error(`Liquity: ${(err as Error).message}`)
    process.exit(1)
  }

  // Cache token maps per chain — forks share chains (e.g. LIQUITY_V2, USDAF, EBISU on 1).
  const tokenMapCache = new Map<string, TokenMap>()
  const getTokenMap = async (chainId: string): Promise<TokenMap> => {
    const cached = tokenMapCache.get(chainId)
    if (cached) return cached
    let map: TokenMap = {}
    try {
      map = await fetchTokenMap(chainId)
    } catch (err) {
      console.error(`  [${chainName(chainId)}] Failed to fetch token list:`, (err as Error).message)
    }
    tokenMapCache.set(chainId, map)
    return map
  }

  const protocols = Object.keys(byProtocol).filter((p) => !onlyProtocol || p === onlyProtocol)
  console.log(`\n${protocols.length} protocols`)

  const grand = newStats()
  for (const protocol of protocols) {
    const badgePath = outPath(liquityBadgeName(protocol))
    if (!fs.existsSync(badgePath)) {
      console.warn(`\n${protocol}: badge missing at ${badgePath} — skipping. Place ${liquityBadgeName(protocol)}.webp in lender/.`)
      continue
    }

    const byChain = byProtocol[protocol] ?? {}
    console.log(`\n${protocol}: ${Object.keys(byChain).length} chains`)
    for (const [chainId, markets] of Object.entries(byChain)) {
      if (!markets?.length) continue
      const tokenMap = await getTokenMap(chainId)
      const stats = await processChain(protocol, chainId, markets, config, tokenMap, badgePath, force)
      addStats(grand, stats)
    }
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
