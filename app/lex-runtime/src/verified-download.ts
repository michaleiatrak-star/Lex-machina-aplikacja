import { createHash } from "node:crypto";
import fs from "node:fs";

export type VerifiedFile = { filename: string; url: string; sha256: string; bytes: number };
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; body: unknown }>;

export function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

/**
 * Downloads `file` to `target`, kept only with the expected SHA-256 and size (a ".part" file
 * until then). A complete file already there is checked and kept. Errors: <prefix>_DOWNLOAD_FAILED,
 * <prefix>_CHECKSUM_MISMATCH.
 */
export async function downloadVerified(
  file: VerifiedFile,
  target: string,
  prefix: string,
  onProgress?: (progress: { file: string; received: number; total: number }) => void,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<void> {
  if (sizeOf(target) === file.bytes) {
    const hash = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    if (hash === file.sha256) return;
  }
  const partial = `${target}.part`;
  const response = await fetchImpl(file.url);
  if (!response.ok || !response.body) throw new Error(`${prefix}_DOWNLOAD_FAILED:${file.filename}:${response.status}`);
  const hash = createHash("sha256");
  const out = fs.createWriteStream(partial);
  let received = 0;
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      onProgress?.({ file: file.filename, received, total: file.bytes });
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  if (hash.digest("hex") !== file.sha256 || received !== file.bytes) {
    fs.rmSync(partial, { force: true });
    throw new Error(`${prefix}_CHECKSUM_MISMATCH:${file.filename}`);
  }
  fs.renameSync(partial, target);
}
