import { query, pool } from "./client.js";

export interface URLRow {
  id: number;
  url: string;
  domain: string;
  status: string;
  depth: number;
}

export interface CrawledPageContent {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  textContent: string | null;
}

/**
 * Claims the next PENDING URL for a given domain and marks it as FETCHING.
 * Uses FOR UPDATE SKIP LOCKED to prevent multiple workers from claiming the same URL.
 */
export async function claimNextURL(domain: string): Promise<URLRow | null> {
  const res = await query(
    `UPDATE urls
     SET status = 'FETCHING', fetched_at = NOW()
     WHERE id = (
       SELECT id FROM urls
       WHERE status = 'PENDING' AND domain = $1
       ORDER BY depth ASC, discovered_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, url, domain, status, depth`,
    [domain]
  );

  if (res.rows.length === 0) {
    return null;
  }

  return res.rows[0] as URLRow;
}

/**
 * Atomically updates URL status to DONE and inserts the crawled page content.
 */
export async function markDone(urlId: number, content: CrawledPageContent): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO crawled_pages (url_id, title, description, canonical_url, headings, text_content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        urlId,
        content.title,
        content.description,
        content.canonicalUrl,
        JSON.stringify(content.headings),
        content.textContent,
      ]
    );

    await client.query(
      `UPDATE urls
       SET status = 'DONE', fetched_at = NOW()
       WHERE id = $1`,
      [urlId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marks a URL status as FAILED and stores the error message.
 */
export async function markFailed(urlId: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE urls
     SET status = 'FAILED', error_message = $2, fetched_at = NOW()
     WHERE id = $1`,
    [urlId, errorMessage]
  );
}

/**
 * Inserts a URL as PENDING if it doesn't already exist.
 * Returns the ID of the URL (whether newly inserted or already existing).
 */
export async function insertURL(url: string, domain: string, depth: number): Promise<number> {
  const res = await query(
    `WITH ins AS (
       INSERT INTO urls (url, domain, status, depth)
       VALUES ($1, $2, 'PENDING', $3)
       ON CONFLICT (url) DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM urls WHERE url = $1
     LIMIT 1`,
    [url, domain, depth]
  );

  return res.rows[0].id;
}

/**
 * Inserts a link relationship between two URLs.
 */
export async function insertLink(fromUrlId: number, toUrlId: number): Promise<void> {
  await query(
    `INSERT INTO links (from_url_id, to_url_id)
     VALUES ($1, $2)
     ON CONFLICT (from_url_id, to_url_id) DO NOTHING`,
    [fromUrlId, toUrlId]
  );
}

/**
 * Resets all URLs with FETCHING status back to PENDING.
 * Used for crash recovery on startup to release stale locks.
 */
export async function resetStaleLocks(): Promise<void> {
  await query(
    `UPDATE urls
     SET status = 'PENDING'
     WHERE status = 'FETCHING'`
  );
}

/**
 * Deletes all PENDING URLs whose domain is not in the provided allowed list.
 * This includes child links discovered during previous crawls, ensuring a new
 * session scoped to different seeds starts with a clean queue.
 */
export async function clearPendingURLs(allowedDomains: string[]): Promise<void> {
  if (allowedDomains.length === 0) return;

  const result = await query(
    `DELETE FROM urls
     WHERE status = 'PENDING'
       AND domain <> ALL($1::text[])`,
    [allowedDomains]
  );

  const deleted = (result as any).rowCount ?? 0;
  if (deleted > 0) {
    console.log(`[setup] Cleared ${deleted} stale PENDING URL(s) outside allowed domains.`);
  }
}

export interface GlobalStats {
  pending: number;
  fetching: number;
  done: number;
  failed: number;
}

export interface DomainStats {
  domain: string;
  pending_count: number;
  fetching_count: number;
  done_count: number;
  failed_count: number;
  last_crawled_at: Date | null;
}

/**
 * Retrieves aggregate statistics across all URLs.
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  const res = await query(
    `SELECT status, COUNT(*) as count
     FROM urls
     GROUP BY status`
  );

  const stats: GlobalStats = { pending: 0, fetching: 0, done: 0, failed: 0 };
  for (const row of res.rows) {
    const status = row.status.toLowerCase();
    const count = parseInt(row.count, 10);
    if (status === "pending") stats.pending = count;
    else if (status === "fetching") stats.fetching = count;
    else if (status === "done") stats.done = count;
    else if (status === "failed") stats.failed = count;
  }
  return stats;
}

/**
 * Recomputes and updates domain-level stats in the domain_stats table.
 */
export async function refreshDomainStats(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS domain_stats (
      domain TEXT PRIMARY KEY,
      pending_count INTEGER NOT NULL DEFAULT 0,
      fetching_count INTEGER NOT NULL DEFAULT 0,
      done_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      last_crawled_at TIMESTAMPTZ
    )
  `);

  await query(`
    INSERT INTO domain_stats (domain, pending_count, fetching_count, done_count, failed_count, last_crawled_at)
    SELECT
      domain,
      COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
      COUNT(*) FILTER (WHERE status = 'FETCHING') as fetching_count,
      COUNT(*) FILTER (WHERE status = 'DONE') as done_count,
      COUNT(*) FILTER (WHERE status = 'FAILED') as failed_count,
      MAX(fetched_at) as last_crawled_at
    FROM urls
    GROUP BY domain
    ON CONFLICT (domain) DO UPDATE SET
      pending_count = EXCLUDED.pending_count,
      fetching_count = EXCLUDED.fetching_count,
      done_count = EXCLUDED.done_count,
      failed_count = EXCLUDED.failed_count,
      last_crawled_at = EXCLUDED.last_crawled_at
  `);
}

/**
 * Retrieves per-domain statistics.
 */
export async function getDomainStats(): Promise<DomainStats[]> {
  const res = await query(
    `SELECT domain, pending_count, fetching_count, done_count, failed_count, last_crawled_at
     FROM domain_stats
     ORDER BY domain ASC`
  );
  return res.rows.map((row) => ({
    domain: row.domain,
    pending_count: parseInt(row.pending_count, 10),
    fetching_count: parseInt(row.fetching_count, 10),
    done_count: parseInt(row.done_count, 10),
    failed_count: parseInt(row.failed_count, 10),
    last_crawled_at: row.last_crawled_at ? new Date(row.last_crawled_at) : null,
  }));
}

