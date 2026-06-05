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
