#!/usr/bin/env tsx
/**
 * Solana Lending Icon Generator
 *
 * One icon per Solana lender key, in the layouts the EVM generators already
 * use for the same market shapes:
 *
 *   KAMINO / SAVE / PROJECT_0   pooled, cross-margined baskets (Aave v4 spoke
 *                               shape): cluster of the MAX_CLUSTER largest
 *                               reserves by deposits, or a split card when
 *                               only two resolve
 *   JUPITER_LEND                collateral | debt split card (Fluid shape)
 *   LOOPSCALE                   collateral | principal split card (Midnight
 *                               pair shape); an unresolved leg renders as the
 *                               neutral `unknownAssetBuffer` chip
 *
 *   badge = lender/<brand>.webp (kamino, jupiter_lend, save, loopscale,
 *           project_0), top-right, ringed in white like the Aave v4 icons —
 *           every Solana brand mark is a dark tile.
 *
 *   npm run generate:solana
 *   npm run generate:solana -- --force             # re-render existing icons
 *   SOLANA_LENDERS=KAMINO,SAVE npm run generate:solana
 *
 * Output filenames are `<lenderKey.toLowerCase()>.webp`, which is what the app
 * and yield-tracer's `/lending/lenders` resolve.
 *
 * Safety:
 *   - Never overwrites an existing icon (skip if file exists, unless --force)
 *   - A market with no loadable art at all is skipped (the brand badge is
 *     the fallback); a dead logo host falls back to Jupiter's art for the mint
 *   - Errors on one market don't stop other markets
 *   - Missing brand badge aborts cleanly with a helpful message
 */

import fs from 'fs'
import { SVM_LENDERS } from '@1delta/margin-fetcher-sol'
import {
  fetchSolanaMarkets,
  jupiterLogo,
  solanaBrandEnumName,
  solanaEnumName,
  type SolanaAsset,
  type SolanaMarket,
} from './solanaMarkets.js'
import {
  mergeSplitWithBadge,
  mergeClusterWithBadge,
  unknownAssetBuffer,
  loadImageBuffer,
  outPath,
} from './iconMerger.js'

/** Most reserve chips a cluster shows — beyond four they stop being readable. */
const MAX_CLUSTER = 4

/** Same badge treatment as the Aave v4 spokes: no inner padding, 4px white ring. */
const BADGE_CFG = { badgePadding: 0, badgeRing: 4 } as const

interface Stats {
  total: number
  created: number
  skipped: number
  failed: number
  missingLogos: number
}

const newStats = (): Stats => ({ total: 0, created: 0, skipped: 0, failed: 0, missingLogos: 0 })

type Drawn = { kind: 'split' | 'cluster'; srcs: Buffer[]; symbols: string[] }

// ─── Art loading ─────────────────────────────────────────────────────────────

/**
 * Candidate URLs for one logo. Solana token art lives on IPFS / Arweave / Irys
 * far more than on CDNs, and the public ipfs.io gateway rate-limits a run of
 * a few hundred icons within seconds, so an IPFS logo gets other gateways too.
 */
function urlCandidates(url: string): string[] {
  const m = /^https?:\/\/[^/]+\/ipfs\/(.+)$/.exec(url)
  if (!m) return [url]
  return [url, `https://dweb.link/ipfs/${m[1]}`, `https://gateway.pinata.cloud/ipfs/${m[1]}`]
}

/** URL → art, once per run: the same USDC / JLP / USDS logo backs dozens of markets. */
const urlCache = new Map<string, Promise<Buffer | undefined>>()

function loadUrl(url: string): Promise<Buffer | undefined> {
  let p = urlCache.get(url)
  if (!p) {
    p = (async () => {
      for (const candidate of urlCandidates(url)) {
        try {
          return await loadImageBuffer(candidate)
        } catch {
          // next candidate
        }
      }
      return undefined
    })()
    urlCache.set(url, p)
  }
  return p
}

/** Mint → art: the row's logo, then Jupiter's art when that host is dead. */
const mintCache = new Map<string, Promise<Buffer | undefined>>()

function loadArt(asset: SolanaAsset): Promise<Buffer | undefined> {
  let p = mintCache.get(asset.mint)
  if (!p) {
    p = (async () => {
      const own = asset.logoURI ? await loadUrl(asset.logoURI) : undefined
      if (own) return own
      const jup = await jupiterLogo(asset.mint)
      return jup && jup !== asset.logoURI ? loadUrl(jup) : undefined
    })()
    mintCache.set(asset.mint, p)
  }
  return p
}

/** Pair families: the two legs, a placeholder chip for an unresolved one. */
async function drawPair(market: SolanaMarket): Promise<Drawn | undefined> {
  const { collateral, debt } = market.pair!
  const coll = market.assets.find((a) => a.mint === collateral)
  const loan = market.assets.find((a) => a.mint === debt)
  const [collArt, loanArt] = await Promise.all([
    coll ? loadArt(coll) : undefined,
    loan ? loadArt(loan) : undefined,
  ])
  if (!collArt && !loanArt) return undefined
  const placeholder = await unknownAssetBuffer()
  return {
    kind: 'split',
    srcs: [collArt ?? placeholder, loanArt ?? placeholder],
    symbols: [coll?.symbol || collateral.slice(0, 4), loan?.symbol || debt.slice(0, 4)],
  }
}

/**
 * Pooled families: the largest reserves by deposits, skipping those whose art
 * does not load — a pool's long tail is what lacks logos, so its leading
 * assets survive. One chip per mint (a Project 0 mint has several banks).
 */
async function drawPool(market: SolanaMarket): Promise<Drawn | undefined> {
  const ranked = market.assets
    .map((a, i) => ({ a, i }))
    // largest first; roster order breaks ties (dead pools are all zero)
    .sort((x, y) => y.a.totalDepositsUSD - x.a.totalDepositsUSD || x.i - y.i)
    .map(({ a }) => a)
  const srcs: Buffer[] = []
  const symbols: string[] = []
  const seen = new Set<string>()
  for (const a of ranked) {
    if (srcs.length >= MAX_CLUSTER) break
    if (seen.has(a.mint)) continue
    seen.add(a.mint)
    const art = await loadArt(a)
    if (!art) continue
    srcs.push(art)
    symbols.push(a.symbol || a.mint.slice(0, 4))
  }
  if (srcs.length === 0) return undefined
  return { kind: srcs.length === 2 ? 'split' : 'cluster', srcs, symbols }
}

async function processMarket(market: SolanaMarket, force: boolean, stats: Stats): Promise<void> {
  stats.total++

  const enumName = solanaEnumName(market.lenderKey)
  const filePath = outPath(enumName)
  if (!force && fs.existsSync(filePath)) {
    stats.skipped++
    return
  }

  const drawn = market.pair ? await drawPair(market) : await drawPool(market)
  if (!drawn) {
    console.log(`    ~ ${market.lenderKey} (${market.name}): no asset art resolved`)
    stats.missingLogos++
    return
  }

  const badgePath = outPath(solanaBrandEnumName(market.brand))
  try {
    if (drawn.kind === 'split') {
      await mergeSplitWithBadge(drawn.srcs[0], drawn.srcs[1], badgePath, filePath, BADGE_CFG)
    } else {
      await mergeClusterWithBadge(drawn.srcs, badgePath, filePath, BADGE_CFG)
    }
    stats.created++
    console.log(`    + ${market.name}: ${drawn.symbols.join(' ')} → ${enumName}.webp`)
  } catch (err) {
    stats.failed++
    console.error(`    ! ${enumName} (${market.name}): ${(err as Error).message}`)
  }
}

async function main() {
  const force = process.argv.includes('--force')
  const families = (process.env.SOLANA_LENDERS?.split(',') ?? SVM_LENDERS)
    .map((s: string) => s.trim().toUpperCase())
    .filter(Boolean)

  const missingBadges = families.filter((f) => !fs.existsSync(outPath(solanaBrandEnumName(f))))
  if (missingBadges.length > 0) {
    for (const f of missingBadges) console.error(`Badge missing at ${outPath(solanaBrandEnumName(f))}`)
    console.error(`Place a circular <brand>.webp in lender/ (npm run crop) before running.`)
    process.exit(1)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Solana Icon Generator — ${new Date().toISOString()}`)
  console.log(`Families: ${families.join(', ')}`)
  if (force) console.log('Force mode: existing icons will be overwritten.')
  console.log('='.repeat(60))

  let markets: SolanaMarket[]
  try {
    markets = await fetchSolanaMarkets(families)
  } catch (err) {
    console.error('Failed to fetch Solana markets:', (err as Error).message)
    process.exit(1)
  }

  if (markets.length === 0) {
    console.error('Solana fetch returned no markets — nothing to generate.')
    process.exit(1)
  }

  // Base58 is case-significant but the icon stem is lower-cased: refuse to
  // let two keys silently share one file.
  const seen = new Map<string, string>()
  for (const m of markets) {
    const stem = solanaEnumName(m.lenderKey)
    const prev = seen.get(stem)
    if (prev && prev !== m.lenderKey) {
      console.error(`Icon name collision: ${prev} and ${m.lenderKey} both → ${stem}.webp`)
      process.exit(1)
    }
    seen.set(stem, m.lenderKey)
  }

  const byBrand = new Map<string, SolanaMarket[]>()
  for (const m of markets) {
    const list = byBrand.get(m.brand)
    if (list) list.push(m)
    else byBrand.set(m.brand, [m])
  }

  const totals = newStats()
  for (const [brand, list] of byBrand) {
    console.log(`\n  [${brand}] ${list.length} markets`)
    const stats = newStats()
    for (const m of list) await processMarket(m, force, stats)
    totals.total += stats.total
    totals.created += stats.created
    totals.skipped += stats.skipped
    totals.failed += stats.failed
    totals.missingLogos += stats.missingLogos
  }

  console.log(`\nSummary:`)
  console.log(`  Markets found:   ${totals.total}`)
  console.log(`  Icons created:   ${totals.created}`)
  console.log(`  Already existed: ${totals.skipped}`)
  console.log(`  Missing logos:   ${totals.missingLogos}`)
  console.log(`  Failed:          ${totals.failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
