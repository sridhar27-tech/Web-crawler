/**
 * Standalone CLI configuration wizard.
 *
 * Usage: npm run config
 *
 * Steps:
 *  1. Reads seed URLs from seeds.txt
 *  2. Prompts for crawler performance settings and output mode
 *  3. Writes updated values to .env
 *  4. Patches SEED_URLS and ALLOWED_DOMAINS in src/config.ts
 */

import { select, number, confirm } from "@inquirer/prompts";
import fs from "fs";
import path from "path";

const SEEDS_FILE = "seeds.txt";
const ENV_FILE = ".env";
const CONFIG_FILE = path.join("src", "config.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSeedsFile(): string[] {
  if (!fs.existsSync(SEEDS_FILE)) {
    console.warn(`[setup] ${SEEDS_FILE} not found. No seed URLs will be loaded.`);
    return [];
  }
  return fs
    .readFileSync(SEEDS_FILE, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function extractDomains(urls: string[]): string[] {
  return urls.reduce<string[]>((acc, url) => {
    try {
      const { hostname } = new URL(url);
      if (hostname && !acc.includes(hostname)) acc.push(hostname);
    } catch {}
    return acc;
  }, []);
}

function writeEnvFile(values: Record<string, string>): void {
  let existing: Record<string, string> = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      existing[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  const content =
    Object.entries({ ...existing, ...values })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
  fs.writeFileSync(ENV_FILE, content, "utf-8");
  console.log(`[setup] .env updated.`);
}

function patchConfigTs(seedUrls: string[], allowedDomains: string[], outputMode: string): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.warn(`[setup] ${CONFIG_FILE} not found — skipping patch.`);
    return;
  }
  let src = fs.readFileSync(CONFIG_FILE, "utf-8");

  const seedArray = "[\n" + seedUrls.map((u) => `    "${u}"`).join(",\n") + ",\n  ]";
  src = src.replace(/SEED_URLS:\s*\[[\s\S]*?\]/, `SEED_URLS: ${seedArray}`);

  const domainArray = "[\n" + allowedDomains.map((d) => `    "${d}"`).join(",\n") + ",\n  ]";
  src = src.replace(/ALLOWED_DOMAINS:\s*\[[\s\S]*?\]/, `ALLOWED_DOMAINS: ${domainArray}`);

  if (/OUTPUT_MODE:/.test(src)) {
    src = src.replace(/OUTPUT_MODE:\s*["'][^"']*["']/, `OUTPUT_MODE: "${outputMode}"`);
  } else {
    src = src.replace(/(\n};)/, `\n  OUTPUT_MODE: "${outputMode}",\n};`);
  }

  fs.writeFileSync(CONFIG_FILE, src, "utf-8");
  console.log(`[setup] src/config.ts patched.`);
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Web Crawler — Interactive Setup Wizard  ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const seedUrls = readSeedsFile();
  if (seedUrls.length === 0) {
    console.warn(`[setup] No URLs found in ${SEEDS_FILE}. Add target URLs and re-run.\n`);
  } else {
    console.log(`[setup] Found ${seedUrls.length} seed URL(s):`);
    seedUrls.forEach((u) => console.log(`         ${u}`));
    console.log();
  }

  const outputMode = await select<string>({
    message: "OUTPUT_MODE — where should crawled data be stored?",
    choices: [
      { name: "PostgreSQL database  (structured data)", value: "database" },
      { name: "PDF eBook            (compiled document)", value: "pdf" },
    ],
    default: "database",
  });

  const maxDepth = await number({
    message: "MAX_DEPTH — link hops from seed URLs:",
    default: 3,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  const crawlDelayMs = await number({
    message: "CRAWL_DELAY_MS — politeness delay per domain (ms):",
    default: 1000,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  const workerCount = await number({
    message: "WORKER_COUNT — concurrent workers:",
    default: 5,
    validate: (v) => (v !== undefined && v >= 1 ? true : "Must be at least 1"),
  });

  const maxPages = await number({
    message: "MAX_PAGES — page limit (0 = unlimited):",
    default: 1000,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  const ok = await confirm({ message: "Save these settings?", default: true });
  if (!ok) {
    console.log("\nAborted.\n");
    process.exit(0);
  }

  writeEnvFile({
    MAX_DEPTH: String(maxDepth),
    CRAWL_DELAY_MS: String(crawlDelayMs),
    WORKER_COUNT: String(workerCount),
    MAX_PAGES: String(maxPages),
    OUTPUT_MODE: outputMode,
  });

  patchConfigTs(seedUrls, extractDomains(seedUrls), outputMode);

  console.log("\n✓ Configuration saved. Run  npm run crawl  to start.\n");
}

main().catch((err) => {
  console.error("[setup] Fatal error:", err);
  process.exit(1);
});
