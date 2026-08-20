/**
 * Aave v4 spoke roster.
 *
 * Aave v4 splits a lender into a Hub (liquidity) and Spokes (markets). A spoke
 * is NOT a collateral/loan pair like a Morpho market — it is a basket of
 * reserves that are all borrowable against each other, so the icon it gets is a
 * cluster of its reserve logos rather than a split-half card.
 *
 * Source is the published `aave-v4-spokes.json` from 1delta's lender-metadata
 * repo (see `AAVE_V4_SPOKES_URL`) — the same file the app reads, which is what
 * keeps `aave_v4_<spoke>` icon names in lockstep with the lender keys it emits.
 *
 * Only spokes that actually carry reserves are returned: the roster also lists
 * deployed-but-empty spokes (`reserves: []`, placeholder `Spoke 0xabcd..ef01`
 * label), and there is nothing to draw for those.
 */

import { AAVE_V4_SPOKES_URL } from './config.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AaveV4Reserve {
  reserveId: number
  assetId: number
  /** Underlying token address (lowercase). */
  underlying: string
  /** Hub this reserve draws liquidity from. */
  hub: string
}

export interface AaveV4Spoke {
  chainId: string
  /** Spoke address (lowercase) — the identity in the icon filename. */
  spoke: string
  /** Human label, e.g. 'Main', 'Lido', 'Ethena Correlated'. */
  label: string
  /** Hub family: AAVE_V4_CORE | AAVE_V4_PLUS | AAVE_V4_PRIME | AAVE_V4_ETHERFI. */
  baseHubAttribution: string
  reserves: AaveV4Reserve[]
}

// ─── Naming ──────────────────────────────────────────────────────────────────

/**
 * Icon filename stem for a spoke: `aave_v4_<address without 0x>`.
 *
 * No chain segment — that is the convention the hand-made icons already in
 * `lender/` established, and spoke addresses don't collide across chains.
 */
export function aaveV4EnumName(spoke: string): string {
  return `aave_v4_${spoke.replace(/^0x/i, '').toLowerCase()}`
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

/** Empty-spoke placeholder labels look like `Spoke 0xb9b0..3155`. */
const PLACEHOLDER_LABEL = /^Spoke 0x[0-9a-f]{4}\.\.[0-9a-f]{4}$/i

export async function fetchAaveV4Spokes(): Promise<AaveV4Spoke[]> {
  const res = await fetch(AAVE_V4_SPOKES_URL)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching spoke roster`)
  }

  const json = (await res.json()) as Record<string, Record<string, any>>
  const out: AaveV4Spoke[] = []

  for (const [chainId, spokes] of Object.entries(json)) {
    if (!spokes || typeof spokes !== 'object') continue

    for (const [addr, raw] of Object.entries(spokes)) {
      const reserves: AaveV4Reserve[] = Array.isArray(raw?.reserves)
        ? raw.reserves
            .filter((r: any) => typeof r?.underlying === 'string')
            .map((r: any) => ({
              reserveId: Number(r.reserveId ?? 0),
              assetId: Number(r.assetId ?? 0),
              underlying: String(r.underlying).toLowerCase(),
              hub: String(r.hub ?? '').toLowerCase(),
            }))
        : []

      // Deployed-but-unconfigured spoke — nothing to draw.
      if (reserves.length === 0) continue

      const spoke = String(raw?.spoke ?? addr).toLowerCase()
      const rawLabel = String(raw?.label ?? '').trim()

      out.push({
        chainId,
        spoke,
        label: rawLabel && !PLACEHOLDER_LABEL.test(rawLabel) ? rawLabel : shortAddr(spoke),
        baseHubAttribution: String(raw?.baseHubAttribution ?? ''),
        reserves: reserves.sort((a, b) => a.reserveId - b.reserveId),
      })
    }
  }

  return out
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Reserve underlyings in `reserveId` order, deduplicated.
 *
 * A spoke can list the same underlying twice when it is served by two different
 * hubs (Bluechip carries USDC and USDT once per hub); the icon should show that
 * token once.
 */
export function spokeUnderlyings(spoke: AaveV4Spoke): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of spoke.reserves) {
    if (seen.has(r.underlying)) continue
    seen.add(r.underlying)
    out.push(r.underlying)
  }
  return out
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`
}
