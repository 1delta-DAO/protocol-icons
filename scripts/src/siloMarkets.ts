/**
 * Silo v2 / v3 market fetcher.
 *
 * Source: 1delta-DAO/lender-metadata GitHub repo.
 *   data/silo-v2-markets.json
 *   data/silo-v3-markets.json
 *
 * Both files share the same shape:
 *   { [chainId]: SiloMarket[] }
 */

const SILO_METADATA_URL = (version: SiloVersion) =>
  `https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/silo-${version}-markets.json`

export type SiloVersion = 'v2' | 'v3'

export interface SiloLeg {
  silo: string
  token: string
  decimals: number
  symbol: string
}

export interface SiloMarket {
  siloConfig: string
  name: string
  silo0: SiloLeg
  silo1: SiloLeg
}

export type SiloMarketsByChain = Record<string, SiloMarket[]>

/** Fetch the full Silo metadata file for the given protocol version. */
export async function fetchSiloMarkets(version: SiloVersion): Promise<SiloMarketsByChain> {
  const res = await fetch(SILO_METADATA_URL(version))
  if (!res.ok) {
    throw new Error(`Silo ${version} metadata fetch failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as SiloMarketsByChain
}

/** Build the canonical lender-key filename (lower-cased, no .webp). */
export function siloMarketEnumName(version: SiloVersion, siloConfig: string): string {
  return `silo_${version}_${siloConfig.replace(/^0x/i, '').toLowerCase()}`
}
