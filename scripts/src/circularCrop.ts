#!/usr/bin/env tsx
/**
 * Circular-crop CLI for quick manual icon additions.
 *
 * Usage:
 *   npm run crop -- <input> [output]
 *   npm run crop -- icon.png                     # → icon.webp (same dir)
 *   npm run crop -- icon.png lender/my_icon.webp # explicit output
 *   npm run crop -- https://example.com/icon.png lender/my_icon.webp
 *
 * - Accepts local files or URLs
 * - Output defaults to the input filename with .webp extension
 * - Always produces a circular-cropped transparent WebP
 */

import path from 'path'
import { circularCropIcon } from './iconMerger.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  Circular Crop - quickly crop an icon into a circle

  Usage:
    npm run crop -- <input> [output]

  Arguments:
    input   Path or URL to the source image
    output  Output .webp path (default: input with .webp extension)

  Examples:
    npm run crop -- logo.png
    npm run crop -- logo.png lender/my_protocol.webp
    npm run crop -- https://example.com/logo.png lender/my_protocol.webp
    `)
    process.exit(0)
  }

  const input = args[0]
  let output = args[1]

  if (!output) {
    // Derive output from input: same name, .webp extension
    if (input.startsWith('http')) {
      console.error('Error: output path is required when input is a URL')
      process.exit(1)
    }
    const parsed = path.parse(input)
    output = path.join(parsed.dir, `${parsed.name}.webp`)
  }

  // Auto-append .webp if missing
  if (!output.toLowerCase().endsWith('.webp')) {
    output = `${output}.webp`
  }

  // Resolve relative paths against cwd
  output = path.resolve(process.cwd(), output)

  console.log(`Cropping: ${input}`)
  console.log(`Output:   ${output}`)

  await circularCropIcon(input, output)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Crop failed:', err.message ?? err)
  process.exit(1)
})
