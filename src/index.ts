import { select, input, number, confirm } from "@inquirer/prompts";
import fs from "fs";
import { seedDatabase } from "./seed.js";
import { resetStaleLocks, clearPendingURLs } from "./db/queries.js";
import { startScheduler } from "./frontier/scheduler.js";
import { pool } from "./db/client.js";
import { config } from "./config.js";
import { createStrategy, setStrategy, type OutputMode } from "./output/index.js";

const SEEDS_FILE = "seeds.txt";

// Minimum politeness delay — any value below this is raised to the threshold
// to prevent accidental DDoS-like hammering of target servers.
const MIN_CRAWL_DELAY_MS = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readSeedsFile(): string[] {
  if (!fs.existsSync(SEEDS_FILE)) return [];
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

function enforceCrawlDelay(raw: number): number {
  if (raw < MIN_CRAWL_DELAY_MS) {
    console.warn(
      `  ⚠  CRAWL_DELAY_MS ${raw}ms is below the safe minimum. ` +
      `Raised to ${MIN_CRAWL_DELAY_MS}ms to avoid aggressive request rates.`
    );
    return MIN_CRAWL_DELAY_MS;
  }
  return raw;
}

// ─── CLI Wizard ───────────────────────────────────────────────────────────────

async function runWizard(): Promise<{
  seedUrls: string[];
  outputMode: OutputMode;
}> {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║    Web Crawler — Interactive Setup Wizard   ║");
  console.log("╚════════════════════════════════════════════╝\n");

  // Show seeds.txt contents if present
  const seedsFromFile = readSeedsFile();
  if (seedsFromFile.length > 0) {
    console.log(`Found ${seedsFromFile.length} URL(s) in ${SEEDS_FILE}:`);
    seedsFromFile.forEach((u) => console.log(`  • ${u}`));
    console.log();
  }

  // ── Output mode ─────────────────────────────────────────────────────────────
  const outputMode = await select<OutputMode>({
    message: "Where should crawled data be stored?",
    choices: [
      {
        name: "PostgreSQL database  — structured records (URL, title, text, headings)",
        value: "database",
        short: "Database",
      },
      {
        name: "PDF eBook            — all pages compiled into a single document",
        value: "pdf",
        short: "PDF",
      },
    ],
    default: "database",
  });

  // ── Seed URL source ──────────────────────────────────────────────────────────
  type SeedSource = "file" | "config" | "custom";
  const seedChoices: { name: string; value: SeedSource }[] = [
    ...(seedsFromFile.length > 0
      ? [{ name: `Use URLs from ${SEEDS_FILE}  (${seedsFromFile.length} found)`, value: "file" as SeedSource }]
      : []),
    { name: "Use the default URLs already in config.ts", value: "config" },
    { name: "Enter custom URLs now", value: "custom" },
  ];

  const seedSource = await select<SeedSource>({
    message: "Which seed URLs should the crawler start from?",
    choices: seedChoices,
    default: seedsFromFile.length > 0 ? "file" : "config",
  });

  // ── Custom URL input ─────────────────────────────────────────────────────────
  let customUrls: string[] = [];
  if (seedSource === "custom") {
    const raw = await input({
      message: "Enter URLs separated by commas:",
      validate: (v) => (v.trim().length > 0 ? true : "Please enter at least one URL"),
    });
    customUrls = raw.split(",").map((u) => u.trim()).filter(Boolean);
  }

  // ── Performance settings ─────────────────────────────────────────────────────
  const maxDepth = await number({
    message: "MAX_DEPTH — link hops from seed URLs:",
    default: config.MAX_DEPTH,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  const rawDelay = await number({
    message: `CRAWL_DELAY_MS — politeness delay per domain (ms, min ${MIN_CRAWL_DELAY_MS}ms):`,
    default: config.CRAWL_DELAY_MS,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  const workerCount = await number({
    message: "WORKER_COUNT — concurrent workers:",
    default: config.WORKER_COUNT,
    validate: (v) => (v !== undefined && v >= 1 ? true : "Must be at least 1"),
  });

  const maxPages = await number({
    message: "MAX_PAGES — page limit (0 = unlimited):",
    default: config.MAX_PAGES,
    validate: (v) => (v !== undefined && v >= 0 ? true : "Must be 0 or greater"),
  });

  // ── Confirm ──────────────────────────────────────────────────────────────────
  const confirmed = await confirm({
    message: "Start crawling with these settings?",
    default: true,
  });

  if (!confirmed) {
    console.log("\nAborted. No changes made.\n");
    process.exit(0);
  }

  // Resolve and validate settings
  const crawlDelayMs = enforceCrawlDelay(rawDelay ?? config.CRAWL_DELAY_MS);

  config.MAX_DEPTH     = maxDepth    ?? config.MAX_DEPTH;
  config.CRAWL_DELAY_MS = crawlDelayMs;
  config.WORKER_COUNT  = workerCount ?? config.WORKER_COUNT;
  config.MAX_PAGES     = maxPages    ?? config.MAX_PAGES;
  config.OUTPUT_MODE   = outputMode;

  // Resolve seed URLs
  let seedUrls: string[];
  if (seedSource === "file") {
    seedUrls = seedsFromFile;
  } else if (seedSource === "custom") {
    seedUrls = customUrls;
  } else {
    seedUrls = config.SEED_URLS;
  }

  // Lock config to only the chosen seeds — this is what controls which domains
  // the crawler is allowed to visit. Old DB entries for other domains won't be
  // picked up because isDomainAllowed() filters them out in the worker.
  config.SEED_URLS      = seedUrls;
  config.ALLOWED_DOMAINS = extractDomains(seedUrls);

  console.log(`\n✓ ${seedUrls.length} seed URL(s) queued`);
  console.log(`✓ Allowed domains: ${config.ALLOWED_DOMAINS.join(", ")}`);
  console.log(`✓ Output → ${outputMode === "pdf" ? "PDF (output/documentation*.pdf)" : "PostgreSQL database"}`);
  console.log(`✓ Depth: ${config.MAX_DEPTH} | Delay: ${crawlDelayMs}ms | Workers: ${config.WORKER_COUNT} | Max pages: ${config.MAX_PAGES || "∞"}\n`);

  return { seedUrls, outputMode };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { outputMode } = await runWizard();

  console.log("Web Crawler starting...\n");

  // Initialise the chosen output strategy
  const strategy = createStrategy(outputMode);
  setStrategy(strategy);
  await strategy.init();

  try {
    // 1. Crash recovery
    await resetStaleLocks();

    // 2. Clear any PENDING URLs from previous runs that belong to domains
    //    outside the current ALLOWED_DOMAINS — prevents stale seeds bleeding in.
    await clearPendingURLs(config.ALLOWED_DOMAINS);

    // 3. Seed database with the URLs chosen in the wizard
    await seedDatabase();

    // 4. Start the scheduling loop
    await startScheduler();

    console.log("Crawling finished.");
  } catch (error) {
    console.error("Fatal error in main crawler loop:", error);
  } finally {
    // 5. Flush output strategy (e.g. finalise PDF)
    await strategy.finish();

    // 6. Close DB pool
    await pool.end();
    console.log("Database connection pool closed.");
  }
}

main();
