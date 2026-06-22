import { config } from "../config.js";
import { claimNextURL } from "../db/queries.js";
import { getPendingDomains } from "./frontier.js";
import { processPage } from "../worker/worker.js";
import { startProgressLogger, stopProgressLogger } from "./logger.js";

const cooldowns = new Map<string, number>();

let activeWorkers = 0;
let lastDomainIndex = 0;
let isRunning = false;

// Pages dispatched in this session (in-memory counter, not cumulative DB total)
let sessionPageCount = 0;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the round-robin scheduler loop.
 * Respects politeness delays per domain and concurrency limits.
 */
export async function startScheduler(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  sessionPageCount = 0;

  // Start the periodic progress logger
  await startProgressLogger();

  while (isRunning) {
    // Enforce MAX_PAGES limit against this session's dispatched count
    if (config.MAX_PAGES > 0 && sessionPageCount >= config.MAX_PAGES) {
      // Wait for any in-flight workers to finish before stopping
      while (activeWorkers > 0) {
        await sleep(100);
      }
      console.log(`\n✓ Crawl complete — ${sessionPageCount} page(s) processed.\n`);
      break;
    }

    // 1. Enforce worker concurrency limit
    if (activeWorkers >= config.WORKER_COUNT) {
      await sleep(50);
      continue;
    }

    // 2. Fetch active pending domains from the frontier
    const domains = await getPendingDomains();
    if (domains.length === 0) {
      // Exit if there are no pending URLs and all workers are idle
      if (activeWorkers === 0) {
        break;
      }
      await sleep(100);
      continue;
    }

    let claimed = false;
    const now = Date.now();

    // 3. Round-robin traversal over domains
    for (let i = 0; i < domains.length; i++) {
      const idx = (lastDomainIndex + i) % domains.length;
      const domain = domains[idx];

      // Enforce politeness delay
      const nextAllowed = cooldowns.get(domain) || 0;
      if (now < nextAllowed) {
        continue;
      }

      // Try to atomically claim a URL for this domain
      const urlRow = await claimNextURL(domain);
      if (urlRow) {
        // Set the domain cooldown
        cooldowns.set(domain, Date.now() + config.CRAWL_DELAY_MS);
        
        // Update round-robin start index for the next tick
        lastDomainIndex = (idx + 1) % domains.length;

        // Dispatch worker
        activeWorkers++;
        sessionPageCount++;
        processPage(urlRow)
          .catch((err) => {
            console.error(`Error processing ${urlRow.url}:`, err);
          })
          .finally(() => {
            activeWorkers--;
          });

        claimed = true;
        break;
      }
    }

    // If no URL was claimed (e.g. all domains in cooldown or DB lock contention), sleep
    if (!claimed) {
      await sleep(50);
    }
  }

  isRunning = false;
  stopProgressLogger();
}

export function stopScheduler() {
  isRunning = false;
  stopProgressLogger();
}

export function getActiveWorkersCount() {
  return activeWorkers;
}

export function getCooldown(domain: string) {
  return cooldowns.get(domain) || 0;
}

