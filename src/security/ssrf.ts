import { lookup } from "node:dns/promises";

/**
 * IP range patterns that must never be requested.
 * Covers loopback, private, link-local, and cloud metadata addresses.
 */
const BLOCKED_IP_RANGES: RegExp[] = [
  /^127\./,                           // loopback
  /^10\./,                            // private Class A
  /^172\.(1[6-9]|2\d|3[01])\./,      // private Class B
  /^192\.168\./,                      // private Class C
  /^169\.254\./,                      // link-local / cloud IMDS (AWS, GCP, Azure)
  /^0\./,                             // current network
  /^::1$/,                            // IPv6 loopback
  /^fc00:/i,                          // IPv6 unique local
  /^fe80:/i,                          // IPv6 link-local
  /^100\.64\./,                       // shared address space (RFC 6598)
];

/**
 * Hostnames that are blocked regardless of DNS resolution.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

/**
 * Returns true if the hostname resolves to a private/internal address.
 * Fails closed — if DNS lookup throws, the address is considered blocked.
 */
export async function isBlockedAddress(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  // Reject raw IP literals that match blocked ranges without a DNS lookup
  if (BLOCKED_IP_RANGES.some((r) => r.test(hostname))) return true;

  try {
    const { address } = await lookup(hostname);
    return BLOCKED_IP_RANGES.some((r) => r.test(address));
  } catch {
    // DNS resolution failed — fail closed
    return true;
  }
}
