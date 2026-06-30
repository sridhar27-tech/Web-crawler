import { downloadPage } from "./downloader.js";
import { extractPageData } from "./extractor.js";
import { normalizeURL, getDomain } from "../normalizer.js";
import { insertURL, insertLink, markFailed } from "../db/queries.js";
import { config } from "../config.js";
import { isAllowedByRobots } from "../frontier/robots.js";
import { getStrategy } from "../output/index.js";

function isDomainAllowed(domain: string): boolean {
  if (!config.ALLOWED_DOMAINS || config.ALLOWED_DOMAINS.length === 0) {
    return true;
  }
  return config.ALLOWED_DOMAINS.includes(domain);
}

/**
 * Handles the complete crawling workflow for a single URL:
 * 1. Downloads the page HTML (handling redirects & timeouts).
 * 2. Extracts title, description, canonical, headings, text content, and outgoing links.
 * 3. Delegates persistence to the active OutputStrategy (DB or PDF).
 * 4. Filters, normalizes, and enqueues discovered links, establishing link graph relations.
 */
export async function processPage(urlRow: { id: number; url: string; depth: number }): Promise<void> {
  const urlId = urlRow.id;
  const pageUrl = urlRow.url;
  const currentDepth = urlRow.depth;

  try {
    // 0. Check robots.txt compliance
    const allowed = await isAllowedByRobots(pageUrl);
    if (!allowed) {
      await markFailed(urlId, "Disallowed by robots.txt");
      return;
    }

    // 1. Download page content
    const downloadResult = await downloadPage(pageUrl);

    // 2. Extract content & outgoing links
    const extracted = extractPageData(downloadResult.html, downloadResult.url);

    // Resolve final URL using canonical link if present
    let finalUrl = downloadResult.url;
    if (extracted.canonicalUrl) {
      const normalizedCanonical = normalizeURL(extracted.canonicalUrl, finalUrl);
      if (normalizedCanonical) {
        finalUrl = normalizedCanonical;
      }
    }

    // 3. Persist content via the active output strategy (DB or PDF)
    const strategy = getStrategy();
    await strategy.save(urlId, finalUrl, {
      title: extracted.title,
      description: extracted.description,
      canonicalUrl: extracted.canonicalUrl,
      headings: extracted.headings,
      textContent: extracted.textContent,
      blocks: extracted.blocks,
      images: extracted.images,
    });

    // 4. Process outgoing links
    const uniqueNormalizedLinks = new Set<string>();

    for (const link of extracted.links) {
      const normalized = normalizeURL(link, finalUrl);
      if (!normalized) continue;

      // Skip self-referential links
      if (normalized === finalUrl || normalized === pageUrl) continue;

      const linkDomain = getDomain(normalized);
      if (!linkDomain || !isDomainAllowed(linkDomain)) continue;

      uniqueNormalizedLinks.add(normalized);
    }

    for (const normalizedLink of uniqueNormalizedLinks) {
      const nextDepth = currentDepth + 1;

      // Enforce MAX_DEPTH limit
      if (nextDepth > config.MAX_DEPTH) {
        continue;
      }

      const targetDomain = getDomain(normalizedLink)!;

      // Insert target URL (ON CONFLICT DO NOTHING) and get its ID
      const targetUrlId = await insertURL(normalizedLink, targetDomain, nextDepth);

      // Establish link graph relation
      await insertLink(urlId, targetUrlId);
    }
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await markFailed(urlId, errorMsg);
    throw error;
  }
}
