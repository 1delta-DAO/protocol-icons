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
 * Midnight collateral legs are per-market wrapper tokens (`wsrUSD-USDC-collat`
 * and friends) that the token list carries a symbol for but no logo, so most
 * markets have at least one unresolvable leg. Rather than drop those markets,
 * an unresolved token renders as the neutral `unknownAssetBuffer` chip and the
 * rest of the card is drawn normally — one unknown leg costs that leg, not the
 * whole icon.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - A market is skipped only if it has no collateral legs at all
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
  unknownAssetBuffer,
  outPath,
} from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  /** Markets drawn with at least one placeholder leg. */
  placeholdered: number
  /** Markets with nothing drawable at all. */
  unrenderable: number
}

const newStats = (): Stats => ({
  total: 0,
  created: 0,
  skipped: 0,
  failed: 0,
  placeholdered: 0,
  unrenderable: 0,
})

// ─── Per-chain processing ────────────────────────────────────────────────────

async function processChain(
  chainId: string,
  markets: MidnightMarketConfig[],
  badge: Buffer,
  placeholder: Buffer,
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

    // An unresolved token becomes the placeholder chip instead of killing the
    // market; `unknown` collects what was substituted, for the log line.
    const unknown: string[] = []
    const resolve = (addr: string): string | Buffer => {
      const token = tokenMap[addr]
      if (token?.logoURI) return token.logoURI
      unknown.push(token?.symbol || addr.slice(0, 10))
      return placeholder
    }

    const loanLogo = resolve(loanAddr)
    const collLogos = market.collateralParams.map((c) =>
      resolve(c.token?.toLowerCase() ?? ''),
    )

    // Nothing to slice the collateral half into — the layout needs at least one.
    if (collLogos.length === 0) {
      console.log(`    ~ ${market.name ?? market.marketId}: no collateral legs`)
      stats.unrenderable++
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
        collLogos, // collateral slices (left half)
        loanLogo, //  loan (right half)
        badge, //     black-and-white Midnight badge
        filePath,
      )
      stats.created++
      if (unknown.length > 0) stats.placeholdered++
      const note = unknown.length > 0 ? `  [placeholder: ${unknown.join(', ')}]` : ''
      console.log(`    + ${market.name ?? enumName} → ${enumName}.webp${note}`)
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

  // Badge and placeholder are deterministic — render once, reuse everywhere.
  const badge = await morphoMidnightBadgeBuffer()
  const placeholder = await unknownAssetBuffer()

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
    const s = await processChain(chainId, markets, badge, placeholder, force)
    grand.total += s.total
    grand.created += s.created
    grand.skipped += s.skipped
    grand.failed += s.failed
    grand.placeholdered += s.placeholdered
    grand.unrenderable += s.unrenderable
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:   ${grand.total}`)
  console.log(`  Icons created:   ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  With placeholder: ${grand.placeholdered}`)
  console.log(`  Unrenderable:    ${grand.unrenderable}`)
  console.log(`  Failed:          ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
