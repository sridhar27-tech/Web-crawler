# Web Crawler

Herein lies a Node.js and TypeScript web crawler, built for the purpose of collecting programming-related documentation. 

The crawler traverse pages starting from configured seed URLs, extracting text content and metadata, saving the data to a PostgreSQL database.

## System Requirements

- Node.js (version 18 or greater)
- PostgreSQL

## Configuration

Configure the crawler by placing a `.env` file in the root directory. The configuration settings include:

- `MAX_DEPTH`: The maximum distance in link traversals from the seed URLs.
- `CRAWL_DELAY_MS`: The politeness delay enforced between requests to the same domain.
- `WORKER_COUNT`: The number of concurrent workers executing requests.
- `DATABASE_URL`: Connection string for the PostgreSQL database.

## Database Initialization

Before running the crawler, one must establish the database and its tables.

1. Connect to PostgreSQL and create the database:
   ```sql
   CREATE DATABASE web_crawler;
   ```

2. Initialize the schema:
   ```bash
   psql -U postgres -d web_crawler -f src/db/schema.sql
   ```

## Usage

Commands whereby the crawler is controlled:

- `npm run crawl`: Compile the source files and start the crawler.
- `npm run db:clear`: Truncate all tables and reset the crawler state.
- `npm test`: Run the unit and integration tests.