import fs from "node:fs";
import { createHash } from "node:crypto";
async function digest(file) {
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file))
        hash.update(chunk);
    return hash.digest("hex");
}
/** Only verified complete files become installers. Partial transfers survive network failures. */
async function transferInstaller(asset, target, report, fetchImpl = fetch) {
    const size = (file) => { try {
        return fs.statSync(file).size;
    }
    catch {
        return 0;
    } };
    const expected = asset.sha256.toLowerCase();
    if (fs.existsSync(target)) {
        report({ phase: "checking", received: size(target), total: asset.bytes });
        if ((asset.bytes === undefined || size(target) === asset.bytes) && await digest(target) === expected)
            return size(target);
        fs.rmSync(target);
    }
    const partial = `${target}.part`;
    let received = size(partial);
    if (asset.bytes !== undefined && received > asset.bytes) {
        fs.rmSync(partial, { force: true });
        received = 0;
    }
    // A transfer completed just before a crash: do not request an invalid range at EOF.
    if (received && received === asset.bytes && await digest(partial) === expected) {
        fs.renameSync(partial, target);
        return received;
    }
    if (received && received === asset.bytes) {
        fs.rmSync(partial);
        received = 0;
    }
    const response = await fetchImpl(asset.url, {
        headers: { Accept: "application/octet-stream", ...(received ? { Range: `bytes=${received}-` } : {}) },
        signal: AbortSignal.timeout(30 * 60_000), redirect: "follow"
    });
    if (!response.ok || !response.body)
        throw new Error(`UPDATE_ASSET_DOWNLOAD_FAILED:${response.status}`);
    if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (!range || Number(range[1]) !== received || (asset.bytes !== undefined && Number(range[3]) !== asset.bytes)) {
            await response.body.cancel();
            throw new Error("UPDATE_ASSET_RANGE_INVALID");
        }
    }
    else {
        received = 0;
    }
    const file = await fs.promises.open(partial, received ? "a" : "w");
    report({ phase: "downloading", received, total: asset.bytes });
    try {
        for await (const chunk of response.body) {
            if (asset.bytes !== undefined && received + chunk.byteLength > asset.bytes)
                throw new Error("UPDATE_ASSET_SIZE_MISMATCH");
            let offset = 0;
            while (offset < chunk.byteLength)
                offset += (await file.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
            received += chunk.byteLength;
            report({ phase: "downloading", received, total: asset.bytes });
        }
    }
    finally {
        await file.close();
    }
    report({ phase: "checking", received, total: asset.bytes });
    if ((asset.bytes !== undefined && received !== asset.bytes) || await digest(partial) !== expected) {
        fs.rmSync(partial, { force: true });
        throw new Error("UPDATE_ASSET_HASH_MISMATCH");
    }
    fs.renameSync(partial, target);
    return received;
}
export async function downloadInstaller(asset, target, report, fetchImpl = fetch) {
    const lease = `${target}.lock`;
    if (fs.existsSync(lease)) {
        const owner = Number(fs.readFileSync(lease, "utf8"));
        let running = true;
        if (Number.isSafeInteger(owner) && owner > 0) {
            try {
                process.kill(owner, 0);
            }
            catch (error) {
                running = error.code !== "ESRCH";
            }
        }
        if (running)
            throw new Error("APPLICATION_UPDATE_IN_PROGRESS");
        fs.rmSync(lease);
    }
    // Exclusive create also handles a second app instance racing this one.
    const handle = fs.openSync(lease, "wx", 0o600);
    try {
        fs.writeFileSync(handle, String(process.pid));
        return await transferInstaller(asset, target, report, fetchImpl);
    }
    finally {
        fs.closeSync(handle);
        fs.rmSync(lease, { force: true });
    }
}
