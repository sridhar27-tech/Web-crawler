import type { OutputStrategy } from "./strategy.js";
import { markDone, type CrawledPageContent } from "../db/queries.js";

/**
 * Persists crawled page content into the PostgreSQL database.
 * This is the default structured-data output pipeline.
 */
export class DatabaseStrategy implements OutputStrategy {
  async init(): Promise<void> {
    // Pool is already initialised by client.ts — nothing to do here.
  }

  async save(urlId: number, _url: string, content: CrawledPageContent): Promise<void> {
    await markDone(urlId, content);
  }

  async finish(): Promise<void> {
    // Connection pool is closed by index.ts — nothing to do here.
  }
}
