#!/usr/bin/env tsx
/**
 * Flex Icon Generator
 *
 * One card per Flex market (lender key `FLEX_<chainId>_<TROVE_MANAGER>`), the
 * same split-half layout as the Alchemix / Fraxlend generators:
 *
 *   left half  = collateral — the market's Yearn vault share
 *   right half = the borrow token (USDC / WETH)
 *   badge      = lender/flex.webp, top-right
 *
 *   npm run generate:flex
 *   npm run generate:flex -- --force     # re-render existing icons
 *
 * The roster is the endorsed markets of lending-sdks' data-sdk seed
 * (`packages/data-sdk/src/lending/flex.ts`). Collateral logos fall back to
 * Yearn's own tokenAssets until the delta token list publishes the vault rows.
 */

import fs from "fs";
import { chainName } from "./config.js";
import { fetchTokenMap, type TokenMap } from "./tokenList.js";
import { mergeSplitWithBadge, outPath } from "./iconMerger.js";

interface FlexMarket {
  chainId: string;
  troveManager: string;
  collateral: string;
  borrowToken: string;
  label: string;
}

const MARKETS: FlexMarket[] = [
  {
    chainId: "1",
    troveManager: "0x8ee72c388aA73096338EE18CD46a39D98b8983c9",
    collateral: "0x696d02Db93291651ED510704c9b286841d506987",
    borrowToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    label: "USDC / yvUSD",
  },
  {
    chainId: "1",
    troveManager: "0xADf4E0226d59aac20272023c04B4DcF5Ade7Fc6E",
    collateral: "0x23346B04a7f55b8760E5860AA5A77383D63491cD",
    borrowToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    label: "USDC / ysyBOLD",
  },
  {
    chainId: "1",
    troveManager: "0x7582b47486F75F5D675f260d357972cD0DbEeA2E",
    collateral: "0xBF319dDC2Edc1Eb6FDf9910E39b37Be221C8805F",
    borrowToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    label: "USDC / yvcrvUSD-2",
  },
  {
    chainId: "1",
    troveManager: "0xEe27D81Bd4f54bA978e5dC0C335fC25C00e8334C",
    collateral: "0xAc37729B76db6438CE62042AE1270ee574CA7571",
    borrowToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    label: "WETH / yvWETH-2",
  },
];

const yearnLogo = (chainId: string, token: string) =>
  `https://raw.githubusercontent.com/yearn/tokenAssets/main/tokens/${chainId}/${token.toLowerCase()}/logo-128.png`;

/** The raw lender key lower-cased — the name yield-tracer's `logo_uri` uses. */
export const flexEnumName = (chainId: string, troveManager: string): string =>
  `flex_${chainId}_${troveManager.replace(/^0x/i, "").toLowerCase()}`;

async function main() {
  const badgePath = outPath("flex");
  if (!fs.existsSync(badgePath)) {
    console.error(`Flex badge missing at ${badgePath}`);
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const maps: Record<string, TokenMap> = {};
  for (const m of MARKETS) {
    const name = chainName(m.chainId);
    try {
      maps[m.chainId] ??= await fetchTokenMap(m.chainId);
    } catch (err) {
      console.error(`  [${name}] token list: ${(err as Error).message}`);
      failed++;
      continue;
    }
    const tokens = maps[m.chainId];
    const collLogo =
      tokens[m.collateral.toLowerCase()]?.logoURI ?? yearnLogo(m.chainId, m.collateral);
    const debtLogo =
      tokens[m.borrowToken.toLowerCase()]?.logoURI ?? yearnLogo(m.chainId, m.borrowToken);
    const filePath = outPath(flexEnumName(m.chainId, m.troveManager));
    if (!force && fs.existsSync(filePath)) {
      skipped++;
      continue;
    }
    try {
      await mergeSplitWithBadge(collLogo, debtLogo, badgePath, filePath, {
        badgePadding: 2,
      });
      console.log(`    + [${name}] ${m.label}`);
      created++;
    } catch (err) {
      console.error(`    ! [${name}] ${m.label}: ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`flex: ${created} created, ${skipped} skipped, ${failed} failed`);
}

main();
