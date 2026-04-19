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
import { ICON_DEFAULTS, MORPHO_BADGE_URL } from './config.js'

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

// ─── Split-half merge with badge ─────────────────────────────────────────────

export interface MergeConfig {
  diameter: number
  centerPadding: number
  badgeSize: { width: number; height: number }
  badgePadding: number
  badgeOffsetX: number
  badgeOffsetY: number
}

const DEFAULT_MERGE_CONFIG: MergeConfig = {
  diameter: ICON_DEFAULTS.diameter,
  centerPadding: ICON_DEFAULTS.centerPadding,
  badgeSize: { ...ICON_DEFAULTS.badgeSize },
  badgePadding: ICON_DEFAULTS.badgePadding,
  badgeOffsetX: ICON_DEFAULTS.badgeOffsetX,
  badgeOffsetY: ICON_DEFAULTS.badgeOffsetY,
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
  const { diameter, centerPadding, badgeSize, badgePadding, badgeOffsetX, badgeOffsetY } = cfg
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

  // Final composite
  const canvasSize = diameter + centerPadding * 2
  const composites: sharp.OverlayOptions[] = [
    { input: center, left: centerPadding, top: centerPadding },
  ]
  if (badgeImg) {
    composites.push({
      input: badgeImg,
      left: canvasSize - padW - badgeOffsetX,
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
