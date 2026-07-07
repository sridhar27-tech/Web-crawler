import { describe, it, expect } from "vitest";
import { extractPageData } from "../worker/extractor.js";

describe("HTML Extractor", () => {
  it("should extract metadata, headings, clean text, and links", () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="This is a test description.">
          <link rel="canonical" href="https://example.com/canonical-url">
        </head>
        <body>
          <style>body { color: red; }</style>
          <h1>Heading One</h1>
          <h2>Heading Two</h2>
          <h3>Heading Three</h3>
          <p>This is some body text. <a href="/about">About Us</a> and <a href="https://google.com">Google</a>.</p>
          <script>console.log("hello");</script>
        </body>
      </html>
    `;

    const result = extractPageData(sampleHtml);

    expect(result.title).toBe("Test Page Title");
    expect(result.description).toBe("This is a test description.");
    expect(result.canonicalUrl).toBe("https://example.com/canonical-url");
    expect(result.headings).toEqual({
      h1: ["Heading One"],
      h2: ["Heading Two"],
      h3: ["Heading Three"],
    });
    // Style and script tags should be stripped, only body paragraph and headings remain
    expect(result.textContent).toContain("Heading One Heading Two Heading Three This is some body text. About Us and Google.");
    expect(result.textContent).not.toContain("color: red");
    expect(result.textContent).not.toContain("console.log");
    
    expect(result.links).toEqual(["/about", "https://google.com"]);
  });

  it("should handle missing tags gracefully", () => {
    const sampleHtml = `
      <html>
        <body>
          <p>Just some text</p>
        </body>
      </html>
    `;

    const result = extractPageData(sampleHtml);

    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
    expect(result.canonicalUrl).toBeNull();
    expect(result.headings).toEqual({ h1: [], h2: [], h3: [] });
    expect(result.textContent).toBe("Just some text");
    expect(result.links).toEqual([]);
  });

  it("should select main content via tags (article/main/role=main) and remove chrome", () => {
    const html = `
      <html>
        <body>
          <header><nav>Header navigation links</nav></header>
          <div role="main">
            <article>
              <h1>Article Title</h1>
              <p>This is the actual article content.</p>
              <footer>Article footer inside main</footer>
            </article>
          </div>
          <footer>Site footer chrome</footer>
        </body>
      </html>
    `;
    const result = extractPageData(html);
    // Note: article footer and header nav should be removed
    expect(result.textContent).toBe("Article Title This is the actual article content.");
    expect(result.textContent).not.toContain("Header navigation links");
    expect(result.textContent).not.toContain("Site footer chrome");
  });

  it("should select main content via text density score when no tag is present", () => {
    const html = `
      <html>
        <body>
          <div class="sidebar">
            <p>Nav 1</p>
            <p>Nav 2</p>
          </div>
          <div class="content">
            <p>This is a much longer paragraph with a lot of text to ensure it has a higher text density compared to the sidebar. It contains many words and represents the main article body.</p>
            <p>Another paragraph to increase text density even more.</p>
          </div>
        </body>
      </html>
    `;
    const result = extractPageData(html);
    expect(result.textContent).toContain("This is a much longer paragraph");
    expect(result.textContent).not.toContain("Nav 1");
  });

  it("should extract structured blocks and resolve image URLs", () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>Title</h1>
            <p>Intro paragraph.</p>
            <ul>
              <li>Item A</li>
              <li>Item B</li>
            </ul>
            <img src="/assets/photo.jpg" alt="A nice photo">
          </article>
        </body>
      </html>
    `;
    const result = extractPageData(html, "https://example.com/blog/post-1");
    
    expect(result.blocks).toBeDefined();
    expect(result.blocks!.length).toBe(4);
    expect(result.blocks![0]).toEqual({ type: "heading", level: 1, text: "Title" });
    expect(result.blocks![1]).toEqual({ type: "paragraph", text: "Intro paragraph." });
    expect(result.blocks![2]).toEqual({ type: "list", items: ["Item A", "Item B"] });
    expect(result.blocks![3]).toEqual({
      type: "image",
      src: "https://example.com/assets/photo.jpg",
      alt: "A nice photo",
    });

    expect(result.images).toEqual([
      { src: "https://example.com/assets/photo.jpg", alt: "A nice photo" },
    ]);
  });
});

