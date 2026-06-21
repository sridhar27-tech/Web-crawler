import { query } from "../db/client.js";
import { config } from "../config.js";

/**
 * Retrieves the list of unique domains that have at least one pending URL,
 * restricted to the domains allowed in the current crawl session.
 */
export async function getPendingDomains(): Promise<string[]> {
  const allowed = config.ALLOWED_DOMAINS;

  // If ALLOWED_DOMAINS is populated, filter at the DB level so the scheduler
  // never even sees pending rows from outside the current session's scope.
  if (allowed && allowed.length > 0) {
    const res = await query(
      `SELECT DISTINCT domain
       FROM urls
       WHERE status = 'PENDING'
         AND domain = ANY($1::text[])`,
      [allowed]
    );
    return res.rows.map((row) => row.domain);
  }

  const res = await query(
    `SELECT DISTINCT domain
     FROM urls
     WHERE status = 'PENDING'`
  );
  return res.rows.map((row) => row.domain);
}

/**
 * Retrieves the count of pending URLs bucketed by domain,
 * restricted to the allowed domains in the current session.
 */
export async function getPendingCounts(): Promise<Record<string, number>> {
  const allowed = config.ALLOWED_DOMAINS;

  const res = allowed && allowed.length > 0
    ? await query(
        `SELECT domain, COUNT(*) as count
         FROM urls
         WHERE status = 'PENDING'
           AND domain = ANY($1::text[])
         GROUP BY domain`,
        [allowed]
      )
    : await query(
        `SELECT domain, COUNT(*) as count
         FROM urls
         WHERE status = 'PENDING'
         GROUP BY domain`
      );

  const counts: Record<string, number> = {};
  for (const row of res.rows) {
    counts[row.domain] = parseInt(row.count, 10);
  }
  return counts;
}
