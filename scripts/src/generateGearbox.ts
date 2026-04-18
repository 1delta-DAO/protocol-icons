#!/usr/bin/env tsx
/**
 * Gearbox V3 Icon Generator
 *
 * Fetches Gearbox V3 credit manager labels from the lender-metadata repo,
 * resolves the quote-symbol token logo via the delta token list, and renders
 * split-half icons:
 *
 *   left half  = Gearbox core icon (lender/gearbox_v3.webp)
 *   right half = quote currency logo
 *   badge      = Roman-numeral tier (I / II / III) in a dark circle, top-right
 *
 *   npm run generate:gearbox
 *   npm run generate:gearbox -- --force      # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one market don't stop other markets
 *   - Missing core icon aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName, GEARBOX_CORE_ICON_PATH } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchGearboxCreditManagers,
  gearboxEnumName,
  tokensBySymbol,
  type GearboxCreditManager,
} from './gearboxCreditManagers.js'
import {
  mergeSplitWithBadge,
  outPath,
  romanNumeralBadgeBuffer,
  toRoman,
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
  managers: GearboxCreditManager[],
  coreIconBuf: Buffer,
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

  const bySymbol = tokensBySymbol(tokenMap)
  console.log(
    `  [${name}] gearbox v3: ${managers.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const cm of managers) {
    stats.total++

    const token = bySymbol[cm.symbol.toLowerCase()]
    const logo = token?.logoURI
    if (!logo) {
      stats.missingLogos++
      console.warn(`    ? ${cm.label}: no logo for symbol ${cm.symbol} on ${name}`)
      continue
    }

    const enumName = gearboxEnumName(cm.address)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      const badgeBuf = cm.tier
        ? await romanNumeralBadgeBuffer(toRoman(cm.tier))
        : null

      await mergeSplitWithBadge(coreIconBuf, logo, badgeBuf, filePath, {
        badgePadding: 2,
      })

      stats.created++
      const tierTxt = cm.tier ? ` Tier ${cm.tier}` : ''
      console.log(`    + ${cm.symbol}${tierTxt} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(GEARBOX_CORE_ICON_PATH)) {
    console.error(`Gearbox core icon missing at ${GEARBOX_CORE_ICON_PATH}`)
    console.error(`Place gearbox_v3.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Gearbox V3 Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let managers: GearboxCreditManager[]
  try {
    managers = await fetchGearboxCreditManagers()
  } catch (err) {
    console.error(`Gearbox: ${(err as Error).message}`)
    process.exit(1)
  }

  if (managers.length === 0) {
    console.log('No Gearbox V3 credit managers found.')
    return
  }

  // Preload the core icon once — it's shared across every output.
  const coreIconBuf = await fs.promises.readFile(GEARBOX_CORE_ICON_PATH)

  // Group by chain for ordered logging.
  const byChain = new Map<string, GearboxCreditManager[]>()
  for (const m of managers) {
    const arr = byChain.get(m.chainId) ?? []
    arr.push(m)
    byChain.set(m.chainId, arr)
  }

  console.log(`\nGearbox V3: ${byChain.size} chains, ${managers.length} credit managers`)

  const grand = newStats()
  for (const [chainId, cms] of byChain) {
    const stats = await processChain(chainId, cms, coreIconBuf, force)
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
