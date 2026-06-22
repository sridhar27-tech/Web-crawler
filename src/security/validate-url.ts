/**
 * Validates that a string is a well-formed HTTP or HTTPS URL.
 * Returns the parsed URL on success, or a descriptive error string on failure.
 */
export function validateSeedUrl(raw: string): { url: URL; error: null } | { url: null; error: string } {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, error: `"${raw}" is not a valid URL` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      url: null,
      error: `"${raw}" uses scheme "${parsed.protocol.replace(":", "")}" — only http and https are allowed`,
    };
  }

  if (!parsed.hostname) {
    return { url: null, error: `"${raw}" has no hostname` };
  }

  return { url: parsed, error: null };
}

/**
 * Validates a list of URL strings.
 * Returns valid URLs and a list of { input, reason } error objects.
 */
export function validateSeedUrls(raws: string[]): {
  valid: string[];
  invalid: Array<{ input: string; reason: string }>;
} {
  const valid: string[] = [];
  const invalid: Array<{ input: string; reason: string }> = [];

  for (const raw of raws) {
    const result = validateSeedUrl(raw);
    if (result.error) {
      invalid.push({ input: raw, reason: result.error });
    } else {
      valid.push(raw);
    }
  }

  return { valid, invalid };
}
