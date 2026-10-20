#!/usr/bin/env tsx
/**
 * Resupply Icon Generator
 *
 * One card per Resupply pair (lender key `RESUPPLY_1_<PAIR>`), the split-half
 * layout of the Fraxlend / LlamaLend / Curvance generators:
 *
 *   left half  = the WRAPPED market's collateral (wstETH, sDOLA, sUSDe, …)
 *   right half = the pair's underlying — the token the user deposits
 *                (crvUSD on CurveLend pairs, frxUSD on Fraxlend pairs)
 *   badge      = lender/resupply.webp, top-right
 *
 * That pairing is deliberate and matches the labels lender-metadata writes
 * ("Resupply CurveLend: crvUSD/wstETH"): Resupply's own two rows are reUSD /
 * crvUSD on every CurveLend pair, so a card drawn from them would be the same
 * picture 16 times. What tells pairs apart is the market being wrapped.
 *
 * The roster is discovered on-chain from `ResupplyRegistry.getAllPairAddresses()`
 * (Resupply has no metadata file — see data-sdk `resupply.ts`). Retired pairs
 * (`borrowLimit == 0`) are included on purpose: positions in them still render.
 * Per pair:
 *   pair.collateral()              → the ERC-4626 share (CurveLend vault / Fraxlend pair)
 *   pair.underlying()              → crvUSD / frxUSD
 *   share.collateral_token()       → CurveLend: the market's collateral
 *   share.collateralContract()     → Fraxlend:  the pair's collateral
 *
 *   npm run generate:resupply
 *   npm run generate:resupply -- --force     # re-render existing icons
 *
 * Safety: never overwrites (unless --force), one failing pair never stops the
 * rest, and a pair with a missing logo is skipped rather than half-drawn.
 */

import fs from "fs";
import { createPublicClient, http, fallback, type Address } from "viem";
import { mainnet } from "viem/chains";
import { fetchTokenMap } from "./tokenList.js";
import { mergeSplitWithBadge, outPath } from "./iconMerger.js";

const CHAIN_ID = "1";
const REGISTRY: Address = "0x10101010E0C3171D894B71B3400668aF311e7D94";

const ETHEREUM_RPCS = [
  "https://gateway.tenderly.co/public/mainnet",
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.mevblocker.io",
  "https://eth.llamarpc.com",
];

const addrFn = (name: string) =>
  ({
    name,
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  }) as const;

const REGISTRY_ABI = [
  {
    name: "getAllPairAddresses",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
] as const;
const PAIR_ABI = [addrFn("collateral"), addrFn("underlying")] as const;
const CURVE_VAULT_ABI = [addrFn("collateral_token")] as const;
const FRAXLEND_ABI = [addrFn("collateralContract")] as const;

/** The raw lender key lower-cased — the name yield-tracer's `logo_uri` uses. */
export const resupplyEnumName = (pair: string): string =>
  `resupply_${CHAIN_ID}_${pair.replace(/^0x/i, "").toLowerCase()}`;

interface ResupplyPairLegs {
  pair: Address;
  marketCollateral: Address;
  underlying: Address;
}

async function discover(): Promise<ResupplyPairLegs[]> {
  const pc = createPublicClient({
    chain: mainnet,
    transport: fallback(ETHEREUM_RPCS.map((u) => http(u))),
  });
  const pairs = (await pc.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getAllPairAddresses",
  })) as readonly Address[];

  const out: ResupplyPairLegs[] = [];
  for (const pair of pairs) {
    try {
      const [share, underlying] = await Promise.all([
        pc.readContract({
          address: pair,
          abi: PAIR_ABI,
          functionName: "collateral",
        }),
        pc.readContract({
          address: pair,
          abi: PAIR_ABI,
          functionName: "underlying",
        }),
      ]);
      // CurveLend vault first, then Fraxlend pair — a vault reverts on the
      // other's getter, so the first one that answers names the family.
      let marketCollateral: Address | undefined;
      try {
        marketCollateral = await pc.readContract({
          address: share,
          abi: CURVE_VAULT_ABI,
          functionName: "collateral_token",
        });
      } catch {
        marketCollateral = await pc.readContract({
          address: share,
          abi: FRAXLEND_ABI,
          functionName: "collateralContract",
        });
      }
      out.push({ pair, marketCollateral, underlying });
    } catch (e) {
      console.log(
        `    ! ${pair}: legs unreadable — ${(e as Error).message?.split("\n")[0]}`,
      );
    }
  }
  return out;
}

async function main() {
  const badgePath = outPath("resupply");
  if (!fs.existsSync(badgePath)) {
    console.error(`Resupply badge missing at ${badgePath}`);
    process.exit(1);
  }
  const force = process.argv.includes("--force");

  const [pairs, tokens] = await Promise.all([
    discover(),
    fetchTokenMap(CHAIN_ID),
  ]);
  console.log(`Resupply: ${pairs.length} pairs`);

  let created = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;
  for (const p of pairs) {
    const coll = tokens[p.marketCollateral.toLowerCase()];
    const under = tokens[p.underlying.toLowerCase()];
    const enumName = resupplyEnumName(p.pair);
    const label = `${under?.symbol ?? p.underlying}/${coll?.symbol ?? p.marketCollateral}`;
    if (!coll?.logoURI || !under?.logoURI) {
      console.log(
        `    ~ ${label}: no logo for ${[
          !coll?.logoURI && p.marketCollateral,
          !under?.logoURI && p.underlying,
        ]
          .filter(Boolean)
          .join(", ")}`,
      );
      missing++;
      continue;
    }
    const filePath = outPath(enumName);
    if (!force && fs.existsSync(filePath)) {
      skipped++;
      continue;
    }
    try {
      await mergeSplitWithBadge(
        coll.logoURI,
        under.logoURI,
        badgePath,
        filePath,
        {
          badgePadding: 2,
        },
      );
      created++;
      console.log(`    + ${label} → ${enumName}.webp`);
    } catch (e) {
      failed++;
      console.error(`    ! ${enumName}: ${(e as Error).message}`);
    }
  }
  console.log(
    `\nResupply: created ${created}, existed ${skipped}, missing logos ${missing}, failed ${failed}`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
