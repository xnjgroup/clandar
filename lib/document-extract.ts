/**
 * Turns an uploaded document into plain text the assistant can read — images
 * go straight to the vision model instead (see lib/assistant.ts), this is
 * for everything else attachable in the chat: markdown/text, PDF, Word,
 * Excel, PowerPoint. Real extraction per format, not a filename stand-in —
 * an unsupported or corrupt file returns a clear error string instead of
 * silently sending garbage to the model.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_CHARS = 12_000;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_CHARS ? `${trimmed.slice(0, MAX_CHARS)}\n…(truncated)` : trimmed;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares a minimal ambient `Buffer` that conflicts
  // with @types/node's — a known upstream typing issue, not a real mismatch.
  await workbook.xlsx.load(buffer as never);
  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    lines.push(`# ${sheet.name}`);
    let rowsWritten = 0;
    sheet.eachRow((row) => {
      if (rowsWritten >= 200) return; // cap per sheet — this is context for a chat model, not a data export
      const cells = (row.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v)));
      lines.push(cells.join(", "));
      rowsWritten++;
    });
  });
  return lines.join("\n");
}

/** PPTX is OOXML (a zip of slide XML) — no small parsing library is as standard as pdf-parse/mammoth, so this unzips and pulls text runs directly. */
async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
      return na - nb;
    });

  const slides: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.files[name].async("text");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    slides.push(`# Slide ${i + 1}\n${texts.join(" ")}`);
  }
  return slides.join("\n\n");
}

export type ExtractedDocument = { name: string; text: string } | { name: string; error: string };

/** Dispatches on filename/MIME type. Text/markdown are read as-is; everything else runs through a real parser for that format. */
export async function extractDocumentText(
  name: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ExtractedDocument> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  try {
    if (mimeType.startsWith("text/") || ext === "md" || ext === "txt" || ext === "markdown") {
      return { name, text: truncate(buffer.toString("utf8")) };
    }
    if (mimeType === "application/pdf" || ext === "pdf") {
      return { name, text: truncate(await extractPdf(buffer)) };
    }
    if (ext === "docx" || mimeType.includes("wordprocessingml")) {
      return { name, text: truncate(await extractDocx(buffer)) };
    }
    if (ext === "doc") {
      return { name, error: "Legacy .doc isn't supported — save it as .docx and try again." };
    }
    if (ext === "xlsx" || mimeType.includes("spreadsheetml")) {
      return { name, text: truncate(await extractXlsx(buffer)) };
    }
    if (ext === "xls") {
      return { name, error: "Legacy .xls isn't supported — save it as .xlsx and try again." };
    }
    if (ext === "pptx" || mimeType.includes("presentationml")) {
      return { name, text: truncate(await extractPptx(buffer)) };
    }
    if (ext === "ppt") {
      return { name, error: "Legacy .ppt isn't supported — save it as .pptx and try again." };
    }
    return { name, error: `Unsupported file type for "${name}".` };
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : `Could not read "${name}".` };
  }
}
