#!/usr/bin/env tsx
/**
 * Fluid Vault Icon Generator
 *
 * Fetches Fluid vault metadata for all chains from the lender-metadata repo,
 * resolves token logos via the delta token list, and generates split-half
 * market icons with the local Fluid badge overlay.
 *
 *   npm run generate:fluid
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists)
 *   - Errors on one chain don't stop other chains
 *   - Errors on one vault don't stop other vaults
 *   - Missing badge file aborts cleanly with a helpful message
 */

import fs from 'fs'
import { chainName, FLUID_BADGE_PATH } from './config.js'
import { fetchTokenMap, type TokenMap } from './tokenList.js'
import {
  fetchFluidVaults,
  fluidVaultEnumName,
  type FluidVault,
  type FluidVaultsByChain,
} from './fluidVaults.js'
import { mergeSplitWithBadge, outPath } from './iconMerger.js'

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

// Fluid uses the EIP-7528 native placeholder; our token lists key native as zero address.
const NATIVE_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const normalizeAsset = (addr?: string): string | undefined => {
  const a = addr?.toLowerCase()
  return a === NATIVE_PLACEHOLDER ? ZERO_ADDRESS : a
}

// ─── Per-chain processing ────────────────────────────────────────────────────

async function processChain(
  chainId: string,
  vaults: Record<string, FluidVault>,
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

  const vaultEntries = Object.entries(vaults)
  console.log(`  [${name}] fluid: ${vaultEntries.length} vaults, ${Object.keys(tokenMap).length} tokens`)

  for (const [, vault] of vaultEntries) {
    stats.total++

    // Use first supply asset as left (collateral), first borrow asset as right (debt)
    const supplyAsset = normalizeAsset(vault.supply?.assets?.[0]?.underlying)
    const borrowAsset = normalizeAsset(vault.borrow?.assets?.[0]?.underlying)
    if (!supplyAsset || !borrowAsset) continue

    const supplyToken = tokenMap[supplyAsset]
    const borrowToken = tokenMap[borrowAsset]
    const supplyLogo = supplyToken?.logoURI
    const borrowLogo = borrowToken?.logoURI

    if (!supplyLogo || !borrowLogo) {
      stats.missingLogos++
      continue
    }

    const enumName = fluidVaultEnumName(chainId, vault.vaultId)
    const filePath = outPath(enumName)

    if (!force && fs.existsSync(filePath)) {
      stats.skipped++
      continue
    }

    try {
      await mergeSplitWithBadge(supplyLogo, borrowLogo, FLUID_BADGE_PATH, filePath, {
        badgePadding: 2,
      })
      stats.created++
      const supplySymbol = supplyToken?.symbol ?? '?'
      const borrowSymbol = borrowToken?.symbol ?? '?'
      console.log(`    + ${supplySymbol}/${borrowSymbol} (vault ${vault.vaultId}) → ${enumName}.webp`)
    } catch (err) {
      stats.failed++
      console.error(`    ! ${enumName}: ${(err as Error).message}`)
    }
  }

  return stats
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(FLUID_BADGE_PATH)) {
    console.error(`Fluid badge missing at ${FLUID_BADGE_PATH}`)
    console.error(`Place a circular fluid.webp in lender/ before running.`)
    process.exit(1)
  }

  const force = process.argv.includes('--force')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Fluid Icon Generator — ${new Date().toISOString()}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let byChain: FluidVaultsByChain
  try {
    byChain = await fetchFluidVaults()
  } catch (err) {
    console.error(`Fluid: ${(err as Error).message}`)
    process.exit(1)
  }

  const chainIds = Object.keys(byChain)
  console.log(`\nFluid: ${chainIds.length} chains`)

  const grand = newStats()
  for (const chainId of chainIds) {
    const vaults = byChain[chainId] ?? {}
    if (Object.keys(vaults).length === 0) continue
    const stats = await processChain(chainId, vaults, force)
    grand.total += stats.total
    grand.created += stats.created
    grand.skipped += stats.skipped
    grand.failed += stats.failed
    grand.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Vaults found:    ${grand.total}`)
  console.log(`  Icons created:   ${grand.created}`)
  console.log(`  Already existed: ${grand.skipped}`)
  console.log(`  Missing logos:   ${grand.missingLogos}`)
  console.log(`  Failed:          ${grand.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
