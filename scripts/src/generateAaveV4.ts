#!/usr/bin/env tsx
/**
 * Aave v4 Icon Generator
 *
 * Reads the published Aave v4 spoke roster, resolves each spoke's reserve
 * logos from the delta token list, and renders one icon per spoke.
 *
 * An Aave v4 spoke is a basket of mutually-borrowable reserves, not a
 * collateral/loan pair, so the layout differs from every other generator here:
 *
 *   2 reserves  → split-half card (left | right), same as Morpho/Twyne/etc.
 *                 Pair spokes are genuinely pairs — Lido is wstETH|WETH, Kelp
 *                 is rsETH|WETH — and the split reads better at icon size.
 *   3+ reserves → cluster of the first MAX_CLUSTER reserve logos, in reserveId
 *                 order, which is the order the spoke was configured in and
 *                 puts its defining assets first (Gold leads with XAUt, Ethena
 *                 with PT-USDe, Main with WETH).
 *
 *   badge       = lender/aave_v4.webp, top-right, on both layouts, ringed in
 *                 white so the dark badge stays readable over dark artwork
 *                 (the Ethena spokes are near-black chips edge to edge)
 *
 *   npm run generate:aave-v4
 *   npm run generate:aave-v4 -- --force     # re-render existing icons
 *
 * Output filenames are `aave_v4_<spokeAddress>.webp` — no chain segment, which
 * is the convention the existing hand-made icons established.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - A spoke is skipped if fewer than MIN_LOGOS of its reserves resolve to a
 *     logo (a mostly-blank cluster is worse than the lender-badge fallback)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one spoke don't stop other spokes
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { AAVE_V4_BADGE_PATH, chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchAaveV4Spokes,
  spokeUnderlyings,
  aaveV4EnumName,
  type AaveV4Spoke,
} from './aaveV4Spokes.js'
import { mergeSplitWithBadge, mergeClusterWithBadge, outPath } from './iconMerger.js'

/** Most reserve chips a cluster shows — beyond four they stop being readable. */
const MAX_CLUSTER = 4

/** Fewest resolvable logos worth rendering an icon from. */
const MIN_LOGOS = 2

/**
 * Badge treatment, shared by both layouts so the mark sits identically however
 * the market underneath is drawn: no white padding inside the disc, a 4px white
 * ring outside it.
 */
const BADGE_CFG = { badgePadding: 0, badgeRing: 4 } as const

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

async function processChain(
  chainId: string,
  spokes: AaveV4Spoke[],
  badgePath: string,
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
    `  [${name}] aave v4: ${spokes.length} spokes, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const spoke of spokes) {
    stats.total++

    const underlyings = spokeUnderlyings(spoke)

    // Keep reserve order, drop what has no logo — a spoke's later reserves are
    // the long tail, so the leading assets survive a partial token list.
    const resolved = underlyings
      .map((addr) => ({ addr, token: tokenMap[addr] }))
      .filter((e) => Boolean(e.token?.logoURI))

    if (resolved.length < MIN_LOGOS) {
      const have = resolved.length
      console.log(
        `    ~ ${spoke.label}: only ${have}/${underlyings.length} reserve logos resolved`,
      )
      stats.missingLogos++
      continue
    }

    const enumName = aaveV4EnumName(spoke.spoke)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    const picked = resolved.slice(0, MAX_CLUSTER)
    const logos = picked.map((e) => e.token!.logoURI!)
    const symbols = picked.map((e) => e.token!.symbol || e.addr.slice(0, 8))

    try {
      if (logos.length === 2) {
        await mergeSplitWithBadge(logos[0], logos[1], badgePath, filePath, BADGE_CFG)
      } else {
        await mergeClusterWithBadge(logos, badgePath, filePath, BADGE_CFG)
      }
      stats.created++

      const dropped = resolved.length - picked.length
      const suffix = dropped > 0 ? ` (+${dropped} more)` : ''
      console.log(`    + ${spoke.label}: ${symbols.join(' ')}${suffix} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName} (${spoke.label}): ${(err as Error).message}`)
    }
  }

  return stats
}

async function main() {
  const badgePath = AAVE_V4_BADGE_PATH
  if (!fs.existsSync(badgePath)) {
    console.error(`Aave v4 badge missing at ${badgePath}`)
    console.error(`Place a circular aave_v4.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Aave v4 Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let spokes: AaveV4Spoke[]
  try {
    spokes = await fetchAaveV4Spokes()
  } catch (err) {
    console.error('Failed to fetch Aave v4 spoke roster:', (err as Error).message)
    process.exit(1)
  }

  if (spokes.length === 0) {
    console.error('Spoke roster is empty — nothing to generate.')
    process.exit(1)
  }

  // Group by chain so the token list is fetched once per chain.
  const byChain = new Map<string, AaveV4Spoke[]>()
  for (const s of spokes) {
    const list = byChain.get(s.chainId)
    if (list) list.push(s)
    else byChain.set(s.chainId, [s])
  }

  console.log(`Configured spokes: ${spokes.length} across ${byChain.size} chains`)

  const totals = newStats()
  for (const [chainId, chainSpokes] of byChain) {
    const stats = await processChain(chainId, chainSpokes, badgePath, force)
    totals.total += stats.total
    totals.created += stats.created
    totals.skipped += stats.skipped
    totals.failed += stats.failed
    totals.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Spokes found:    ${totals.total}`)
  console.log(`  Icons created:   ${totals.created}`)
  console.log(`  Already existed: ${totals.skipped}`)
  console.log(`  Missing logos:   ${totals.missingLogos}`)
  console.log(`  Failed:          ${totals.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
