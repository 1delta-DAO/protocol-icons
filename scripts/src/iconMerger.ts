/**
 * Icon generation utilities.
 *
 * Creates split-half market icons:
 *   left half  = collateral token
 *   right half = loan token
 *   badge      = Morpho Blue protocol icon (top-right)
 *
 * All output is WebP. Intermediate work is PNG for lossless compositing.
 */

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { formatEther } from 'viem'
import nodeFetch from 'node-fetch'
import { ICON_DEFAULTS, MORPHO_BADGE_URL, MORPHO_W_SVG_PATH } from './config.js'

// ─── Output directory ────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(import.meta.dirname ?? '.', '../../lender')

export function outPath(filename: string): string {
  return path.join(OUTPUT_DIR, `${filename}.webp`)
}

// ─── Image loading ───────────────────────────────────────────────────────────

// node-fetch is used instead of Node's undici `fetch` because some CDNs
// (notably Coingecko's assets host) intermittently ETIMEDOUT against undici
// on certain networks; node-fetch's default stack avoids this.
export async function loadImageBuffer(source: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source
  if (!source.startsWith('http')) return fs.promises.readFile(source)

  const MAX_ATTEMPTS = 3
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await nodeFetch(source)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
  }
  throw new Error(`Failed to fetch ${source}: ${(lastErr as Error).message}`)
}

// ─── SVG circle mask ─────────────────────────────────────────────────────────

function circleSVG(size: number): Buffer {
  const r = size / 2
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${r}" cy="${r}" r="${r}" fill="white" />
     </svg>`,
  )
}

// ─── LLTV superscript ────────────────────────────────────────────────────────

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074',
  '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
}

export function lltvToBpsSuperscript(lltv: string): string {
  const pct = Number(formatEther(BigInt(lltv))) * 100
  const bps = Math.round(pct * 100)
  return String(bps)
    .split('')
    .map((c) => SUPERSCRIPT_DIGITS[c] ?? '')
    .join('')
}

// ─── Badge ring ──────────────────────────────────────────────────────────────

/**
 * Wrap an already-circular badge in a white ring of `ring` px.
 *
 * The badge sits on top of the market artwork, and on a dark logo a dark badge
 * reads as a smudge rather than a mark; the ring gives it an edge to hold onto.
 * Returns the input untouched when `ring <= 0`, so every existing caller keeps
 * byte-identical output.
 */
async function withBadgeRing(badge: Buffer, dim: number, ring: number): Promise<Buffer> {
  if (ring <= 0) return badge

  const outer = dim + ring * 2
  const disc = await sharp({
    create: {
      width: outer,
      height: outer,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: circleSVG(outer), blend: 'dest-in' }])
    .png()
    .toBuffer()

  return sharp(disc)
    .composite([{ input: badge, left: ring, top: ring }])
    .png()
    .toBuffer()
}

// ─── Split-half merge with badge ─────────────────────────────────────────────

export interface MergeConfig {
  diameter: number
  centerPadding: number
  badgeSize: { width: number; height: number }
  badgePadding: number
  badgeOffsetX: number
  badgeOffsetY: number
  /**
   * Thickness, in px, of a white ring drawn around the badge to lift it off the
   * artwork underneath. 0 (the default) keeps the historical look: the badge is
   * composited as-is, with only whatever white `badgePadding` backs it.
   */
  badgeRing: number
}

const DEFAULT_MERGE_CONFIG: MergeConfig = {
  diameter: ICON_DEFAULTS.diameter,
  centerPadding: ICON_DEFAULTS.centerPadding,
  badgeSize: { ...ICON_DEFAULTS.badgeSize },
  badgePadding: ICON_DEFAULTS.badgePadding,
  badgeOffsetX: ICON_DEFAULTS.badgeOffsetX,
  badgeOffsetY: ICON_DEFAULTS.badgeOffsetY,
  badgeRing: 0,
}

/**
 * Merge two token icons (split left/right) with a protocol badge overlay.
 * Writes the result as a WebP file.
 */
export async function mergeSplitWithBadge(
  leftSrc: string | Buffer,
  rightSrc: string | Buffer,
  badgeSrc: string | Buffer | null,
  outputFile: string,
  config: Partial<MergeConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_MERGE_CONFIG, ...config }
  const { diameter, centerPadding, badgeSize, badgePadding, badgeOffsetX, badgeOffsetY, badgeRing } = cfg
  const half = Math.floor(diameter / 2)

  // Load sources in parallel; badge may be omitted for badge-less icons.
  const [lb, rb, bb] = await Promise.all([
    loadImageBuffer(leftSrc),
    loadImageBuffer(rightSrc),
    badgeSrc ? loadImageBuffer(badgeSrc) : Promise.resolve(null),
  ])

  // Letterbox into a square viewbox so non-square logos aren't cropped by the half-extract.
  const squareOpts = {
    fit: 'contain' as const,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }
  const [lRes, rRes] = await Promise.all([
    sharp(lb).resize(diameter, diameter, squareOpts).png().toBuffer(),
    sharp(rb).resize(diameter, diameter, squareOpts).png().toBuffer(),
  ])

  // Extract halves
  const leftHalf = await sharp(lRes).extract({ left: 0, top: 0, width: half, height: diameter }).toBuffer()
  const rightHalf = await sharp(rRes).extract({ left: half, top: 0, width: half, height: diameter }).toBuffer()

  // Merge halves on transparent canvas
  const merged = await sharp({
    create: { width: diameter, height: diameter, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: leftHalf, left: 0, top: 0 },
      { input: rightHalf, left: half, top: 0 },
    ])
    .png()
    .toBuffer()

  // Circular crop the merged image
  const center = await sharp(merged)
    .composite([{ input: circleSVG(diameter), blend: 'dest-in' }])
    .png()
    .toBuffer()

  // Prepare circular badge (optional)
  const padW = badgeSize.width + badgePadding * 2
  const padH = badgeSize.height + badgePadding * 2
  const badgeImg = bb
    ? await sharp({
        create: { width: padW, height: padH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite([
          {
            input: await sharp(bb)
              .resize(badgeSize.width, badgeSize.height, squareOpts)
              .png()
              .toBuffer(),
            left: badgePadding,
            top: badgePadding,
          },
          { input: circleSVG(padW), blend: 'dest-in' },
        ])
        .png()
        .toBuffer()
    : null
  const ringedBadge = badgeImg ? await withBadgeRing(badgeImg, padW, badgeRing) : null
  const badgeDim = padW + badgeRing * 2

  // Final composite
  const canvasSize = diameter + centerPadding * 2
  const composites: sharp.OverlayOptions[] = [
    { input: center, left: centerPadding, top: centerPadding },
  ]
  if (ringedBadge) {
    composites.push({
      input: ringedBadge,
      left: canvasSize - badgeDim - badgeOffsetX,
      top: centerPadding + badgeOffsetY,
    })
  }
  const final = await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .webp()
    .toBuffer()

  // Ensure output directory exists, then write
  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, final)
}

// ─── Multi-collateral merge (sliced collateral half) ─────────────────────────

/**
 * Merge a Morpho Midnight market icon.
 *
 * Layout is the same split-half card as `mergeSplitWithBadge`, except the
 * collateral half (left) is subdivided into one vertical slice per collateral
 * leg. With a single collateral this is pixel-identical to the Blue layout;
 * with N collaterals the left half is split into N equal columns, each showing
 * the corresponding portion of that collateral's logo.
 *
 *   [ coll₀ | coll₁ | … | collₙ₋₁ |      loan      ]
 *
 * `badgeSrc` is composited directly (no white backing ring) so a self-contained
 * circular badge — e.g. `morphoMidnightBadgeBuffer()` — renders as-is.
 */
export async function mergeMultiCollateralWithBadge(
  collateralSrcs: Array<string | Buffer>,
  loanSrc: string | Buffer,
  badgeSrc: string | Buffer | null,
  outputFile: string,
  config: Partial<MergeConfig> = {},
): Promise<void> {
  if (collateralSrcs.length === 0) {
    throw new Error('mergeMultiCollateralWithBadge: no collateral sources')
  }

  const cfg = { ...DEFAULT_MERGE_CONFIG, ...config }
  const { diameter, centerPadding, badgePadding, badgeOffsetX, badgeOffsetY } = cfg
  const half = Math.floor(diameter / 2)

  const squareOpts = {
    fit: 'contain' as const,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }

  // Load + letterbox every source into a square viewbox.
  const [loanBuf, ...collBufs] = await Promise.all([
    loadImageBuffer(loanSrc),
    ...collateralSrcs.map((s) => loadImageBuffer(s)),
  ])
  const loanSquare = await sharp(loanBuf)
    .resize(diameter, diameter, squareOpts)
    .png()
    .toBuffer()
  const collSquares = await Promise.all(
    collBufs.map((b) =>
      sharp(b).resize(diameter, diameter, squareOpts).png().toBuffer(),
    ),
  )

  // Right half = loan token.
  const loanHalf = await sharp(loanSquare)
    .extract({ left: half, top: 0, width: diameter - half, height: diameter })
    .toBuffer()

  const composites: sharp.OverlayOptions[] = [
    { input: loanHalf, left: half, top: 0 },
  ]

  // Left half = N collateral columns. Integer boundaries avoid seams/gaps.
  const n = collSquares.length
  for (let i = 0; i < n; i++) {
    const x0 = Math.round((i * half) / n)
    const x1 = Math.round(((i + 1) * half) / n)
    const width = x1 - x0
    if (width <= 0) continue
    const slice = await sharp(collSquares[i])
      .extract({ left: x0, top: 0, width, height: diameter })
      .toBuffer()
    composites.push({ input: slice, left: x0, top: 0 })
  }

  const merged = await sharp({
    create: {
      width: diameter,
      height: diameter,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  // Circular crop.
  const center = await sharp(merged)
    .composite([{ input: circleSVG(diameter), blend: 'dest-in' }])
    .png()
    .toBuffer()

  // Self-contained circular badge, composited directly (top-right).
  const badgeBuf = badgeSrc ? await loadImageBuffer(badgeSrc) : null
  const badgeDim = cfg.badgeSize.width + badgePadding * 2
  const badgeImg = badgeBuf
    ? await sharp(badgeBuf)
        .resize(badgeDim, badgeDim, squareOpts)
        .png()
        .toBuffer()
    : null

  const canvasSize = diameter + centerPadding * 2
  const finalComposites: sharp.OverlayOptions[] = [
    { input: center, left: centerPadding, top: centerPadding },
  ]
  if (badgeImg) {
    finalComposites.push({
      input: badgeImg,
      left: canvasSize - badgeDim - badgeOffsetX,
      top: centerPadding + badgeOffsetY,
    })
  }

  const final = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(finalComposites)
    .webp()
    .toBuffer()

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, final)
}

// ─── Stacked-collateral merge (scaled-to-fit collateral legs) ────────────────

/**
 * Merge a market icon whose collateral is a basket (an LP token, a wrapper over
 * one, …) with the loan token on the right half.
 *
 *   [  coll₀  |                ]
 *   [ ------- |      loan      ]
 *   [  collₙ  |                ]
 *
 * Unlike `mergeMultiCollateralWithBadge`, which extracts one vertical *slice*
 * per leg out of a full-size logo, each leg here is scaled to fit its own band
 * so the whole logo stays legible. Bands are sized against the circle's actual
 * width at that height, so no leg is clipped by the circular crop.
 *
 * `badgeSrc` is composited directly (no white backing ring), matching
 * `mergeMultiCollateralWithBadge` — pass a self-contained circular badge.
 */
export async function mergeStackedCollateralWithBadge(
  collateralSrcs: Array<string | Buffer>,
  loanSrc: string | Buffer,
  badgeSrc: string | Buffer | null,
  outputFile: string,
  config: Partial<MergeConfig> = {},
): Promise<void> {
  if (collateralSrcs.length === 0) {
    throw new Error('mergeStackedCollateralWithBadge: no collateral sources')
  }

  const cfg = { ...DEFAULT_MERGE_CONFIG, ...config }
  const { diameter, centerPadding, badgePadding, badgeOffsetX, badgeOffsetY } = cfg
  const half = Math.floor(diameter / 2)
  const radius = diameter / 2

  const squareOpts = {
    fit: 'contain' as const,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }

  const [loanBuf, ...collBufs] = await Promise.all([
    loadImageBuffer(loanSrc),
    ...collateralSrcs.map((s) => loadImageBuffer(s)),
  ])

  // Right half = loan token, same as every other layout.
  const loanSquare = await sharp(loanBuf)
    .resize(diameter, diameter, squareOpts)
    .png()
    .toBuffer()
  const loanHalf = await sharp(loanSquare)
    .extract({ left: half, top: 0, width: diameter - half, height: diameter })
    .toBuffer()

  const composites: sharp.OverlayOptions[] = [{ input: loanHalf, left: half, top: 0 }]

  // Left half = one scaled-to-fit band per leg.
  const n = collBufs.length
  const bandHeight = diameter / n
  // Leave a hair of breathing room so bands don't touch each other or the rim.
  const INSET = 0.9

  for (let i = 0; i < n; i++) {
    const bandCenterY = (i + 0.5) * bandHeight
    // Width the circle actually offers at this height, on the left of the seam.
    const dy = Math.abs(bandCenterY - radius)
    const available = Math.sqrt(Math.max(radius * radius - dy * dy, 0))
    const size = Math.floor(Math.min(bandHeight, available) * INSET)
    if (size <= 0) continue

    const leg = await sharp(collBufs[i])
      .resize(size, size, squareOpts)
      .png()
      .toBuffer()
    const meta = await sharp(leg).metadata()
    const w = meta.width ?? size
    const h = meta.height ?? size

    composites.push({
      input: leg,
      // Centered in the circle's usable span at this height, not in the band —
      // that keeps the logo clear of the rim near the top and bottom.
      left: Math.round(half - available / 2 - w / 2),
      top: Math.round(bandCenterY - h / 2),
    })
  }

  const merged = await sharp({
    create: {
      width: diameter,
      height: diameter,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  // Circular crop.
  const center = await sharp(merged)
    .composite([{ input: circleSVG(diameter), blend: 'dest-in' }])
    .png()
    .toBuffer()

  // Self-contained circular badge, composited directly (top-right).
  const badgeBuf = badgeSrc ? await loadImageBuffer(badgeSrc) : null
  const badgeDim = cfg.badgeSize.width + badgePadding * 2
  const badgeImg = badgeBuf
    ? await sharp(badgeBuf).resize(badgeDim, badgeDim, squareOpts).png().toBuffer()
    : null

  const canvasSize = diameter + centerPadding * 2
  const finalComposites: sharp.OverlayOptions[] = [
    { input: center, left: centerPadding, top: centerPadding },
  ]
  if (badgeImg) {
    finalComposites.push({
      input: badgeImg,
      left: canvasSize - badgeDim - badgeOffsetX,
      top: centerPadding + badgeOffsetY,
    })
  }

  const final = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(finalComposites)
    .webp()
    .toBuffer()

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, final)
}

// ─── Reserve-cluster merge (pool icons, no collateral/loan pair) ─────────────

/**
 * Merge a *pool* icon: N reserve logos arranged as a cluster inside the circle,
 * with a protocol badge on top-right.
 *
 * Unlike every other layout here, this one does NOT model a collateral/loan
 * pair — it exists for lenders whose market is a basket of reserves that are
 * all borrowable against each other (Aave v4 spokes). There is no meaningful
 * left/right split to make, so each reserve gets its own circular chip:
 *
 *   n=2   [ (a) (b) ]        side by side
 *   n=3   [ (a) (b) / (c) ]  triangle, apex up
 *   n=4   [ (a)(b) / (c)(d) ] 2x2 grid
 *
 * Chips are laid out on a ring of radius `d` around the centre, sized so that
 * neighbours just touch before a `CHIP_GAP` shrink is applied, and so that no
 * chip crosses the outer circle:
 *
 *   r = R·sin(π/n) / (1 + sin(π/n)),   d = R − r
 *
 * `badgeSrc` is composited directly (no white backing ring), matching
 * `mergeMultiCollateralWithBadge` — pass a self-contained circular badge.
 */
export async function mergeClusterWithBadge(
  srcs: Array<string | Buffer>,
  badgeSrc: string | Buffer | null,
  outputFile: string,
  config: Partial<MergeConfig> = {},
): Promise<void> {
  if (srcs.length === 0) {
    throw new Error('mergeClusterWithBadge: no sources')
  }

  const cfg = { ...DEFAULT_MERGE_CONFIG, ...config }
  const { diameter, centerPadding, badgePadding, badgeOffsetX, badgeOffsetY, badgeRing } = cfg
  const radius = diameter / 2

  const squareOpts = {
    fit: 'contain' as const,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }

  const bufs = await Promise.all(srcs.map((s) => loadImageBuffer(s)))
  const n = bufs.length

  // Chip radius / ring radius. A single chip fills the circle outright.
  const sin = Math.sin(Math.PI / n)
  const chipR = n === 1 ? radius : (radius * sin) / (1 + sin)
  const ringR = n === 1 ? 0 : radius - chipR

  // A 2x2 grid reads better than a diamond, so start 4-chip clusters at 135°.
  const startAngle = n === 4 ? (-3 * Math.PI) / 4 : -Math.PI / 2

  // Shrink each chip slightly so neighbours have visible breathing room.
  const CHIP_GAP = 0.94
  const chipDim = Math.max(2, Math.round(chipR * 2 * CHIP_GAP))

  const chips = await Promise.all(
    bufs.map(async (b) => {
      // Letterbox onto white, then circular-crop: a chip is a mini token icon.
      const square = await sharp(b)
        .resize(chipDim, chipDim, squareOpts)
        .flatten({ background: '#ffffff' })
        .ensureAlpha()
        .png()
        .toBuffer()
      return sharp(square)
        .composite([{ input: circleSVG(chipDim), blend: 'dest-in' }])
        .png()
        .toBuffer()
    }),
  )

  const composites: sharp.OverlayOptions[] = chips.map((chip, i) => {
    const angle = startAngle + (i * 2 * Math.PI) / n
    const cx = radius + ringR * Math.cos(angle)
    const cy = radius + ringR * Math.sin(angle)
    return {
      input: chip,
      left: Math.round(cx - chipDim / 2),
      top: Math.round(cy - chipDim / 2),
    }
  })

  const center = await sharp({
    create: {
      width: diameter,
      height: diameter,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  // Badge: cropped to a circle to guarantee clean edges, then optionally ringed.
  const discDim = cfg.badgeSize.width + badgePadding * 2
  const badgeDim = discDim + badgeRing * 2
  const bb = badgeSrc ? await loadImageBuffer(badgeSrc) : null
  const badgeImg = bb
    ? await withBadgeRing(
        await sharp(
          await sharp(bb).resize(discDim, discDim, squareOpts).png().toBuffer(),
        )
          .composite([{ input: circleSVG(discDim), blend: 'dest-in' }])
          .png()
          .toBuffer(),
        discDim,
        badgeRing,
      )
    : null

  const canvasSize = diameter + centerPadding * 2
  const finalComposites: sharp.OverlayOptions[] = [
    { input: center, left: centerPadding, top: centerPadding },
  ]
  if (badgeImg) {
    finalComposites.push({
      input: badgeImg,
      left: canvasSize - badgeDim - badgeOffsetX,
      top: centerPadding + badgeOffsetY,
    })
  }

  const final = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(finalComposites)
    .webp()
    .toBuffer()

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, final)
}

// ─── Morpho Midnight badge (black-and-white morpho glyph) ────────────────────

/**
 * Render the black-and-white "Midnight" badge: the white Morpho glyph centered
 * on a dark circle. Returns a self-contained circular PNG buffer ready to pass
 * as `badgeSrc` to `mergeMultiCollateralWithBadge`.
 */
export async function morphoMidnightBadgeBuffer(
  size = ICON_DEFAULTS.badgeSize.width + ICON_DEFAULTS.badgePadding * 2,
): Promise<Buffer> {
  const r = size / 2
  const ring = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${r}" cy="${r}" r="${r - 1}" fill="#0a0a0a" stroke="#ffffff" stroke-width="2"/>
     </svg>`,
  )

  // Morpho glyph is ~74×69; scale to ~58% of the badge, keep aspect ratio.
  const glyphSize = Math.round(size * 0.58)
  const glyph = await sharp(MORPHO_W_SVG_PATH)
    .resize(glyphSize, glyphSize, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer()
  const glyphMeta = await sharp(glyph).metadata()
  const gw = glyphMeta.width ?? glyphSize
  const gh = glyphMeta.height ?? glyphSize

  return sharp(ring)
    .composite([
      {
        input: glyph,
        left: Math.round((size - gw) / 2),
        top: Math.round((size - gh) / 2),
      },
    ])
    .png()
    .toBuffer()
}

/**
 * Write the standalone dark "Midnight" base icon (used as the generic
 * `morpho_midnight.webp` fallback when a market-specific icon is missing).
 * Same dark circle + white glyph as the badge, at full icon size, as WebP.
 */
export async function writeMorphoMidnightBaseIcon(
  outputFile: string,
  size = 200,
): Promise<void> {
  const badge = await morphoMidnightBadgeBuffer(size)
  const webp = await sharp(badge).webp().toBuffer()
  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, webp)
}

// ─── Roman numeral badge (SVG → PNG buffer) ─────────────────────────────────

const ROMAN_BY_INT: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }

export function toRoman(n: number): string {
  return ROMAN_BY_INT[n] ?? String(n)
}

/**
 * Render a dark circular badge with a centered Roman numeral as a PNG buffer.
 * Ready to be passed as the `badgeSrc` argument of `mergeSplitWithBadge`.
 */
export async function romanNumeralBadgeBuffer(
  numeral: string,
  size = ICON_DEFAULTS.badgeSize.width,
): Promise<Buffer> {
  const r = size / 2
  // Font size shrinks slightly for wider numerals so "III" still fits.
  const fontScale = numeral.length >= 3 ? 0.55 : numeral.length === 2 ? 0.7 : 0.8
  const fontSize = Math.round(size * fontScale)
  // librsvg ignores `dominant-baseline`, so position the baseline manually.
  // ~0.35 * fontSize below the geometric center lands a capital glyph's
  // visual center on the circle's center.
  const baselineY = r + fontSize * 0.35
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${r}" cy="${r}" r="${r - 1}" fill="#1a1a1a" stroke="#ffffff" stroke-width="2"/>
       <text x="${r}" y="${baselineY}" text-anchor="middle"
             font-family="Georgia, 'Times New Roman', serif"
             font-size="${fontSize}" font-weight="bold" fill="#ffffff">${numeral}</text>
     </svg>`,
  )
  return sharp(svg).png().toBuffer()
}

// ─── Circular crop (standalone) ──────────────────────────────────────────────

/**
 * Circularly crop an icon and write as WebP with transparent outside.
 */
export async function circularCropIcon(
  inputSrc: string,
  outputFile: string,
  size = ICON_DEFAULTS.diameter,
): Promise<void> {
  const buf = await loadImageBuffer(inputSrc)
  const meta = await sharp(buf).metadata()
  if (!meta.width || !meta.height) throw new Error('Image has no dimensions')

  // Resize to square (contain + transparent pad) so the circle mask aligns.
  const square = await sharp(buf)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .png()
    .toBuffer()

  const result = await sharp(square)
    .composite([{ input: circleSVG(size), blend: 'dest-in' }])
    .webp()
    .toBuffer()

  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, result)
}

// ─── Convenience: build enum name from market hash ───────────────────────────

export function marketEnumName(uniqueKey: string): string {
  return `morpho_blue_${uniqueKey.slice(2).toLowerCase()}`
}

export function marketDisplayName(
  collateralSymbol: string,
  loanSymbol: string,
  lltv: string,
): string {
  return `Morpho ${collateralSymbol}-${loanSymbol}${lltvToBpsSuperscript(lltv)}`
}

export { MORPHO_BADGE_URL }
