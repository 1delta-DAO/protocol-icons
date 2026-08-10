#!/usr/bin/env tsx
/**
 * Lista DAO (Moolah) Icon Generator
 *
 * Moolah is a Morpho Blue fork, but its icons are NOT produced by the Morpho
 * run (`npm run generate`): the lender key, the badge and the data source all
 * differ, so it gets its own entry point — the same split-half layout as the
 * LlamaLend / TermMax / River generators:
 *
 *   left half  = collateral token
 *   right half = loan token
 *   badge      = lender/lista.webp, top-right
 *
 *   npm run generate:lista
 *   npm run generate:lista -- --force     # re-render existing icons
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - Errors on one chain/market don't stop the others
 *   - A market is skipped if either token logo is missing (a half-blank card is
 *     worse than the lender-badge fallback)
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchListaMarkets,
  listaEnumName,
  type ListaMarket,
} from './listaMarkets.js'
import { lltvToBpsSuperscript, mergeSplitWithBadge, outPath } from './iconMerger.js'

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
  markets: ListaMarket[],
  badgePath: string,
  force: boolean,
): Promise<Stats> {
  const stats = newStats()
  const name = chainName(chainId)

  let tokenMap: TokenMap
  try {
    tokenMap = await fetchTokenMap(chainId)
  } catch (err) {
    console.error(
      `  [${name}] Failed to fetch token list:`,
      (err as Error).message,
    )
    return stats
  }

  console.log(
    `  [${name}] lista: ${markets.length} markets, ${Object.keys(tokenMap).length} tokens`,
  )

  for (const market of markets) {
    stats.total++

    const collToken = tokenMap[market.collateralToken]
    const loanToken = tokenMap[market.loanToken]
    const collLogo = collToken?.logoURI
    const loanLogo = loanToken?.logoURI

    if (!collLogo || !loanLogo) {
      const missing = [
        !collLogo && market.collateralToken,
        !loanLogo && market.loanToken,
      ]
        .filter(Boolean)
        .join(', ')
      console.log(`    ~ ${market.id.slice(0, 10)}: no logo for ${missing}`)
      stats.missingLogos++
      continue
    }

    const enumName = listaEnumName(market.id)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      // left half = collateral, right half = loan token, badge = Lista
      await mergeSplitWithBadge(collLogo, loanLogo, badgePath, filePath)
      stats.created++
      const display = `Lista ${collToken.symbol}-${loanToken.symbol}${lltvToBpsSuperscript(market.lltv)}`
      console.log(`    + ${display} → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const badgePath = outPath('lista')
  if (!fs.existsSync(badgePath)) {
    console.error(`Lista badge missing at ${badgePath}`)
    console.error(`Place a circular lista.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Lista (Moolah) Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: Record<string, ListaMarket[]>
  try {
    byChain = await fetchListaMarkets()
  } catch (err) {
    console.error(`Lista: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nLista: ${chainIds.length} chains`)

  const grand = newStats()
  for (const chainId of chainIds) {
    const markets = byChain[chainId] ?? []
    if (markets.length === 0) continue
    const stats = await processChain(chainId, markets, badgePath, force)
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
