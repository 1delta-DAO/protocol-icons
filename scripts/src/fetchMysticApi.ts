// ============================================================================
// Mystic Finance API fetcher (Morpho Blue fork on Flare/Plume/Citrea/etc.)
//
// Endpoints:
//   - https://api.mysticfinance.xyz/morphoCache/?chainId=<id>      (full)
//   - https://api.mysticfinance.xyz/morphoCache/lite?chainId=<id>  (lite)
//
// We prefer the "full" endpoint because it carries IRM, token decimals, and
// exact loan/collateral addresses on each market — which the downstream
// Morpho pipeline needs (the lite endpoint only has symbols + LLTV).
//
// Output is reshaped to match the unified item shape consumed by
// MorphoBlueUpdater (same as the Morpho API and the Goldsky subgraph path).
// ============================================================================

const FULL_URL = "https://api.mysticfinance.xyz/morphoCache/";

export const MYSTIC_CHAIN_IDS = new Set<string>([
  "14", // Flare
  "98866", // Plume
  "4114", // Citrea
]);

export function hasMysticApi(chainId: string): boolean {
  return MYSTIC_CHAIN_IDS.has(chainId);
}

interface MysticTokenMeta {
  pair?: string;
  asset?: string;
  decimals?: number;
}

interface MysticVaultRefRaw {
  /** Vault address — sometimes "vault", sometimes "address". */
  vault?: string;
  address?: string;
  pair?: string;
  symbol?: string;
  /** Single curator name on the full endpoint. */
  curator?: string;
  /** Curator list on the lite endpoint. */
  curators?: string[];
  coCurators?: string[];
}

interface MysticMarketFullRaw {
  marketId: string;
  chainId: number;
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  /** Mystic returns lltv as decimal (e.g. 0.77). */
  lltv: number;
  asset?: MysticTokenMeta;
  collateral?: MysticTokenMeta;
  vaults?: MysticVaultRefRaw[];
}

interface MysticVaultFullRaw {
  address: string;
  asset: string;
  /** ERC4626 vault name. */
  name?: string;
  /** Asset symbol — used as a fallback when `name` is missing. */
  assetSymbol?: string;
  curatorName?: string;
  coCurators?: string[];
}

interface MysticFullResponse {
  markets: MysticMarketFullRaw[];
  vaults: MysticVaultFullRaw[];
  updatedAt?: string;
}

function curatorEntry(name: string) {
  return { id: name, image: "", verified: false, name };
}

/** Convert Mystic's decimal lltv (e.g. 0.625) into raw 18-decimal string. */
function lltvToWad(lltvDecimal: number): string {
  if (!Number.isFinite(lltvDecimal)) return "0";
  // Use BigInt arithmetic to preserve full 18-decimal precision.
  const scaled = BigInt(Math.round(lltvDecimal * 1e9));
  return (scaled * 10n ** 9n).toString();
}

function dedupCurators(names: (string | undefined)[]) {
  const seen = new Map<string, ReturnType<typeof curatorEntry>>();
  for (const name of names) {
    if (!name) continue;
    if (!seen.has(name)) seen.set(name, curatorEntry(name));
  }
  return Array.from(seen.values());
}

/**
 * Fetch markets from the Mystic Finance full cache endpoint and reshape them
 * into the format MorphoBlueUpdater consumes (same as the official Morpho
 * API and the Goldsky subgraph path).
 */
export async function fetchMarketsFromMysticApi(
  chainId: string,
): Promise<{ markets: { items: any[] } }> {
  const res = await fetch(`${FULL_URL}?chainId=${chainId}`);
  if (!res.ok) {
    throw new Error(
      `Mystic API error for chain ${chainId}: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as MysticFullResponse;
  const markets = body.markets ?? [];
  const vaults = body.vaults ?? [];

  // Build a lookup of curators per vault address — vault refs on a market
  // sometimes only carry the address, so we fall back to the vault list.
  const curatorsByVault = new Map<string, string[]>();
  for (const v of vaults) {
    const names: string[] = [];
    if (v.curatorName) names.push(v.curatorName);
    for (const c of v.coCurators ?? []) names.push(c);
    if (names.length) curatorsByVault.set(v.address.toLowerCase(), names);
  }

  const items = markets.map((m) => {
    const loanAddr = (m.loanToken ?? "").toLowerCase();
    const collateralAddr = (m.collateralToken ?? "").toLowerCase();

    const refCurators: string[] = [];
    for (const ref of m.vaults ?? []) {
      if (ref.curator) refCurators.push(ref.curator);
      for (const name of ref.curators ?? []) refCurators.push(name);
      for (const name of ref.coCurators ?? []) refCurators.push(name);
      const addr = (ref.vault ?? ref.address ?? "").toLowerCase();
      if (addr) {
        const fromVault = curatorsByVault.get(addr) ?? [];
        for (const name of fromVault) refCurators.push(name);
      }
    }
    const curators = dedupCurators(refCurators);

    return {
      uniqueKey: m.marketId,
      lltv: lltvToWad(m.lltv),
      oracleAddress: m.oracle,
      irm: m.irm,
      whitelisted: true,
      loanAsset: {
        address: loanAddr,
        symbol: m.asset?.pair,
        decimals: m.asset?.decimals,
      },
      collateralAsset: {
        address: collateralAddr,
        symbol: m.collateral?.pair,
        decimals: m.collateral?.decimals,
      },
      supplyingVaults:
        curators.length > 0 ? [{ state: { curators } }] : undefined,
    };
  });

  return { markets: { items } };
}
