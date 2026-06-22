import type { CrawledPageContent } from "../db/queries.js";

/**
 * Strategy interface for output destinations.
 * Implementations decide how to persist extracted page content.
 */
export interface OutputStrategy {
  /** Called once before crawling begins. */
  init(): Promise<void>;

  /** Called for each successfully crawled page. */
  save(urlId: number, url: string, content: CrawledPageContent): Promise<void>;

  /** Called once after crawling finishes to flush/close any open resources. */
  finish(): Promise<void>;
}
