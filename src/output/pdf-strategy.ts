import fs from "fs";
import path from "path";
import PDFDocumentCtor from "pdfkit";
import type { OutputStrategy } from "./strategy.js";
import { markDone, type CrawledPageContent } from "../db/queries.js";

type PDFDocumentInstance = InstanceType<typeof PDFDocumentCtor>;

const OUTPUT_DIR = "output";
const BASE_NAME  = "documentation";

/**
 * Returns the next available PDF path.
 * documentation.pdf → documentation2.pdf → documentation3.pdf → ...
 */
function resolveOutputPath(): string {
  const first = path.join(OUTPUT_DIR, `${BASE_NAME}.pdf`);
  if (!fs.existsSync(first)) return first;

  let n = 2;
  while (fs.existsSync(path.join(OUTPUT_DIR, `${BASE_NAME}${n}.pdf`))) {
    n++;
  }
  return path.join(OUTPUT_DIR, `${BASE_NAME}${n}.pdf`);
}

// Max characters of body text written per page to keep file sizes manageable.
const MAX_TEXT_PER_PAGE = 5000;

// Page margins (points)
const MARGIN = 64;

// Colour palette
const COLOR_TITLE      = "#1a1a2e";
const COLOR_URL        = "#4361ee";
const COLOR_DESC       = "#444444";
const COLOR_SECTION    = "#2d6a4f";
const COLOR_BODY       = "#222222";
const COLOR_TRUNCATED  = "#aaaaaa";
const COLOR_RULE       = "#dddddd";
const COLOR_COVER_BG   = "#1a1a2e";
const COLOR_COVER_TEXT = "#ffffff";
const COLOR_COVER_SUB  = "#a8dadc";

/**
 * Draws a full-width horizontal rule at the current Y position.
 */
function drawRule(doc: PDFDocumentInstance, color = COLOR_RULE): void {
  const y = doc.y;
  doc
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .strokeColor(color)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
}

/**
 * Streams crawled page content into a single compiled PDF eBook.
 * Each crawled page becomes a titled chapter with proper layout and spacing.
 * Also persists content to the database for full dual-output support.
 */
export class PdfStrategy implements OutputStrategy {
  private doc!: PDFDocumentInstance;
  private stream!: fs.WriteStream;
  private pageCount = 0;
  private pdfPath!: string;

  async init(): Promise<void> {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    this.pdfPath = resolveOutputPath();

    this.doc = new PDFDocumentCtor({
      autoFirstPage: false,
      bufferPages: false,
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: "Programming Documentation",
        Author: "Web Crawler",
        Subject: "Compiled documentation from crawled pages",
      },
    });

    this.stream = fs.createWriteStream(this.pdfPath);
    this.doc.pipe(this.stream);

    // ── Cover page ────────────────────────────────────────────────────────────
    this.doc.addPage();

    // Solid dark background
    this.doc
      .rect(0, 0, this.doc.page.width, this.doc.page.height)
      .fill(COLOR_COVER_BG);

    const centerY = this.doc.page.height / 2 - 80;

    this.doc
      .fontSize(36)
      .font("Helvetica-Bold")
      .fillColor(COLOR_COVER_TEXT)
      .text("Programming", MARGIN, centerY, { align: "center", lineGap: 6 });

    this.doc
      .fontSize(36)
      .font("Helvetica-Bold")
      .fillColor(COLOR_COVER_SUB)
      .text("Documentation", { align: "center", lineGap: 6 });

    this.doc.moveDown(1.2);

    this.doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor(COLOR_COVER_TEXT)
      .text("Compiled by Web Crawler", { align: "center", lineGap: 4 });

    this.doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor(COLOR_COVER_SUB)
      .text(new Date().toUTCString(), { align: "center" });

    console.log(`[PDF] Output file: ${this.pdfPath}`);
  }

  async save(urlId: number, url: string, content: CrawledPageContent): Promise<void> {
    // 1. Persist to DB as well (dual output)
    await markDone(urlId, content);

    // 2. Append a chapter to the PDF
    this.doc.addPage();
    this.pageCount++;

    const doc   = this.doc;
    const width = doc.page.width - MARGIN * 2;
    const title = content.title ?? url;

    // ── Chapter number badge ──────────────────────────────────────────────────
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#888888")
      .text(`CHAPTER ${this.pageCount}`, MARGIN, MARGIN, { width, align: "right" });

    doc.moveDown(0.2);

    // ── Title ─────────────────────────────────────────────────────────────────
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .fillColor(COLOR_TITLE)
      .text(title, { width, lineGap: 4 });

    doc.moveDown(0.5);
    drawRule(doc, "#4361ee");

    // ── Source URL ────────────────────────────────────────────────────────────
    doc
      .fontSize(8.5)
      .font("Helvetica-Oblique")
      .fillColor(COLOR_URL)
      .text(url, { width, link: url, underline: true, lineGap: 2 });

    doc.moveDown(0.8);

    // ── Description ───────────────────────────────────────────────────────────
    if (content.description) {
      doc
        .fontSize(11)
        .font("Helvetica-Oblique")
        .fillColor(COLOR_DESC)
        .text(content.description, { width, lineGap: 3, align: "justify" });

      doc.moveDown(1);
    }

    // ── Headings summary ──────────────────────────────────────────────────────
    const { h1, h2, h3 } = content.headings;
    const allHeadings = [...h1, ...h2, ...h3].slice(0, 12);

    if (allHeadings.length > 0) {
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(COLOR_SECTION)
        .text("CONTENTS OVERVIEW", { width, characterSpacing: 1 });

      doc.moveDown(0.4);

      for (const h of allHeadings) {
        // Bullet dot
        const bulletX = MARGIN;
        const textX   = MARGIN + 14;
        const y       = doc.y;

        doc
          .circle(bulletX + 3, y + 5, 2)
          .fill(COLOR_SECTION);

        doc
          .fontSize(10)
          .font("Helvetica")
          .fillColor(COLOR_BODY)
          .text(h, textX, y, { width: width - 14, lineGap: 3 });

        doc.moveDown(0.15);
      }

      doc.moveDown(0.8);
      drawRule(doc);
    }

    // ── Body text ─────────────────────────────────────────────────────────────
    if (content.textContent) {
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(COLOR_SECTION)
        .text("PAGE CONTENT", { width, characterSpacing: 1 });

      doc.moveDown(0.5);

      const body      = content.textContent.slice(0, MAX_TEXT_PER_PAGE);
      const truncated = content.textContent.length > MAX_TEXT_PER_PAGE;

      doc
        .fontSize(10.5)
        .font("Helvetica")
        .fillColor(COLOR_BODY)
        .text(body, {
          width,
          lineGap: 4,       // line spacing between wrapped lines
          paragraphGap: 8,  // extra space between paragraphs
          align: "justify",
        });

      if (truncated) {
        doc.moveDown(0.6);
        doc
          .fontSize(8.5)
          .font("Helvetica-Oblique")
          .fillColor(COLOR_TRUNCATED)
          .text("[ content truncated for brevity ]", { width, align: "center" });
      }
    }

    // ── Footer rule ───────────────────────────────────────────────────────────
    const footerY = doc.page.height - MARGIN + 10;
    doc
      .moveTo(MARGIN, footerY)
      .lineTo(doc.page.width - MARGIN, footerY)
      .strokeColor(COLOR_RULE)
      .lineWidth(0.4)
      .stroke();

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#aaaaaa")
      .text(`Page ${this.pageCount + 1}`, MARGIN, footerY + 4, {
        width,
        align: "center",
      });
  }

  async finish(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.on("finish", resolve);
      this.stream.on("error", reject);
      this.doc.end();
    });
    console.log(`[PDF] Done — ${this.pageCount} chapter(s) written to ${this.pdfPath}`);
  }
}
