import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Password-protected PDF and Office documents (DOCX, XLSX): the user types the password,
 * the file is opened on this computer (storage/decrypt_worker.py) and goes on like any other
 * document. The password lives only for this request: never stored, logged or sent anywhere.
 */

export type EncryptedKind = "pdf" | "office";

const OFFICE_ZIP_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12"
]);

// An encrypted DOCX/XLSX is not a ZIP but an OLE compound file holding the encrypted package.
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Which kind of protection the file may carry (a PDF with /Encrypt may still open without one). */
export function encryptedKind(data: Uint8Array, mediaType: string): EncryptedKind | null {
  if (OFFICE_ZIP_TYPES.has(mediaType) && CFB_SIGNATURE.every((byte, index) => data[index] === byte)) return "office";
  if (mediaType === "application/pdf") {
    // The trailer names the encryption dictionary; scanning the whole file costs nothing next to OCR.
    const text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1");
    // "/Encrypt 5 0 R" or an inline "/Encrypt<<...>>" (MuPDF writes it so); not "/EncryptMetadata".
    if (/\/Encrypt(?![A-Za-z])/u.test(text)) return "pdf";
  }
  return null;
}

/** The password from the request header (percent-encoded, at most 1024 characters). */
export function passwordFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const password = decodeURIComponent(value);
    return password && password.length <= 1024 ? password : null;
  } catch {
    return null;
  }
}

export interface DocumentDecryptor {
  decrypt(data: Uint8Array, kind: EncryptedKind, password: string): Promise<Uint8Array>;
}

export class LocalDocumentDecryptor implements DocumentDecryptor {
  private readonly python: string;
  private readonly workerPath: string;

  constructor(options: { python?: string; workerPath?: string; timeoutMs?: number } = {}) {
    this.python = options.python ?? process.env.LEX_STORAGE_PYTHON ?? "python3";
    this.workerPath =
      options.workerPath ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../storage/decrypt_worker.py");
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private readonly timeoutMs: number;

  async decrypt(data: Uint8Array, kind: EncryptedKind, password: string): Promise<Uint8Array> {
    const request = JSON.stringify({ kind, password, dataBase64: Buffer.from(data).toString("base64") });
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.python, [this.workerPath], { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("DOCUMENT_DECRYPT_TIMEOUT"));
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        err = (err + chunk.toString("utf8")).slice(-4000);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`DOCUMENT_DECRYPT_FAILED:${error.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
        else {
          const known = /DOCUMENT_(?:PASSWORD_INVALID|NOT_ENCRYPTED|DECRYPT_UNSUPPORTED|DECRYPT_FAILED)[^\n]*/u.exec(err);
          reject(new Error(known ? known[0].trim() : "DOCUMENT_DECRYPT_FAILED"));
        }
      });
      child.stdin.end(request);
    });
    const parsed = JSON.parse(stdout) as { dataBase64?: unknown };
    if (typeof parsed.dataBase64 !== "string") throw new Error("DOCUMENT_DECRYPT_FAILED");
    return new Uint8Array(Buffer.from(parsed.dataBase64, "base64"));
  }
}
