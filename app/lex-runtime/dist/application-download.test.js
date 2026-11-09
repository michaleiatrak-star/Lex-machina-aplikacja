import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadInstaller } from "./application-download.js";
const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-download-test-"));
    roots.push(root);
    const data = Buffer.from("verified installer content");
    return { data, target: path.join(root, "update.pkg"), asset: { url: "https://example.test/update", sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length } };
}
describe("installer downloads on both platforms", () => {
    it("reports bytes, verifies and reuses complete files without another request", async () => {
        const { asset, data, target } = fixture();
        const fetcher = vi.fn(async () => new Response(data));
        const states = [];
        await downloadInstaller(asset, target, p => states.push(p), fetcher);
        expect(states).toContainEqual({ phase: "downloading", received: data.length, total: data.length });
        expect(fs.readFileSync(target)).toEqual(data);
        await downloadInstaller(asset, target, () => { }, fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("resumes an interrupted download with a validated range", async () => {
        const { asset, data, target } = fixture();
        fs.writeFileSync(`${target}.part`, data.subarray(0, 5));
        const fetcher = vi.fn(async (_url, init) => {
            expect(init.headers.Range).toBe("bytes=5-");
            return new Response(data.subarray(5), { status: 206, headers: { "content-range": `bytes 5-${data.length - 1}/${data.length}` } });
        });
        await downloadInstaller(asset, target, () => { }, fetcher);
        expect(fs.readFileSync(target)).toEqual(data);
    });
    it("restarts correctly when the host ignores Range", async () => {
        const { asset, data, target } = fixture();
        fs.writeFileSync(`${target}.part`, "old");
        await downloadInstaller(asset, target, () => { }, vi.fn(async () => new Response(data)));
        expect(fs.readFileSync(target)).toEqual(data);
    });
    it("never installs a damaged download", async () => {
        const { asset, target } = fixture();
        await expect(downloadInstaller(asset, target, () => { }, vi.fn(async () => new Response("bad")))).rejects.toThrow("HASH_MISMATCH");
        expect(fs.existsSync(target)).toBe(false);
        expect(fs.existsSync(`${target}.part`)).toBe(false);
    });
    it("rejects a range for a different offset", async () => {
        const { asset, target } = fixture();
        fs.writeFileSync(`${target}.part`, "old");
        await expect(downloadInstaller(asset, target, () => { }, vi.fn(async () => new Response("bad", { status: 206, headers: { "content-range": "bytes 0-2/25" } })))).rejects.toThrow("RANGE_INVALID");
        expect(fs.existsSync(target)).toBe(false);
    });
    it("does not allow two processes to write the same installer", async () => {
        const { asset, target } = fixture();
        fs.writeFileSync(`${target}.lock`, String(process.pid));
        const fetcher = vi.fn();
        await expect(downloadInstaller(asset, target, () => { }, fetcher)).rejects.toThrow("APPLICATION_UPDATE_IN_PROGRESS");
        expect(fetcher).not.toHaveBeenCalled();
        expect(fs.existsSync(`${target}.lock`)).toBe(true);
    });
    it("retains partial data on a network error for the next attempt", async () => {
        const { asset, target } = fixture();
        const body = new ReadableStream({ async start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                await new Promise(resolve => setTimeout(resolve, 20));
                controller.error(new Error("offline"));
            } });
        await expect(downloadInstaller(asset, target, () => { }, vi.fn(async () => new Response(body)))).rejects.toThrow("offline");
        expect(fs.statSync(`${target}.part`).size).toBe(3);
        expect(fs.existsSync(target)).toBe(false);
    });
});
