import fs from "fs";
import path from "path";
import PDFDocumentCtor from "pdfkit";
import type { OutputStrategy } from "./strategy.js";
import { markDone, type CrawledPageContent } from "../db/queries.js";
import { downloadImage } from "../worker/downloader.js";

type PDFDocumentInstance = InstanceType<typeof PDFDocumentCtor>;

const OUTPUT_DIR = "output";
const BASE_NAME  = "documentation";

function resolveOutputPath(): string {
  const first = path.join(OUTPUT_DIR, `${BASE_NAME}.pdf`);
  if (!fs.existsSync(first)) return first;
  let n = 2;
  while (fs.existsSync(path.join(OUTPUT_DIR, `${BASE_NAME}${n}.pdf`))) n++;
  return path.join(OUTPUT_DIR, `${BASE_NAME}${n}.pdf`);
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const MARGIN          = 64;
const FOOTER_HEIGHT   = 28;   // reserved space at bottom for footer
const MAX_TEXT_CHARS  = 5000;

// ─── Colour palette ───────────────────────────────────────────────────────────

const C = {
  title:     "#1a1a2e",
  url:       "#4361ee",
  desc:      "#444444",
  section:   "#2d6a4f",
  body:      "#222222",
  truncated: "#aaaaaa",
  rule:      "#dddddd",
  coverBg:   "#1a1a2e",
  coverFg:   "#ffffff",
  coverSub:  "#a8dadc",
  badge:     "#888888",
  footer:    "#aaaaaa",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Draws a horizontal rule at the current cursor Y and advances by `gap` points.
 * Uses an absolute move so it never inherits stale font metrics.
 */
function rule(doc: PDFDocumentInstance, color = C.rule, gap = 10): void {
  const y = doc.y;
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(color)
    .lineWidth(0.5)
    .stroke();
  doc.y = y + gap;   // advance cursor by exact points, not line-height multiples
}

/**
 * Normalises raw scraped text:
 *  - Collapses runs of whitespace/newlines into a single space
 *  - Trims leading/trailing whitespace
 * This prevents the large blank gaps that `paragraphGap` creates when the
 * extractor's output happens to contain stray newline characters.
 */
function normaliseText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Returns the usable content height on the current page
 * (page height minus top margin, bottom margin, and footer reservation).
 */
function contentBottom(doc: PDFDocumentInstance): number {
  return doc.page.height - MARGIN - FOOTER_HEIGHT;
}

// ─── Strategy ────────────────────────────────────────────────────────────────

export class PdfStrategy implements OutputStrategy {
  private doc!: PDFDocumentInstance;
  private stream!: fs.WriteStream;
  private pageCount = 0;
  private pdfPath!: string;

  async init(): Promise<void> {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    this.pdfPath = resolveOutputPath();

    this.doc = new PDFDocumentCtor({
      autoFirstPage: false,
      bufferPages: true,
      // Explicit margins so pdfkit never auto-paginates into blank pages
      // due to cursor running past the bottom margin.
      margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
      info: {
        Title:   "Checkout the repo https://github.com/lightning4747/Web-crawler-cli",
        Author:  "Web Crawler",
        Subject: "Compiled documentation from crawled pages",
      },
    });

    this.stream = fs.createWriteStream(this.pdfPath);
    this.doc.pipe(this.stream);
    this.renderCover();
    console.log(`[PDF] Output file: ${this.pdfPath}`);
  }

  // ── Cover page ──────────────────────────────────────────────────────────────

  private renderCover(): void {
    const doc = this.doc;
    doc.addPage();

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.coverBg);

    const midY = doc.page.height / 2 - 60;

    doc.fontSize(38).font("Helvetica-Bold").fillColor(C.coverFg)
      .text("Web Crawler", MARGIN, midY, { align: "center" });

    // Advance by exact points to avoid font-size-based gaps
    doc.y += 8;

    doc.fontSize(32).font("Helvetica-Bold").fillColor(C.coverSub)
      .text("Documentation Book", { align: "center" });

    doc.y += 28;

    doc.fontSize(11).font("Helvetica").fillColor(C.coverFg)
      .text("https://github.com/lightning4747/Web-crawler-cli", { align: "center", link: "https://github.com/lightning4747/Web-crawler-cli" });

    doc.y += 8;

    doc.fontSize(10).font("Helvetica").fillColor(C.coverSub)
      .text(new Date().toUTCString(), { align: "center" });
  }

  // ── Chapter page ────────────────────────────────────────────────────────────

  async save(urlId: number, url: string, content: CrawledPageContent): Promise<void> {
    await markDone(urlId, content);

    const doc   = this.doc;
    this.pageCount++;
    doc.addPage();

    const W     = doc.page.width - MARGIN * 2;   // usable text width
    const limit = contentBottom(doc);             // y-coordinate of content boundary

    // ── Chapter badge (top-right, absolute position) ─────────────────────────
    doc.fontSize(8).font("Helvetica").fillColor(C.badge)
      .text(`CHAPTER ${this.pageCount}`, MARGIN, MARGIN, { width: W, align: "right" });

    // Place cursor just below the badge — use exact points, not moveDown
    doc.y = MARGIN + 14;

    // ── Title ─────────────────────────────────────────────────────────────────
    doc.fontSize(22).font("Helvetica-Bold").fillColor(C.title)
      .text(content.title ?? url, { width: W, lineGap: 2 });

    doc.y += 10;
    rule(doc, "#4361ee", 10);

    // ── Source URL ────────────────────────────────────────────────────────────
    doc.fontSize(8.5).font("Helvetica-Oblique").fillColor(C.url)
      .text(url, { width: W, link: url, underline: true, lineGap: 1 });

    doc.y += 12;

    // ── Description ───────────────────────────────────────────────────────────
    if (content.description && doc.y < limit) {
      doc.fontSize(11).font("Helvetica-Oblique").fillColor(C.desc)
        .text(content.description.trim(), { width: W, lineGap: 2, align: "left" });

      doc.y += 12;
    }

    // ── Headings summary ──────────────────────────────────────────────────────
    const allHeadings = [
      ...content.headings.h1,
      ...content.headings.h2,
      ...content.headings.h3,
    ].slice(0, 12);

    if (allHeadings.length > 0 && doc.y < limit) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(C.section)
        .text("CONTENTS OVERVIEW", { width: W, characterSpacing: 1 });

      doc.y += 6;

      for (const h of allHeadings) {
        if (doc.y >= limit) break;

        const bulletX = MARGIN;
        const textX   = MARGIN + 14;
        const y       = doc.y;

        // Bullet dot — drawn absolutely, no cursor movement
        doc.circle(bulletX + 3, y + 5, 2).fill(C.section);

        doc.fontSize(10).font("Helvetica").fillColor(C.body)
          .text(h, textX, y, { width: W - 14, lineGap: 2 });

        // Advance by 4pt padding between bullet items
        doc.y += 4;
      }

      doc.y += 8;

      if (doc.y < limit) rule(doc, C.rule, 10);
    }

    // ── Page Content ──────────────────────────────────────────────────────────
    if (content.blocks && content.blocks.length > 0) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(C.section)
        .text("PAGE CONTENT", { width: W, characterSpacing: 1 });

      doc.y += 8;

      for (const block of content.blocks) {
        if (doc.y >= limit) {
          doc.addPage();
        }

        if (block.type === "heading" && block.text) {
          const headingSize = block.level === 1 ? 16 : block.level === 2 ? 14 : 12;
          const headingHeight = doc.heightOfString(block.text, { width: W });
          
          if (doc.y + headingHeight + 40 > limit) {
            doc.addPage();
          }

          doc.fontSize(headingSize).font("Helvetica-Bold").fillColor(C.title)
            .text(block.text, { width: W, lineGap: 2 });
          doc.y += 6;
        } else if (block.type === "paragraph" && block.text) {
          const text = block.text.trim();
          if (!text) continue;

          const textHeight = doc.heightOfString(text, { width: W });
          if (doc.y + 20 > limit) {
            doc.addPage();
          }

          doc.fontSize(10).font("Helvetica").fillColor(C.body)
            .text(text, { width: W, lineGap: 3 });
          doc.y += 8;
        } else if (block.type === "list" && block.items && block.items.length > 0) {
          if (doc.y + 20 > limit) {
            doc.addPage();
          }

          for (const item of block.items) {
            const itemText = item.trim();
            if (!itemText) continue;

            const bulletX = MARGIN + 10;
            const textX = MARGIN + 22;
            const itemHeight = doc.heightOfString(itemText, { width: W - 22 });

            if (doc.y + itemHeight > limit) {
              doc.addPage();
            }

            const y = doc.y;
            doc.circle(bulletX + 3, y + 5, 2).fill(C.body);

            doc.fontSize(9.5).font("Helvetica").fillColor(C.body)
              .text(itemText, textX, y, { width: W - 22, lineGap: 2 });
            doc.y += 4;
          }
          doc.y += 4;
        } else if (block.type === "image" && block.src) {
          try {
            const imageBuffer = await downloadImage(block.src);
            const maxImageHeight = 200;

            if (doc.y + maxImageHeight + 20 > limit) {
              doc.addPage();
            }

            doc.image(imageBuffer, {
              fit: [W, maxImageHeight],
              align: "center",
            });
            doc.y += maxImageHeight + 10;

            if (block.alt) {
              doc.fontSize(8.5).font("Helvetica-Oblique").fillColor(C.desc)
                .text(block.alt, { width: W, align: "center" });
              doc.y += 8;
            }
          } catch (err) {
            const fallbackText = `[Image: ${block.alt || "No description available"} (${block.src})]`;
            const boxHeight = 40;

            if (doc.y + boxHeight > limit) {
              doc.addPage();
            }

            const currentY = doc.y;
            doc.rect(MARGIN, currentY, W, boxHeight)
              .strokeColor(C.rule)
              .lineWidth(0.5)
              .stroke();

            doc.fontSize(9).font("Helvetica-Oblique").fillColor(C.truncated)
              .text(fallbackText, MARGIN + 10, currentY + 14, { width: W - 20, align: "center" });

            doc.y = currentY + boxHeight + 10;
          }
        }
      }
    } else if (content.textContent && doc.y < limit) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(C.section)
        .text("PAGE CONTENT", { width: W, characterSpacing: 1 });

      doc.y += 8;

      const raw       = normaliseText(content.textContent);
      const body      = raw.slice(0, MAX_TEXT_CHARS);
      const truncated = raw.length > MAX_TEXT_CHARS;

      doc.fontSize(10.5).font("Helvetica").fillColor(C.body)
        .text(body, {
          width: W,
          lineGap: 3,
          align: "left",
        });

      if (truncated && doc.y < limit) {
        doc.y += 8;
        doc.fontSize(8.5).font("Helvetica-Oblique").fillColor(C.truncated)
          .text("[ content truncated for brevity ]", { width: W, align: "center" });
      }
    }
  }

  async finish(): Promise<void> {
    const doc = this.doc;
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = 1; i < totalPages; i++) {
      doc.switchToPage(i);

      const W = doc.page.width - MARGIN * 2;
      const footerY = doc.page.height - MARGIN - FOOTER_HEIGHT + 8;

      // Draw running header
      doc.fontSize(8).font("Helvetica").fillColor(C.badge)
        .text("https://github.com/lightning4747/Web-crawler-cli", MARGIN, MARGIN - 24, { width: W, align: "left", link: "https://github.com/lightning4747/Web-crawler-cli" });

      doc
        .moveTo(MARGIN, MARGIN - 14)
        .lineTo(doc.page.width - MARGIN, MARGIN - 14)
        .strokeColor(C.rule)
        .lineWidth(0.4)
        .stroke();

      // Draw running footer
      doc
        .moveTo(MARGIN, footerY)
        .lineTo(doc.page.width - MARGIN, footerY)
        .strokeColor(C.rule)
        .lineWidth(0.4)
        .stroke();

      doc.fontSize(8).font("Helvetica").fillColor(C.footer)
        .text(`Page ${i} of ${totalPages - 1}`, MARGIN, footerY + 5, {
          width: W,
          align: "center",
          lineBreak: false,
        });
    }

    await new Promise<void>((resolve, reject) => {
      this.stream.on("finish", resolve);
      this.stream.on("error", reject);
      this.doc.end();
    });
    console.log(`[PDF] Done — ${this.pageCount} chapter(s) written to ${this.pdfPath}`);
  }
}
