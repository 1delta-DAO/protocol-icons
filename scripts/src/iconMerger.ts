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
import { ICON_DEFAULTS, MORPHO_BADGE_URL } from './config.js'

// ─── Output directory ────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(import.meta.dirname ?? '.', '../../lender')

export function outPath(filename: string): string {
  return path.join(OUTPUT_DIR, `${filename}.webp`)
}

// ─── Image loading ───────────────────────────────────────────────────────────

export async function loadImageBuffer(source: string): Promise<Buffer> {
  if (source.startsWith('http')) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.statusText}`)
    return Buffer.from(await res.arrayBuffer())
  }
  return fs.promises.readFile(source)
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
  leftSrc: string,
  rightSrc: string,
  badgeSrc: string,
  outputFile: string,
  config: Partial<MergeConfig> = {},
): Promise<void> {
  const cfg = { ...DEFAULT_MERGE_CONFIG, ...config }
  const { diameter, centerPadding, badgeSize, badgePadding, badgeOffsetX, badgeOffsetY } = cfg
  const half = Math.floor(diameter / 2)

  // Load all three images in parallel
  const [lb, rb, bb] = await Promise.all([
    loadImageBuffer(leftSrc),
    loadImageBuffer(rightSrc),
    loadImageBuffer(badgeSrc),
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

  // Prepare circular badge with white background
  const padW = badgeSize.width + badgePadding * 2
  const padH = badgeSize.height + badgePadding * 2
  const badgeImg = await sharp({
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

  // Final composite
  const canvasSize = diameter + centerPadding * 2
  const final = await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: center, left: centerPadding, top: centerPadding },
      { input: badgeImg, left: canvasSize - padW - badgeOffsetX, top: centerPadding + badgeOffsetY },
    ])
    .webp()
    .toBuffer()

  // Ensure output directory exists, then write
  await fs.promises.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.promises.writeFile(outputFile, final)
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
