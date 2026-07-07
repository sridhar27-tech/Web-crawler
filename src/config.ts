import dotenv from "dotenv";
dotenv.config();

export const config = {
  MAX_DEPTH: parseInt(process.env.MAX_DEPTH || "3", 10),
  CRAWL_DELAY_MS: parseInt(process.env.CRAWL_DELAY_MS || "1000", 10),
  WORKER_COUNT: parseInt(process.env.WORKER_COUNT || "10", 10),
  REQUEST_TIMEOUT_MS: parseInt(process.env.REQUEST_TIMEOUT_MS || "10000", 10),
  MAX_REDIRECTS: parseInt(process.env.MAX_REDIRECTS || "5", 10),
  MAX_PAGES: parseInt(process.env.MAX_PAGES || "1000", 10),

  /** Output destination: "database" | "pdf" */
  OUTPUT_MODE: (process.env.OUTPUT_MODE || "database") as "database" | "pdf",

  SEED_URLS: [
    "https://www.akc.org/dog-breeds/",
  ],

  ALLOWED_DOMAINS: [
    "www.akc.org",
  ],
};