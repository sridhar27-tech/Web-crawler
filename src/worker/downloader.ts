import { request } from "undici";
import { config } from "../config.js";
import { isBlockedAddress } from "../security/ssrf.js";

export interface DownloaderResult {
  url: string;
  html: string;
  statusCode: number;
}

/**
 * Guards against SSRF by resolving the hostname before the request is made.
 * Throws if the address is private, loopback, or link-local.
 */
async function assertNotBlocked(url: string): Promise<void> {
  const hostname = new URL(url).hostname;
  if (await isBlockedAddress(hostname)) {
    throw new Error(`SSRF blocked: "${hostname}" resolves to a private or internal address`);
  }
}

/**
 * Fetches the HTML content of a page, following redirects up to MAX_REDIRECTS.
 * Tracks the final URL, enforces a request timeout, and blocks SSRF targets.
 */
export async function downloadPage(initialUrl: string): Promise<DownloaderResult> {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  // SSRF check on the initial URL before any network activity
  await assertNotBlocked(currentUrl);

  while (true) {
    const res = await request(currentUrl, {
      method: "GET",
      headersTimeout: config.REQUEST_TIMEOUT_MS,
      bodyTimeout: config.REQUEST_TIMEOUT_MS,
    });

    const statusCode = res.statusCode;

    // Handle redirects (301, 302, 303, 307, 308)
    if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
      if (redirectCount >= config.MAX_REDIRECTS) {
        await res.body.text(); // consume body to release connection
        throw new Error("Too many redirects");
      }

      const location = Array.isArray(res.headers.location)
        ? res.headers.location[0]
        : res.headers.location;

      const nextUrl = new URL(location, currentUrl).href;

      // SSRF check on every redirect target before following
      await assertNotBlocked(nextUrl);

      currentUrl = nextUrl;
      redirectCount++;

      await res.body.text(); // consume body
      continue;
    }

    // Error on non-200 responses
    if (statusCode !== 200) {
      await res.body.text();
      throw new Error(`HTTP status ${statusCode}`);
    }

    // Skip non-HTML content types
    const contentTypeHeader = res.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader;

    if (contentType && !contentType.includes("text/html")) {
      await res.body.text();
      throw new Error(`Non-HTML content type: ${contentType}`);
    }

    const html = await res.body.text();
    return { url: currentUrl, html, statusCode };
  }
}
