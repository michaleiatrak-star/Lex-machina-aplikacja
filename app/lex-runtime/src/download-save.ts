import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The desktop WebView ignores <a download> for blob URLs, so a generated document
// "downloaded" in the chat never reached the disk. On desktop the runtime (the same
// local user) saves it in the user's Downloads folder instead, like a browser would.

const ALLOWED_EXTENSIONS = new Set(["docx", "odt", "pdf", "txt"]);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

export function downloadsDirectory(): string {
  const override = process.env.LEX_DOWNLOADS_DIR?.trim();
  if (override) return override;
  const home = process.env.USERPROFILE?.trim() || os.homedir();
  return path.join(home, "Downloads");
}

export function safeDownloadFilename(requested: string): string {
  const base = path
    .basename(requested.normalize("NFKC").replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const extension = path.extname(base).toLowerCase().replace(/^\./, "");
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("DOWNLOAD_FILE_TYPE_NOT_ALLOWED");
  }
  let stem = base.slice(0, base.length - extension.length - 1).slice(0, 150).trim();
  if (!stem) stem = "LexMachina-dokument";
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`;
  return `${stem}.${extension}`;
}

export async function saveToDownloads(
  requestedFilename: string,
  data: Buffer,
  directory = downloadsDirectory()
): Promise<{ path: string; filename: string }> {
  const filename = safeDownloadFilename(requestedFilename);
  await mkdir(directory, { recursive: true });
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const candidate = attempt === 1 ? filename : `${stem} (${attempt})${extension}`;
    const target = path.join(directory, candidate);
    try {
      // "wx": never overwrite a file the user already has.
      await writeFile(target, data, { flag: "wx" });
      return { path: target, filename: candidate };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("DOWNLOAD_NAME_EXHAUSTED");
}
