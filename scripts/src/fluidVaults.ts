/**
 * Fluid vault metadata fetcher.
 *
 * Source: 1delta-DAO/lender-metadata GitHub repo.
 *   data/fluid-vaults.json
 *
 * Shape:
 *   { [chainId]: { [vaultAddress]: FluidVault } }
 */

const FLUID_METADATA_URL =
  'https://raw.githubusercontent.com/1delta-DAO/lender-metadata/main/data/fluid-vaults.json'

export interface FluidAsset {
  underlying: string
  fToken: string | null
}

export interface FluidVaultSide {
  assets: FluidAsset[]
  dex: string | null
  smartLending: string | null
}

export interface FluidVault {
  borrow: FluidVaultSide
  supply: FluidVaultSide
  type: number
  vaultId: number
}

export type FluidVaultsByChain = Record<string, Record<string, FluidVault>>

/** Fetch the full Fluid vault metadata file. */
export async function fetchFluidVaults(): Promise<FluidVaultsByChain> {
  const res = await fetch(FLUID_METADATA_URL)
  if (!res.ok) {
    throw new Error(`Fluid metadata fetch failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as FluidVaultsByChain
}

/** Build the canonical lender-key filename: fluid_<chainId>_<vaultId> */
export function fluidVaultEnumName(chainId: string, vaultId: number): string {
  return `fluid_${chainId}_${vaultId}`
}
