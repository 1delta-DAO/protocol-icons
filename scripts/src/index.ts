#!/usr/bin/env tsx
/**
 * Morpho Blue Icon Generator
 *
 * Fetches all Morpho Blue markets across supported chains, resolves token
 * logos from the delta token list, and generates split-half market icons
 * with a Morpho badge overlay.
 *
 * Scope: Morpho Blue (and API/subgraph-shaped forks) ONLY — every icon written
 * here is `morpho_blue_<marketId>`. Lista DAO / Moolah is a Blue fork but has
 * its own lender key, badge and roster-plus-on-chain data source, so it lives
 * in `generateLista.ts` (`npm run generate:lista`). Do not fold it back in.
 *
 * Modes:
 *   npm run generate            # one-shot: run once and exit
 *   npm run generate:watch      # cyclical: repeat every 30 min (configurable)
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - All failures are logged with context
 */

import fs from 'fs'
import { ALL_CHAINS, DEFAULT_CYCLE_INTERVAL_MS, chainName, MORPHO_BADGE_URL } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import { fetchMarketsForChain, type MorphoMarket } from './morphoMarkets.js'
import { resolveCollateralArt } from './inverseMarkets.js'
import {
  mergeSplitWithBadge,
  outPath,
  marketEnumName,
  marketDisplayName,
} from './iconMerger.js'

// ─── Per-chain processing ────────────────────────────────────────────────────

interface GenerationStats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

/**
 * Last-resort art by SYMBOL from the big chains' token lists (Ethereum, Base,
 * Arbitrum), built once per run. A bridged / restaked asset on a new chain
 * (sdeUSD, ezETH, deUSD on World Chain) is the same brand everywhere, and its
 * own chain's list simply has not caught up. Symbol collisions are possible
 * but only ever cost a wrong LOGO on a market whose alternative is no icon at
 * all — never a wrong address anywhere.
 */
let symbolLogoCache: Map<string, string> | undefined
async function symbolLogoFallback(): Promise<Map<string, string>> {
  if (symbolLogoCache) return symbolLogoCache
  const map = new Map<string, string>()
  for (const chainId of ['1', '8453', '42161']) {
    try {
      const list = await fetchTokenMap(chainId)
      for (const t of Object.values(list)) {
        const sym = t.symbol?.toLowerCase()
        if (sym && t.logoURI && !map.has(sym)) map.set(sym, t.logoURI)
      }
    } catch (err) {
      console.warn(`  symbol fallback: token list ${chainId} unavailable:`, (err as Error).message)
    }
  }
  symbolLogoCache = map
  return map
}

async function processChain(chainId: string, force: boolean): Promise<GenerationStats> {
  const stats: GenerationStats = { total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 }
  const name = chainName(chainId)

  // Fetch markets
  let markets: MorphoMarket[]
  try {
    markets = await fetchMarketsForChain(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch markets:`, (err as Error).message)
    return stats
  }

  if (markets.length === 0) {
    console.log(`  [${name}] No markets found`)
    return stats
  }

  // Fetch token list
  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(`  [${name}] Failed to fetch token list:`, (err as Error).message)
    return stats
  }

  console.log(`  [${name}] ${markets.length} markets, ${Object.keys(tokenMap).length} tokens in list`)

  // Generate icons
  for (const market of markets) {
    stats.total++

    if (!market.loanAsset || !market.collateralAsset) continue

    const loanAddr = market.loanAsset.address.toLowerCase()
    const collAddr = market.collateralAsset.address.toLowerCase()

    const loanToken = tokenMap[loanAddr]
    const collToken = tokenMap[collAddr]

    const enumName = marketEnumName(market.uniqueKey)
    const filePath = outPath(enumName)

    // Safe: skip if icon already exists (unless --force). Checked BEFORE the
    // art lookup so an existing icon never costs a CDN round trip.
    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    // Token list first, then the SmolDapp CDN, then LP legs — the same
    // resolver the Sky / Frankencoin / Inverse generators use — and finally
    // Morpho's own `cdn.morpho.org` art off the API row. Before this the
    // Morpho generator read `logoURI` off the token list alone, so every
    // market with one asset the list does not carry had no icon at all
    // (Tempo's only listed market, pathUSD/cbBTC, among them).
    const [loanArt, collArt] = await Promise.all([
      resolveCollateralArt(chainId, loanAddr, tokenMap),
      resolveCollateralArt(chainId, collAddr, tokenMap),
    ])
    let loanLogo = loanArt?.sources[0] ?? market.loanAsset.logoURI ?? undefined
    let collLogo = collArt?.sources[0] ?? market.collateralAsset.logoURI ?? undefined

    if (!loanLogo || !collLogo) {
      const bySymbol = await symbolLogoFallback()
      loanLogo ??= bySymbol.get(market.loanAsset.symbol?.toLowerCase() ?? '')
      collLogo ??= bySymbol.get(market.collateralAsset.symbol?.toLowerCase() ?? '')
    }

    if (!loanLogo || !collLogo) {
      stats.missingLogos++
      continue
    }

    try {
      await mergeSplitWithBadge(
        collLogo,   // left half = collateral
        loanLogo,   // right half = loan
        MORPHO_BADGE_URL,
        filePath,
      )
      stats.created++

      // Log the display name for reference
      const collSymbol = collToken?.symbol ?? market.collateralAsset.symbol
      const loanSymbol = loanToken?.symbol ?? market.loanAsset.symbol
      if (collSymbol && loanSymbol) {
        const display = marketDisplayName(collSymbol, loanSymbol, market.lltv)
        console.log(`    + ${display} → ${enumName}.webp`)
      }
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Main run ────────────────────────────────────────────────────────────────

async function runOnce(force: boolean): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Morpho Icon Generator — ${new Date().toISOString()}`)
  const chains = CHAIN_FILTER ?? ALL_CHAINS
  console.log(`Processing ${chains.length} chains...`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  const totals: GenerationStats = { total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 }

  for (const chainId of chains) {
    const stats = await processChain(chainId, force)
    totals.total += stats.total
    totals.created += stats.created
    totals.skipped += stats.skipped
    totals.failed += stats.failed
    totals.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:  ${totals.total}`)
  console.log(`  Icons created:  ${totals.created}`)
  console.log(`  Already existed: ${totals.skipped}`)
  console.log(`  Missing logos:  ${totals.missingLogos}`)
  console.log(`  Failed:         ${totals.failed}`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const isWatch = process.argv.includes('--watch')
const force = process.argv.includes('--force')
// `--chains=480,4217` restricts a run to those chain ids (a new chain, or a
// re-render) — a full run walks every missing Base dust market through the CDN.
const chainsArg = process.argv.find((a) => a.startsWith('--chains='))
const CHAIN_FILTER: string[] | undefined = chainsArg
  ? chainsArg.split('=')[1].split(',').map((c) => c.trim()).filter(Boolean)
  : undefined
const intervalArg = process.argv.find((a) => a.startsWith('--interval='))
const intervalMs = intervalArg
  ? parseInt(intervalArg.split('=')[1], 10) * 60 * 1000  // --interval=N  (minutes)
  : DEFAULT_CYCLE_INTERVAL_MS

async function main() {
  await runOnce(force)

  if (isWatch) {
    console.log(`\nWatch mode: next run in ${intervalMs / 60000} minutes. Press Ctrl+C to stop.`)
    setInterval(async () => {
      try {
        await runOnce(force)
      } catch (err) {
        console.error('Cycle error:', (err as Error).message)
      }
      console.log(`\nNext run in ${intervalMs / 60000} minutes...`)
    }, intervalMs)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
