import * as cheerio from "cheerio";

export interface ContentBlock {
  type: "heading" | "paragraph" | "list" | "image";
  text?: string;
  level?: number;
  items?: string[];
  src?: string;
  alt?: string;
}

export interface ExtractedImage {
  src: string;
  alt: string;
}

export interface ExtractedData {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  textContent: string | null;
  links: string[];
  blocks?: ContentBlock[];
  images?: ExtractedImage[];
}

/**
 * Extracts metadata, headings, structured text content blocks, images, and outgoing links from HTML.
 * Strips site chrome and uses a text-density heuristic if no main content container is found.
 */
export function extractPageData(html: string, baseUrl?: string): ExtractedData {
  const $ = cheerio.load(html);

  const title = $("title").text().trim() || null;
  const description = $("meta[name=description]").attr("content")?.trim() || null;
  const canonicalUrl = $("link[rel=canonical]").attr("href")?.trim() || null;

  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];

  $("h1").each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1.push(text);
  });
  $("h2").each((_, el) => {
    const text = $(el).text().trim();
    if (text) h2.push(text);
  });
  $("h3").each((_, el) => {
    const text = $(el).text().trim();
    if (text) h3.push(text);
  });

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (href) {
      links.push(href);
    }
  });

  // Determine resolution base URL for images
  const resolutionBase = canonicalUrl || baseUrl || null;

  // 1. Main-content heuristic selection
  let mainNode = $("article").first();
  if (mainNode.length === 0) {
    mainNode = $("main").first();
  }
  if (mainNode.length === 0) {
    mainNode = $("[role=main]").first();
  }

  // Fallback text-density heuristic
  if (mainNode.length === 0) {
    const totalBodyText = $("body").text().trim();
    const minTextLength = Math.min(200, totalBodyText.length * 0.1);
    let bestNode = $("body");
    let maxScore = -1;

    $("div, section").each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const textLength = text.length;
      if (textLength < minTextLength) return;

      const tagCount = $el.find("*").length;
      const score = textLength / (tagCount + 1);

      if (score > maxScore) {
        maxScore = score;
        bestNode = $el;
      }
    });

    mainNode = bestNode;
  }

  // 2. Clone and clean the chosen node
  const cleanedNode = mainNode.clone();
  cleanedNode.find("script, style, noscript, iframe, nav, footer, header").remove();

  // 3. Extract in-order content blocks and overall images list
  const blocks: ContentBlock[] = [];
  const images: ExtractedImage[] = [];

  // Extract all images inside the cleaned main node
  cleanedNode.find("img").each((_, img) => {
    const src = $(img).attr("src")?.trim();
    const alt = $(img).attr("alt")?.trim() || "";
    if (src) {
      let resolvedSrc = src;
      if (resolutionBase) {
        try {
          resolvedSrc = new URL(src, resolutionBase).href;
        } catch {
          // keep relative src if resolution fails
        }
      }
      images.push({ src: resolvedSrc, alt });
    }
  });

  // Track if we need to force a new paragraph on the next text node
  let forceNewParagraph = true;

  function walk(node: any) {
    if (node.type === "text") {
      const text = (node as any).data.replace(/\s+/g, " ").trim();
      if (text) {
        const lastBlock = blocks[blocks.length - 1];
        if (!forceNewParagraph && lastBlock && lastBlock.type === "paragraph") {
          lastBlock.text = (lastBlock.text + " " + text).replace(/\s+/g, " ").trim();
        } else {
          blocks.push({ type: "paragraph", text });
          forceNewParagraph = false;
        }
      }
      return;
    }

    if (node.type !== "tag") {
      return;
    }

    const el = node as any;
    const tagName = el.tagName?.toLowerCase();

    // Skip removed elements just in case
    if (["script", "style", "noscript", "iframe", "nav", "footer", "header"].includes(tagName)) {
      return;
    }

    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName.substring(1), 10);
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) {
        blocks.push({ type: "heading", level, text });
      }
      forceNewParagraph = true;
    } else if (tagName === "p") {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
      forceNewParagraph = true;
    } else if (tagName === "ul" || tagName === "ol") {
      const items: string[] = [];
      $(el).find("li").each((_, li) => {
        const itemText = $(li).text().replace(/\s+/g, " ").trim();
        if (itemText) items.push(itemText);
      });
      if (items.length > 0) {
        blocks.push({ type: "list", items });
      }
      forceNewParagraph = true;
    } else if (tagName === "img") {
      const src = $(el).attr("src")?.trim();
      const alt = $(el).attr("alt")?.trim() || "";
      if (src) {
        let resolvedSrc = src;
        if (resolutionBase) {
          try {
            resolvedSrc = new URL(src, resolutionBase).href;
          } catch {
            // keep as is
          }
        }
        blocks.push({ type: "image", src: resolvedSrc, alt });
      }
      forceNewParagraph = true;
    } else if (tagName === "br") {
      forceNewParagraph = true;
    } else {
      // For general container tags (div, span, etc.), walk contents recursively
      $(el).contents().each((_, child) => {
        walk(child);
      });
    }
  }

  cleanedNode.contents().each((_, child) => {
    walk(child);
  });

  // Fallback textContent: concatenated paragraphs / lists for backwards compatibility
  const textContentParts: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" && block.text) {
      textContentParts.push(block.text);
    } else if (block.type === "heading" && block.text) {
      textContentParts.push(block.text);
    } else if (block.type === "list" && block.items) {
      textContentParts.push(block.items.join(" "));
    }
  }
  const textContent = textContentParts.join(" ").replace(/\s+/g, " ").trim() || null;

  return {
    title,
    description,
    canonicalUrl,
    headings: { h1, h2, h3 },
    textContent,
    links,
    blocks,
    images,
  };
}
