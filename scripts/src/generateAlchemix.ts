#!/usr/bin/env tsx
/**
 * Alchemix V3 Icon Generator
 *
 * One card per Alchemist (lender key `ALCHEMIX_<chainId>_<ALCHEMIST>`), the
 * same split-half layout as the Fraxlend / LlamaLend / Curvance generators:
 *
 *   left half  = collateral — the market's MYT share (mixUSDC / mixWETH)
 *   right half = debt — the alAsset it mints (alUSD / alETH / alUSDb)
 *   badge      = lender/alchemix.webp, top-right
 *
 *   npm run generate:alchemix
 *   npm run generate:alchemix -- --force     # re-render existing icons
 *
 * The roster is the seven Alchemists of lending-sdks' data-sdk seed
 * (`packages/data-sdk/src/lending/alchemix.ts`), copied here because it is a
 * fixed, hand-verified set with no published config file. A market whose token
 * logos are missing from the published delta token list is skipped (a
 * half-blank card is worse than the badge fallback) — re-run after the list
 * publishes the L2 MYTs and alUSDb.
 */

import fs from "fs";
import { chainName } from "./config.js";
import { fetchTokenMap, type TokenMap } from "./tokenList.js";
import { mergeSplitWithBadge, outPath } from "./iconMerger.js";

interface AlchemixMarket {
  chainId: string;
  alchemist: string;
  myt: string;
  debtToken: string;
  /** The MYT's underlying — its logo stands in for the MYT until the MYT has art. */
  underlying: string;
  label: string;
}

const MARKETS: AlchemixMarket[] = [
  {
    chainId: "1",
    alchemist: "0xfa995B6ABc387376C3e7De5f6d394Ab5B6beE26B",
    myt: "0x29bcfeD246ce37319d94eBa107db90C453D4c43D",
    underlying: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    debtToken: "0x0100546F2cD4C9D97f798fFC9755E47865FF7Ee6",
    label: "alETH / mixWETH",
  },
  {
    chainId: "1",
    alchemist: "0xeB83112d925268BeDe86654C13D423a987587e3E",
    myt: "0x9B44efCa3e2a707B63Dc00CE79d646E5E5D24bA5",
    underlying: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    debtToken: "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9",
    label: "alUSD / mixUSDC",
  },
  {
    chainId: "10",
    alchemist: "0xDeD3A04612FF12b57317abE38e68026Fc9D28114",
    myt: "0x91b8657aea26Caa8A0E9D6DD4E24727Ccf32F822",
    underlying: "0x4200000000000000000000000000000000000006",
    debtToken: "0x3E29D3A9316dAB217754d13b28646B76607c5f04",
    label: "alETH / mixWETH",
  },
  {
    chainId: "10",
    alchemist: "0x930750a3510E703535e943E826ABa3c364fFC1De",
    myt: "0xAf510a560744880410f0f65e3341A020FBC2cA41",
    underlying: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    debtToken: "0xCB8FA9a76b8e203D8C3797bF438d8FB81Ea3326A",
    label: "alUSD / mixUSDC",
  },
  {
    chainId: "42161",
    alchemist: "0xDeD3A04612FF12b57317abE38e68026Fc9D28114",
    myt: "0xfe8F223F3d81462F55bf8609897B8cEcfA4B195C",
    underlying: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    debtToken: "0x17573150d67d820542EFb24210371545a4868B03",
    label: "alETH / mixWETH",
  },
  {
    chainId: "42161",
    alchemist: "0x930750a3510E703535e943E826ABa3c364fFC1De",
    myt: "0xEba62B842081CeF5a8184318Dc5C4E4aACa9f651",
    underlying: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    debtToken: "0xCB8FA9a76b8e203D8C3797bF438d8FB81Ea3326A",
    label: "alUSD / mixUSDC",
  },
  {
    chainId: "8453",
    alchemist: "0xEb380d86EeD275C9F2eD77745aB1B2ccf364BF7A",
    myt: "0xb8BeFE5a6941ca4022a52042075ff269C3C67467",
    underlying: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    debtToken: "0x877014E21c32feA108B6A1f45f367efc9a2d9B9F",
    label: "alUSDb / mixUSDC",
  },
];

const ALUSD_MAINNET = "0xbc6da0fe9ad5f3b0d58160288917aa56653660e9";

/** The raw lender key lower-cased — the name yield-tracer's `logo_uri` uses. */
export const alchemixEnumName = (chainId: string, alchemist: string): string =>
  `alchemix_${chainId}_${alchemist.replace(/^0x/i, "").toLowerCase()}`;

async function main() {
  const badgePath = outPath("alchemix");
  if (!fs.existsSync(badgePath)) {
    console.error(`Alchemix badge missing at ${badgePath}`);
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  let created = 0;
  let skipped = 0;
  let missing = 0;
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
    // Fallbacks until the MYTs and alUSDb have art in asset-icons: the MYT's
    // underlying (what the share is denominated in) and, for Base's alUSDb,
    // the alUSD mark from Ethereum. Re-run with --force once they do.
    const collLogo =
      tokens[m.myt.toLowerCase()]?.logoURI ??
      tokens[m.underlying.toLowerCase()]?.logoURI;
    let debtLogo = tokens[m.debtToken.toLowerCase()]?.logoURI;
    if (!debtLogo) {
      maps["1"] ??= await fetchTokenMap("1");
      debtLogo = maps["1"][ALUSD_MAINNET]?.logoURI;
    }
    const enumName = alchemixEnumName(m.chainId, m.alchemist);
    if (!collLogo || !debtLogo) {
      console.log(
        `    ~ [${name}] ${m.label}: no logo for ${[!collLogo && m.myt, !debtLogo && m.debtToken].filter(Boolean).join(", ")}`,
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
      await mergeSplitWithBadge(collLogo, debtLogo, badgePath, filePath, {
        badgePadding: 2,
      });
      created++;
      console.log(`    + [${name}] ${m.label} → ${enumName}.webp`);
    } catch (err) {
      failed++;
      console.error(`    ! ${enumName}: ${(err as Error).message}`);
    }
  }
  console.log(
    `\nAlchemix: ${MARKETS.length} markets — created ${created}, existed ${skipped}, missing logos ${missing}, failed ${failed}`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
