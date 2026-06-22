# Web Crawler

An interactive, CLI-driven web crawler built with Node.js, TypeScript, and a PostgreSQL backend. Specifically engineered to systematically extract and compile programming-related documentation from seed URLs, the crawler offers flexible output strategies — structured database records or compiled PDF eBooks — with politeness constraints, domain filtering, and depth controls.

## System Requirements

- **Node.js** (version 18 or greater)
- **PostgreSQL** (local or hosted instance like Supabase)

## Features

### Interactive CLI Wizard
Run `npm run crawl` to launch an interactive setup wizard that guides you through:
- **Output mode selection** — Database (structured records) or PDF (compiled eBook)
- **Seed URL source** — Use URLs from `seeds.txt`, config defaults, or enter custom URLs
- **Performance tuning** — Configure depth, crawl delay, worker count, and page limits

### Flexible Output Strategies
- **Database mode** — Stores extracted content (URL, title, description, headings, text) as structured records in PostgreSQL with link graph tracking
- **PDF mode** — Compiles all crawled pages into a formatted PDF eBook with cover page, table of contents, and styled chapters. PDFs are auto-versioned (`documentation.pdf`, `documentation2.pdf`, etc.) to avoid overwrites

### Safety & Politeness
- **Minimum crawl delay** — Enforces a 500ms floor on `CRAWL_DELAY_MS` to prevent accidental aggressive request rates
- **Robots.txt compliance** — Respects disallow directives per domain
- **Domain filtering** — Restricts crawling to seed domains only; child links outside allowed domains are ignored
- **Concurrency limits** — Configurable worker pool to control concurrent requests

### Session-Scoped Crawling
- Each run filters the DB queue to only process URLs matching the current session's allowed domains
- Stale pending URLs from previous runs are automatically cleared at startup
- Session page counter tracks progress independently of cumulative DB totals

## Configuration

The crawler is configured interactively via the CLI wizard, but you can also pre-set defaults using environment variables or `src/config.ts`.

### Environment Variables (`.env`)
Create a `.env` file in the root directory with:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
MAX_DEPTH=3
CRAWL_DELAY_MS=1000
WORKER_COUNT=5
MAX_PAGES=1000
OUTPUT_MODE=database
```

### Seed URLs (`seeds.txt`)
Add target URLs to `seeds.txt`, one per line:

```
# Programming documentation sources
https://react.dev
https://developer.mozilla.org
https://www.typescriptlang.org/
```

Lines starting with `#` are ignored. The wizard defaults to using `seeds.txt` if present.

### Configuration Fields

| Field              | Description                                                                 | Default       |
|--------------------|-----------------------------------------------------------------------------|---------------|
| `MAX_DEPTH`        | Maximum link hops from seed URLs (0 = seeds only)                          | `3`           |
| `CRAWL_DELAY_MS`   | Politeness delay per domain (min 500ms enforced)                           | `1000`        |
| `WORKER_COUNT`     | Number of concurrent workers                                               | `5`           |
| `MAX_PAGES`        | Page limit per session (0 = unlimited)                                     | `1000`        |
| `OUTPUT_MODE`      | Output destination: `database` or `pdf`                                    | `database`    |
| `DATABASE_URL`     | PostgreSQL connection string                                               | (required)    |

## Database Setup

Before running the crawler, initialize the database schema.

### 1. Create the database
```sql
CREATE DATABASE web_crawler;
```

### 2. Apply the schema
```bash
psql -U postgres -d web_crawler -f src/db/schema.sql
```

Or if using a hosted service like Supabase, run the contents of `src/db/schema.sql` in the SQL editor.

### 3. Configure the connection
Update `DATABASE_URL` in `.env` with your connection string:
```
DATABASE_URL=postgresql://postgres:password@db.example.supabase.co:5432/postgres
```

## Usage

### Start the Crawler
```bash
npm run crawl
```
This launches the interactive wizard, then starts crawling with your chosen settings.

### Pre-configure (optional)
```bash
npm run config
```
Runs the standalone configuration wizard, writes settings to `.env` and patches `src/config.ts`.

### Clear the Database
```bash
npm run db:clear
```
Truncates all tables and resets the crawler state.

### Run Tests
```bash
npm test
```

## Output

### Database Mode
Crawled data is stored across four tables:
- **`urls`** — All discovered URLs with status tracking (`PENDING`, `FETCHING`, `DONE`, `FAILED`)
- **`crawled_pages`** — Extracted content (title, description, headings, text)
- **`links`** — Link graph edges (from → to relationships)
- **`domain_stats`** — Per-domain aggregate statistics

Query examples:
```sql
-- Get all successfully crawled pages
SELECT url, title FROM crawled_pages 
JOIN urls ON crawled_pages.url_id = urls.id;

-- View domain statistics
SELECT * FROM domain_stats;
```

### PDF Mode
Each crawl generates a compiled PDF in `output/`:
- `documentation.pdf` (first run)
- `documentation2.pdf` (second run)
- etc.

PDFs include:
- Styled cover page with generation timestamp
- One chapter per crawled page with title, URL, description, headings outline, and body text
- Footer with page numbers

## Architecture

### Core Components

| Module                     | Purpose                                                              |
|----------------------------|----------------------------------------------------------------------|
| `src/index.ts`             | Main entry point; runs CLI wizard and orchestrates crawl session   |
| `src/setup.ts`             | Standalone configuration wizard (for `npm run config`)             |
| `src/frontier/scheduler.ts`| Round-robin scheduler with politeness delays and concurrency limits |
| `src/worker/worker.ts`     | Processes individual URLs: download, extract, persist              |
| `src/worker/downloader.ts` | HTTP client with redirect handling and timeouts                    |
| `src/worker/extractor.ts`  | Cheerio-based HTML parser for metadata and content                 |
| `src/output/`              | Strategy pattern for output destinations (DB or PDF)               |
| `src/db/queries.ts`        | Database queries for URL state management and link tracking        |
| `src/frontier/robots.ts`   | Robots.txt parser with per-domain caching                          |

### Design Patterns

- **Strategy Pattern** — Output destinations (`DatabaseStrategy`, `PdfStrategy`) implement a common `OutputStrategy` interface, allowing runtime switching
- **Round-robin scheduling** — Domains are processed in rotation with per-domain cooldowns to enforce politeness delays
- **Optimistic locking** — PostgreSQL `FOR UPDATE SKIP LOCKED` prevents workers from claiming the same URL

## Safety & Best Practices

- **Politeness floor** — `CRAWL_DELAY_MS` cannot be set below 500ms; attempts to do so are flagged and auto-corrected
- **Domain scoping** — Only URLs matching `ALLOWED_DOMAINS` (derived from seeds) are crawled
- **Robots.txt compliance** — URLs disallowed by `robots.txt` are marked failed without download
- **Graceful shutdown** — On reaching `MAX_PAGES`, the scheduler waits for in-flight workers to complete before closing the DB pool
- **Crash recovery** — On startup, any URLs stuck in `FETCHING` state are reset to `PENDING`

## Troubleshooting

### Database connection errors
- Verify `DATABASE_URL` is correct and the database exists
- Check that the host/port is reachable (port 5432 is commonly blocked on public networks; use Supabase's connection pooler on port 6543 if needed)
- Ensure the password is URL-encoded if it contains special characters

### Crawler picks up wrong URLs
- Run `npm run db:clear` to wipe stale data from previous runs
- Verify `seeds.txt` contains only the URLs you want
- Check that `ALLOWED_DOMAINS` in the wizard output matches your intent

### Crawl delay too aggressive
- The minimum is 500ms. If you set a lower value, it's automatically raised with a warning.
- Increase `CRAWL_DELAY_MS` if target servers rate-limit or block requests

## License

ISC

## Repository

[github.com/lightning4747/Web-crawler](https://github.com/lightning4747/Web-crawler)
