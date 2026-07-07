#!/usr/bin/env node
import { input, select } from "@inquirer/prompts";
import * as readline from "node:readline/promises";
import { stdin as input$, stdout } from "node:process";
import fs from "fs";
import { seedDatabase } from "./seed.js";
import { resetStaleLocks, clearPendingURLs } from "./db/queries.js";
import { startScheduler } from "./frontier/scheduler.js";
import { pool } from "./db/client.js";
import { config } from "./config.js";
import { createStrategy, setStrategy, type OutputMode } from "./output/index.js";
import { validateSeedUrls } from "./security/validate-url.js";

const SEEDS_FILE = "seeds.txt";
const MIN_CRAWL_DELAY_MS = 500;

// Unified layout grid definition
const INNER_WIDTH = 72; 

// ─── Terminal primitives ──────────────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = "\x1b[0m";

// Gradient colors: Green to Blue
const gradient = (text: string): string => {
  const colors = [
    "\x1b[38;2;0;255;127m",  // Spring Green
    "\x1b[38;2;0;255;150m",  
    "\x1b[38;2;0;230;180m",  
    "\x1b[38;2;0;200;200m",  
    "\x1b[38;2;0;170;220m",  
    "\x1b[38;2;0;140;240m",  
    "\x1b[38;2;0;100;255m",  // Dodger Blue
    "\x1b[38;2;0;70;255m",   
  ];
  
  let result = "";
  const chars = text.split("");
  for (let i = 0; i < chars.length; i++) {
    const colorIndex = Math.floor((i / chars.length) * colors.length);
    result += colors[colorIndex % colors.length] + chars[i];
  }
  return result + RESET;
};

// Clean structural geometric patterns
const STARS = {
  full: "✦",
  half: "✧",
  small: "⋆",
  star: "★",
  outline: "☆",
};

const G      = (s: string) => `\x1b[32m${s}${RESET}`;   // green
const DG     = (s: string) => `\x1b[2;32m${s}${RESET}`; // dim green
const YL     = (s: string) => `\x1b[33m${s}${RESET}`;   // yellow
const RD     = (s: string) => `\x1b[31m${s}${RESET}`;   // red
const W      = (s: string) => `\x1b[97m${s}${RESET}`;   // bright white
const DIM    = (s: string) => `\x1b[2m${s}${RESET}`;    // dim
const BOLD   = (s: string) => `\x1b[1m${s}${RESET}`;    // bold
const BLUE   = (s: string) => `\x1b[34m${s}${RESET}`;   // blue
const CYAN   = (s: string) => `\x1b[36m${s}${RESET}`;   // cyan

const BOX = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h:  "─", v:  "│", lm: "├", rm: "┤",
  tm: "┬", bm: "┴", cross: "┼",
};

function getVisibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// ─── Box Layout Engine ────────────────────────────────────────────────────────

function drawTopBorder(label: string): string {
  const prefix = "  ┌─ " + label + " ";
  const currentLen = getVisibleLength(prefix);
  const remaining = (INNER_WIDTH + 4) - currentLen - 1; 
  return DG(prefix + BOX.h.repeat(Math.max(0, remaining)) + "┐");
}

function drawBottomBorder(): string {
  return DG("  └" + BOX.h.repeat(INNER_WIDTH) + "┘");
}

function drawRow(leftContent: string, rightContentRendered: string, rightContentRawLength: number): string {
  const leftVisible = getVisibleLength(leftContent);
  const leftPadded = leftContent + " ".repeat(Math.max(0, 16 - leftVisible));
  
  const remainingSpaces = INNER_WIDTH - 18 - rightContentRawLength;
  
  return DG("  │") + "  " + leftPadded + rightContentRendered + " ".repeat(Math.max(0, remainingSpaces)) + DG("│");
}

// ─── Background Glowing Animation Engine ──────────────────────────────────────

let glowInterval: NodeJS.Timeout | null = null;
let currentGlowText = "";
let glowFrameIndex = 0;

// High-density frames with elevated base values to prevent vanishing artifacts
const glowFrames = [
  "\x1b[38;2;0;140;100m",   // Baseline low (Crisp Medium Mint)
  "\x1b[38;2;0;175;130m",   
  "\x1b[38;2;0;205;155m",   
  "\x1b[38;2;0;235;185m",   
  "\x1b[38;2;0;255;210m",   // Vivid Cyan-Green
  "\x1b[38;2;100;255;225m", // High Glow
  "\x1b[38;2;180;255;245m", // Peak Brightness
  "\x1b[38;2;100;255;225m", 
  "\x1b[38;2;0;255;210m",   
  "\x1b[38;2;0;235;185m",   
  "\x1b[38;2;0;205;155m",   
  "\x1b[38;2;0;175;130m"    
];

function drawGlowLine(): void {
  if (!currentGlowText) return;
  const colorCode = glowFrames[glowFrameIndex % glowFrames.length];
  process.stdout.write(`\r\x1b[K  ${CYAN(STARS.full)}  ${colorCode}${BOLD(currentGlowText)}${RESET}`);
  glowFrameIndex++;
}

export function startGlowStatus(text: string): void {
  currentGlowText = text;
  glowFrameIndex = 0;
  // Hide native terminal cursor to keep rendering clean
  process.stdout.write("\x1b[?25l");
  drawGlowLine();
  glowInterval = setInterval(drawGlowLine, 120); // Frequency locked at 120ms
}

export function stopGlowStatus(): void {
  if (glowInterval) {
    clearInterval(glowInterval);
    glowInterval = null;
  }
  currentGlowText = "";
  // Clear the animation frame line and restore cursor
  process.stdout.write("\r\x1b[K\x1b[?25h");
}

// ─── Logging Helpers (Interception-Aware) ─────────────────────────────────────

const ts = () => DIM(new Date().toISOString().slice(11, 19));

export function ok(msg: string) { 
  if (currentGlowText) process.stdout.write("\r\x1b[K");
  console.log(`  ${ts()}  ${G("✓")}  ${msg}`); 
  if (currentGlowText) drawGlowLine();
}

export function warn(msg: string) { 
  if (currentGlowText) process.stdout.write("\r\x1b[K");
  console.log(`  ${ts()}  ${YL("⚠")}  ${msg}`); 
  if (currentGlowText) drawGlowLine();
}

export function err(msg: string) { 
  if (currentGlowText) process.stdout.write("\r\x1b[K");
  console.log(`  ${ts()}  ${RD("✗")}  ${msg}`); 
  if (currentGlowText) drawGlowLine();
}

export function info(msg: string) { 
  if (currentGlowText) process.stdout.write("\r\x1b[K");
  console.log(`  ${ts()}  ${BLUE("ℹ")}  ${DIM(msg)}`); 
  if (currentGlowText) drawGlowLine();
}

export function blank() { 
  if (currentGlowText) process.stdout.write("\r\x1b[K");
  console.log(""); 
  if (currentGlowText) drawGlowLine();
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function printBanner(): void {
  console.clear();
  blank();
  
  const bannerText = [
    "   ██╗    ██╗███████╗██████╗  ✦   ██████╗██████╗  █████╗ ██╗    ██╗██╗     ███████╗██████╗ ",
    "   ██║    ██║██╔════╝██╔══██╗     ██╔════╝██╔══██╗██╔══██╗██║    ██║██║  ✦  ██╔════╝██╔══██╗",
    "   ██║ █╗ ██║█████╗  ██████╔╝ ✦   ██║     ██████╔╝███████║██║ █╗ ██║██║     █████╗  ██████╔╝",
    "   ██║███╗██║██╔══╝  ██╔══██╗     ██║     ██╔══██╗██╔══██║██║███╗██║██║ ★  ██╔══╝  ██╔══██╗",
    "   ╚███╔███╔╝███████╗██████╔╝  ★  ╚██████╗██║  ██║██║  ██║╚███╔███╔╝███████╗███████╗██║  ██║",
    "    ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝",
  ];
  
  for (const line of bannerText) {
    let texturedLine = gradient(line);
    texturedLine = texturedLine.replace(/✦/g, W("✦")).replace(/★/g, W("★"));
    console.log(`  ${CYAN(STARS.full)}  ${texturedLine}  ${CYAN(STARS.full)}`);
  }
  
  blank();
  console.log(`  ${CYAN(STARS.half)}  ${gradient("Node.js · TypeScript · PostgreSQL")}  ${CYAN(STARS.half)}  ${DIM("v1.0.0")}`);
  console.log(DG("  " + BOX.h.repeat(INNER_WIDTH + 2)));
  blank();
}

// ─── Status board ─────────────────────────────────────────────────────────────

export function printSummary(s: CrawlSettings, seedsFromFile: string[]): void {
  const seedLabel =
    s.seedSource === "file"
      ? `seeds.txt (${seedsFromFile.length} url${seedsFromFile.length !== 1 ? "s" : ""})`
      : s.seedSource === "custom"
      ? `custom    (${s.customUrls.length} url${s.customUrls.length !== 1 ? "s" : ""})`
      : "config.ts";

  const rows: Array<[string, string]> = [
    ["output",   s.outputMode === "pdf" ? "pdf -> output/documentation*.pdf" : "database -> postgresql"],
    ["seeds",    seedLabel],
    ["depth",    String(s.maxDepth)],
    ["delay",    `${s.crawlDelayMs}ms${s.crawlDelayMs < MIN_CRAWL_DELAY_MS ? " ! below safe minimum" : ""}`],
    ["workers",  String(s.workerCount)],
    ["maxpages", s.maxPages === 0 ? "unlimited" : String(s.maxPages)],
    ["start" , "Start the crawl"]
  ];

  blank();
  console.log(CYAN("  " + STARS.small + "  " + gradient("CONFIGURATION") + "  " + STARS.small));
  console.log(drawTopBorder("CONFIG"));
  
  for (const [k, v] of rows) {
    const valRendered = v.includes("!") ? YL(v) : gradient(v);
    console.log(drawRow(CYAN(BOLD("/" + k)), valRendered, getVisibleLength(v)));
  }
  
  console.log(drawBottomBorder());
  blank();
}

// ─── Help panel ───────────────────────────────────────────────────────────────

export function printHelp(): void {
  blank();
  console.log(CYAN("  " + STARS.star + "  " + gradient("AVAILABLE COMMANDS") + "  " + STARS.star));
  console.log(drawTopBorder("COMMANDS"));

  const cmds: [string, string][] = [
    ["/output",                    "switch output destination (interactive)"],
    ["/seeds",                     "choose seed URL source (interactive)"],
    ["/depth  <n>",               "max link traversal depth"],
    ["/delay  <ms>",              "politeness delay  (min 500)"],
    ["/workers <n>",              "concurrent worker count"],
    ["/maxpages <n>",             "page cap per session  (0 = unlimited)"],
    ["/status",                    "print current config"],
    ["/help",                      "show this panel"],
    ["/start",                     "validate and begin crawl"],
    ["/quit",                      "exit without crawling"],
  ];

  for (const [cmd, desc] of cmds) {
    console.log(drawRow(CYAN(cmd), DIM(desc), getVisibleLength(desc)));
  }

  console.log(drawBottomBorder());
  blank();
}

// ─── Interactive Setup Helpers ───────────────────────────────────────────────

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
    warn(`crawl_delay_ms ${raw}ms is below safe minimum — raised to ${MIN_CRAWL_DELAY_MS}ms`);
    return MIN_CRAWL_DELAY_MS;
  }
  return raw;
}

function parseSlashCommand(input: string): { key: string; value: string } | null {
  const match = input.trim().match(/^\/(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  return { key: match[1].toLowerCase(), value: (match[2] ?? "").trim() };
}

function parseIntValue(value: string, label: string, min = 0): number | string {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < min) return `${label} must be an integer >= ${min}`;
  return n;
}

interface CrawlSettings {
  outputMode: OutputMode;
  seedSource: "file" | "config" | "custom";
  customUrls: string[];
  maxDepth: number;
  crawlDelayMs: number;
  workerCount: number;
  maxPages: number;
}

function defaultSettings(seedsFromFile: string[]): CrawlSettings {
  return {
    outputMode:   config.OUTPUT_MODE,
    seedSource:   seedsFromFile.length > 0 ? "file" : "config",
    customUrls:   [],
    maxDepth:     config.MAX_DEPTH,
    crawlDelayMs: config.CRAWL_DELAY_MS,
    workerCount:  config.WORKER_COUNT,
    maxPages:     config.MAX_PAGES,
  };
}

async function handleOutputMode(): Promise<OutputMode> {
  const result = await select({
    message: gradient("Select output mode:"),
    choices: [
      { name: "PDF - Generate documentation PDF", value: "pdf" },
      { name: "Database - Store in PostgreSQL", value: "database" },
    ],
  });
  return result as OutputMode;
}

async function handleSeedSource(seedsFromFile: string[]): Promise<{ source: "file" | "config" | "custom"; urls: string[] }> {
  const result = await select({
    message: gradient("Select seed source:"),
    choices: [
      { name: `File (seeds.txt) - ${seedsFromFile.length} URLs found`, value: "file", disabled: seedsFromFile.length === 0 },
      { name: "Config - Use default seeds from config.ts", value: "config" },
      { name: "Custom - Enter your own URLs", value: "custom" },
    ],
  });
  if (result === "file") return { source: "file", urls: seedsFromFile };
  if (result === "config") return { source: "config", urls: config.SEED_URLS };
  return { source: "custom", urls: await handleCustomUrls() };
}

async function handleCustomUrls(): Promise<string[]> {
  while (true) {
    const raw = await input({ message: gradient("Enter URLs (comma-separated):") });
    const candidates = raw.split(",").map((u) => u.trim()).filter(Boolean);
    const { valid, invalid } = validateSeedUrls(candidates);
    if (invalid.length > 0) {
      for (const e of invalid) err(e.reason);
      continue;
    }
    return valid;
  }
}

async function handleNumericConfig(prompt: string, currentValue: number, min = 0, max?: number): Promise<number> {
  while (true) {
    const value = await input({
      message: gradient(`${prompt} (current: ${currentValue}):`),
      validate: (v) => {
        const num = parseInt(v, 10);
        if (isNaN(num)) return "Please enter a valid number";
        if (num < min) return `Value must be >= ${min}`;
        if (max !== undefined && num > max) return `Value must be <= ${max}`;
        return true;
      },
    });
    return parseInt(value, 10);
  }
}

// ─── Command REPL ─────────────────────────────────────────────────────────────

async function runCommandRepl(seedsFromFile: string[]): Promise<CrawlSettings> {
  const s = defaultSettings(seedsFromFile);
  printSummary(s, seedsFromFile);

  console.log(
    CYAN(STARS.small) + DIM("  type a command to configure the crawler.") +
    "  " + G("/help") + DIM(" for options,") +
    "  " + W("/start") + DIM(" to begin.")
  );
  blank();

  while (true) {
    const rl = readline.createInterface({ input: input$, output: stdout });
    let line = "";
    try {
      line = await rl.question(CYAN("  " + STARS.half + "  › "));
    } finally {
      rl.close();
    }
    
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cmd = parseSlashCommand(trimmed);
    if (!cmd) {
      warn("Commands must start with /  — try " + G("/help"));
      continue;
    }

    switch (cmd.key) {
      case "help":
        printHelp();
        break;

      case "status":
        printSummary(s, seedsFromFile);
        break;

      case "output":
        s.outputMode = await handleOutputMode();
        ok(`output -> ${G(s.outputMode)}`);
        break;

      case "seeds": {
        const result = await handleSeedSource(seedsFromFile);
        s.seedSource = result.source;
        if (result.source === "custom") s.customUrls = result.urls;
        ok(`seeds source -> ${G(result.source)} (${result.urls.length} URLs)`);
        break;
      }

      case "depth":
        if (cmd.value) {
          const v = parseIntValue(cmd.value, "depth", 0);
          if (typeof v === "string") { err(v); break; }
          s.maxDepth = v;
        } else {
          s.maxDepth = await handleNumericConfig("Max depth", s.maxDepth, 0);
        }
        ok(`max_depth -> ${G(String(s.maxDepth))}`);
        break;

      case "delay":
        if (cmd.value) {
          const v = parseIntValue(cmd.value, "delay", 0);
          if (typeof v === "string") { err(v); break; }
          s.crawlDelayMs = enforceCrawlDelay(v);
        } else {
          s.crawlDelayMs = await handleNumericConfig("Crawl delay (ms)", s.crawlDelayMs, MIN_CRAWL_DELAY_MS);
        }
        ok(`crawl_delay_ms -> ${G(String(s.crawlDelayMs) + "ms")}`);
        break;

      case "workers":
        if (cmd.value) {
          const v = parseIntValue(cmd.value, "workers", 1);
          if (typeof v === "string") { err(v); break; }
          s.workerCount = v;
        } else {
          s.workerCount = await handleNumericConfig("Worker count", s.workerCount, 1, 100);
        }
        ok(`worker_count -> ${G(String(s.workerCount))}`);
        break;

      case "maxpages":
      case "maxcount":
        if (cmd.value) {
          const v = parseIntValue(cmd.value, "maxpages", 0);
          if (typeof v === "string") { err(v); break; }
          s.maxPages = v;
        } else {
          s.maxPages = await handleNumericConfig("Max pages (0 = unlimited)", s.maxPages, 0);
        }
        ok(`max_pages -> ${G(s.maxPages === 0 ? "unlimited" : String(s.maxPages))}`);
        break;

      case "start": {
        const seedCount =
          s.seedSource === "file"   ? seedsFromFile.length :
          s.seedSource === "custom" ? s.customUrls.length  :
          config.SEED_URLS.length;

        if (seedCount === 0) {
          err("No seed URLs configured — use /seeds first");
          break;
        }
        return s;
      }

      case "quit":
      case "exit":
      case "q":
        process.exit(0);

      default:
        warn(`Unknown command ${G("/" + cmd.key)} — try ${G("/help")}`);
    }
  }
}

function printLaunchSummary(seedUrls: string[], s: CrawlSettings, crawlDelayMs: number): void {
  blank();
  console.log(CYAN("  " + STARS.full + "  " + gradient("CRAWLER LAUNCHED") + "  " + STARS.full));
  console.log(drawTopBorder("LAUNCHING"));

  const rows: Array<[string, string]> = [
    ["seeds",    `${seedUrls.length} url${seedUrls.length !== 1 ? "s" : ""} queued`],
    ["domains",  config.ALLOWED_DOMAINS.join(", ")],
    ["output",   s.outputMode === "pdf" ? "pdf -> output/documentation*.pdf" : "postgresql"],
    ["depth",    String(config.MAX_DEPTH)],
    ["delay",    `${crawlDelayMs}ms`],
    ["workers",  String(config.WORKER_COUNT)],
    ["maxpages", config.MAX_PAGES === 0 ? "unlimited" : String(config.MAX_PAGES)],
  ];

  for (const [k, v] of rows) {
    console.log(drawRow(k, gradient(v), getVisibleLength(v)));
  }

  console.log(drawBottomBorder());
  blank();
}

// ─── Main Execution ───────────────────────────────────────────────────────────

async function main() {
  printBanner();
  const seedsFromFile = readSeedsFile();

  if (seedsFromFile.length > 0) {
    console.log(CYAN("  " + STARS.half + "  " + gradient(`Found ${seedsFromFile.length} URLs in seeds.txt`)));
    console.log(drawTopBorder(`seeds.txt (${seedsFromFile.length})`));
    for (const u of seedsFromFile.slice(0, 5)) {
      const innerLeft = "  " + u;
      console.log(DG("  │") + CYAN(innerLeft) + " ".repeat(Math.max(0, INNER_WIDTH - getVisibleLength(innerLeft))) + DG("│"));
    }
    console.log(drawBottomBorder());
    blank();
  }

  const s = await runCommandRepl(seedsFromFile);
  const crawlDelayMs = enforceCrawlDelay(s.crawlDelayMs);
  
  config.MAX_DEPTH      = s.maxDepth;
  config.CRAWL_DELAY_MS = crawlDelayMs;
  config.WORKER_COUNT   = s.workerCount;
  config.MAX_PAGES      = s.maxPages;
  config.OUTPUT_MODE    = s.outputMode;

  const rawSeeds = s.seedSource === "file" ? seedsFromFile : s.seedSource === "custom" ? s.customUrls : config.SEED_URLS;
  const { valid: seedUrls } = validateSeedUrls(rawSeeds);

  config.SEED_URLS       = seedUrls;
  config.ALLOWED_DOMAINS = extractDomains(seedUrls);

  printLaunchSummary(seedUrls, s, crawlDelayMs);

  const strategy = createStrategy(s.outputMode);
  setStrategy(strategy);
  await strategy.init();

  try {
    await resetStaleLocks();
    await clearPendingURLs(config.ALLOWED_DOMAINS);
    await seedDatabase();
    
    // Background status text engine starts up before launching the scheduler
    blank();
    startGlowStatus("CRAWLING THROUGH THE SITE...");
    
    await startScheduler();
    
    stopGlowStatus();
    ok("Crawl finished successfully.");
  } catch (error) {
    stopGlowStatus();
    err("Fatal error in main loop.");
    console.error(error);
  } finally {
    stopGlowStatus();
    await strategy.finish();
    await pool.end();
    blank();
    console.log(CYAN("  " + STARS.full + "  " + gradient("Session complete") + "  " + STARS.full));
    ok("Database connection closed.");
    blank();
  }
}

main();