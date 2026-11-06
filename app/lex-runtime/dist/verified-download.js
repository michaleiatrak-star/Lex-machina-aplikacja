import { createHash } from "node:crypto";
import fs from "node:fs";
export function sizeOf(file) {
    try {
        return fs.statSync(file).size;
    }
    catch {
        return -1;
    }
}
/**
 * Downloads `file` to `target`, kept only with the expected SHA-256 and size (a ".part" file
 * until then). A complete file already there is checked and kept. Errors: <prefix>_DOWNLOAD_FAILED,
 * <prefix>_CHECKSUM_MISMATCH.
 */
export async function downloadVerified(file, target, prefix, onProgress, fetchImpl = fetch) {
    if (sizeOf(target) === file.bytes) {
        const hash = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
        if (hash === file.sha256)
            return;
    }
    const partial = `${target}.part`;
    const response = await fetchImpl(file.url);
    if (!response.ok || !response.body)
        throw new Error(`${prefix}_DOWNLOAD_FAILED:${file.filename}:${response.status}`);
    const hash = createHash("sha256");
    const out = fs.createWriteStream(partial);
    let received = 0;
    try {
        for await (const chunk of response.body) {
            hash.update(chunk);
            received += chunk.length;
            if (!out.write(chunk))
                await new Promise((resolve) => out.once("drain", () => resolve()));
            onProgress?.({ file: file.filename, received, total: file.bytes });
        }
    }
    finally {
        await new Promise((resolve) => out.end(() => resolve()));
    }
    if (hash.digest("hex") !== file.sha256 || received !== file.bytes) {
        fs.rmSync(partial, { force: true });
        throw new Error(`${prefix}_CHECKSUM_MISMATCH:${file.filename}`);
    }
    fs.renameSync(partial, target);
}
