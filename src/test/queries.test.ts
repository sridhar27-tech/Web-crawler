import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module directly
vi.mock("../db/client.js", () => {
  return {
    query: vi.fn(),
    pool: {
      connect: vi.fn(),
    },
  };
});

// Import the mocked query and pool
import { query, pool } from "../db/client.js";
import { claimNextURL, markDone, markFailed, insertURL, insertLink, resetStaleLocks } from "../db/queries.js";

const mockedQuery = vi.mocked(query);
const mockedPool = vi.mocked(pool);

describe("Database Queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockReset().mockResolvedValue({ rows: [] } as any);
    mockedPool.connect.mockReset();
  });

  describe("claimNextURL", () => {
    it("should return the row if a PENDING URL is found", async () => {
      const mockRow = { id: 1, url: "https://react.dev", domain: "react.dev", status: "FETCHING", depth: 0 };
      mockedQuery.mockResolvedValue({ rows: [mockRow] } as any);

      const result = await claimNextURL("react.dev");

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE urls"), ["react.dev"]);
      expect(result).toEqual(mockRow);
    });

    it("should return null if no PENDING URL is found", async () => {
      mockedQuery.mockResolvedValue({ rows: [] } as any);

      const result = await claimNextURL("react.dev");

      expect(result).toBeNull();
    });
  });

  describe("markDone", () => {
    it("should execute queries in a transaction", async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({}),
        release: vi.fn(),
      };
      mockedPool.connect.mockResolvedValue(mockClient as any);

      const content = {
        title: "React",
        description: "Library",
        canonicalUrl: "https://react.dev",
        headings: { h1: ["H1"], h2: [], h3: [] },
        textContent: "Body content",
      };

      await markDone(1, content);

      expect(mockedPool.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO crawled_pages"),
        [1, "React", "Library", "https://react.dev", JSON.stringify(content.headings), "Body content"]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE urls"),
        [1]
      );
      expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it("should rollback transaction on error", async () => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("INSERT INTO crawled_pages")) {
            throw new Error("DB Error");
          }
          return Promise.resolve({});
        }),
        release: vi.fn(),
      };
      mockedPool.connect.mockResolvedValue(mockClient as any);

      const content = {
        title: "React",
        description: "Library",
        canonicalUrl: "https://react.dev",
        headings: { h1: ["H1"], h2: [], h3: [] },
        textContent: "Body content",
      };

      await expect(markDone(1, content)).rejects.toThrow("DB Error");

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe("markFailed", () => {
    it("should update status to FAILED with error message", async () => {
      mockedQuery.mockResolvedValue({ rows: [] } as any);
      await markFailed(1, "Connection timeout");

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE urls"),
        [1, "Connection timeout"]
      );
    });
  });

  describe("insertURL", () => {
    it("should return the ID of the URL", async () => {
      mockedQuery.mockResolvedValue({ rows: [{ id: 42 }] } as any);

      const id = await insertURL("https://react.dev", "react.dev", 1);

      expect(id).toBe(42);
      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("WITH ins AS"),
        ["https://react.dev", "react.dev", 1]
      );
    });
  });

  describe("insertLink", () => {
    it("should insert edge into links table", async () => {
      mockedQuery.mockResolvedValue({ rows: [] } as any);
      await insertLink(1, 2);

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO links"),
        [1, 2]
      );
    });
  });

  describe("resetStaleLocks", () => {
    it("should reset FETCHING urls back to PENDING", async () => {
      mockedQuery.mockResolvedValue({ rows: [] } as any);
      await resetStaleLocks();

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE urls")
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'PENDING'")
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'FETCHING'")
      );
    });
  });
});
