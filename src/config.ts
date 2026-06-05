import dotenv from "dotenv";
dotenv.config();

export const config = {
  MAX_DEPTH: parseInt(process.env.MAX_DEPTH || "3", 10),
  CRAWL_DELAY_MS: parseInt(process.env.CRAWL_DELAY_MS || "1000", 10),
  WORKER_COUNT: parseInt(process.env.WORKER_COUNT || "10", 10),
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10),
  MAX_REDIRECTS: parseInt(process.env.MAX_REDIRECTS || "5", 10),
  MAX_PAGES: parseInt(process.env.MAX_PAGES || "1000", 10),

  SEED_URLS: [
    "https://react.dev",
    "https://developer.mozilla.org",
    "https://www.typescriptlang.org/",
  ],

  ALLOWED_DOMAINS: [
    "react.dev",
    "developer.mozilla.org",
    "typescriptlang.org",
  ],
};