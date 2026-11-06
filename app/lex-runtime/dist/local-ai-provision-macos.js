import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
/**
 * The local model on macOS (Apple Silicon): what install-local-llm.ps1 does on Windows, in the
 * runtime itself. The llama.cpp Metal build (an archive pinned by SHA-256 in the release manifest)
 * and the chosen GGUF model are downloaded and verified, then config.json is written in the same
 * form, so starting, qualification and the chat work as on Windows.
 */
export const MAC_BACKEND = "METAL_ARM64";
const SHA256 = /^[a-f0-9]{64}$/u;
async function sha256File(file) {
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file))
        hash.update(chunk);
    return hash.digest("hex");
}
/** A file kept only with the expected SHA-256 (a ".part" file until then); one already there is checked. */
async function verifiedDownload(url, sha256, target, label, fetchImpl, onProgress) {
    if (fs.existsSync(target)) {
        if ((await sha256File(target)) === sha256) {
            const size = fs.statSync(target).size;
            onProgress?.({ phase: "CACHE_HIT", label, bytesDownloaded: size, bytesTotal: size, percent: 100 });
            return;
        }
        fs.rmSync(target, { force: true });
    }
    const partial = `${target}.part`;
    fs.rmSync(partial, { force: true });
    const response = (await fetchImpl(url));
    if (!response.ok || !response.body)
        throw new Error(`LOCAL_LLM_DOWNLOAD_FAILED:${label}:${response.status}`);
    const length = Number(response.headers?.get("content-length") ?? "");
    const total = Number.isFinite(length) && length > 0 ? length : null;
    const hash = createHash("sha256");
    const out = fs.createWriteStream(partial);
    let received = 0;
    let lastPercent = -1;
    onProgress?.({ phase: "DOWNLOAD", label, bytesDownloaded: 0, bytesTotal: total, percent: total ? 0 : null });
    try {
        for await (const chunk of response.body) {
            hash.update(chunk);
            received += chunk.length;
            if (!out.write(chunk))
                await new Promise((resolve) => out.once("drain", () => resolve()));
            const percent = total ? Math.min(100, Math.floor((received * 100) / total)) : null;
            if (percent !== null && percent > lastPercent) {
                lastPercent = percent;
                onProgress?.({ phase: "DOWNLOAD", label, bytesDownloaded: received, bytesTotal: total, percent });
            }
        }
    }
    finally {
        await new Promise((resolve) => out.end(() => resolve()));
    }
    const actual = hash.digest("hex");
    if (actual !== sha256) {
        fs.rmSync(partial, { force: true });
        throw new Error(`LOCAL_LLM_HASH_MISMATCH:${label} expected=${sha256} actual=${actual}`);
    }
    fs.renameSync(partial, target);
    onProgress?.({ phase: "VERIFIED", label, bytesDownloaded: received, bytesTotal: received, percent: 100 });
}
/** Archive members stay inside the folder: no absolute paths, no "..", links only to members. */
function assertSafeArchive(tar, archive) {
    const listed = spawnSync(tar, ["-tzf", archive], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0)
        throw new Error("LOCAL_LLM_ENGINE_ARCHIVE_UNREADABLE");
    for (const entry of listed.stdout.split("\n").filter(Boolean)) {
        if (entry.startsWith("/") || entry.split("/").includes(".."))
            throw new Error(`LOCAL_LLM_ENGINE_ARCHIVE_UNSAFE:${entry}`);
    }
}
function assertLinksInside(root) {
    const real = fs.realpathSync(root);
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) {
                const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
                if (target !== real && !target.startsWith(real + path.sep))
                    throw new Error(`LOCAL_LLM_ENGINE_ARCHIVE_UNSAFE:${entry.name}`);
            }
            else if (entry.isDirectory()) {
                walk(full);
            }
        }
    };
    walk(real);
}
function findFile(root, name) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isFile() && entry.name === name)
            return full;
        if (entry.isDirectory()) {
            const found = findFile(full, name);
            if (found)
                return found;
        }
    }
    return null;
}
export async function provisionLocalAiMacos(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const tar = options.tar ?? "/usr/bin/tar";
    const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
    const engine = manifest.runtime?.llamaCpp;
    if (!engine?.version)
        throw new Error("LOCAL_LLM_ENGINE_MANIFEST_MISSING");
    const backend = (engine.backends ?? []).find((entry) => entry.id === MAC_BACKEND);
    if (!backend || typeof backend.url !== "string" || typeof backend.sha256 !== "string" || !SHA256.test(backend.sha256)) {
        throw new Error(`LOCAL_LLM_BACKEND_NOT_IN_MANIFEST:${MAC_BACKEND}`);
    }
    const policy = manifest.localAi?.contextSelection;
    const minimum = Number(policy?.minimum);
    const maximum = Number(policy?.maximum);
    const step = Number(policy?.step);
    if (!(minimum >= 1 && maximum >= minimum && step >= 1))
        throw new Error("LOCAL_LLM_CONTEXT_POLICY_INVALID");
    const tokens = options.contextTokens;
    if (tokens < minimum || tokens > maximum)
        throw new Error(`LOCAL_LLM_CONTEXT_OUT_OF_RANGE:${tokens}:${minimum}:${maximum}`);
    if ((tokens - minimum) % step !== 0)
        throw new Error(`LOCAL_LLM_CONTEXT_STEP_INVALID:${tokens}:${step}`);
    const model = (manifest.models?.localLlm ?? []).find((entry) => entry.id === options.modelId);
    if (!model)
        throw new Error(`LOCAL_LLM_MODEL_UNKNOWN:${options.modelId}`);
    const filename = String(model.filename ?? "");
    const sha = String(model.sha256 ?? "").toLowerCase();
    if (!filename || filename !== path.basename(filename) || typeof model.url !== "string" || !SHA256.test(sha)) {
        throw new Error(`LOCAL_LLM_MODEL_MANIFEST_INVALID:${options.modelId}`);
    }
    const nativeContext = Number(model.nativeContext);
    const modelMinimum = Number(model.minimumContext ?? minimum);
    const modelMaximum = Number(model.maximumRuntimeContext ?? nativeContext);
    if (tokens < modelMinimum || tokens > modelMaximum) {
        throw new Error(`LOCAL_LLM_MODEL_CONTEXT_UNSUPPORTED:${options.modelId}:${tokens}:${modelMinimum}:${modelMaximum}`);
    }
    const extended = tokens > nativeContext;
    const extension = model.contextExtension;
    if (extended && extension?.enabled !== true)
        throw new Error(`LOCAL_LLM_CONTEXT_EXTENSION_NOT_ALLOWED:${options.modelId}:${tokens}`);
    const root = path.resolve(options.localRoot);
    const cache = path.join(root, "download-cache");
    fs.mkdirSync(cache, { recursive: true });
    fs.mkdirSync(path.join(root, "models"), { recursive: true });
    // Engine: the Metal build, unpacked into its own version folder.
    const engineDir = path.join(root, "engine", "llama", engine.version, MAC_BACKEND);
    let executable = path.join(engineDir, "llama-server");
    if (!fs.existsSync(executable)) {
        const archive = path.join(cache, `llama-${engine.version}-${MAC_BACKEND.toLowerCase()}.tar.gz`);
        await verifiedDownload(backend.url, backend.sha256, archive, `llama.cpp:${MAC_BACKEND}`, fetchImpl, options.onProgress);
        assertSafeArchive(tar, archive);
        const extract = path.join(cache, `llama-extract-${randomUUID()}`);
        fs.mkdirSync(extract, { recursive: true });
        try {
            const result = spawnSync(tar, ["-xzf", archive, "-C", extract], { encoding: "utf8" });
            if (result.status !== 0)
                throw new Error(`LOCAL_LLM_ENGINE_EXTRACT_FAILED:${(result.stderr || "").slice(0, 200)}`);
            assertLinksInside(extract);
            const server = findFile(extract, "llama-server");
            if (!server)
                throw new Error(`LOCAL_LLM_ENGINE_ARCHIVE_LAYOUT_INVALID:${MAC_BACKEND}`);
            fs.chmodSync(server, 0o755);
            fs.rmSync(engineDir, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(engineDir), { recursive: true });
            fs.renameSync(path.dirname(server), engineDir);
        }
        finally {
            fs.rmSync(extract, { recursive: true, force: true });
        }
        fs.rmSync(archive, { force: true });
        executable = path.join(engineDir, "llama-server");
        if (!fs.existsSync(executable))
            throw new Error(`LOCAL_LLM_SERVER_MISSING:${MAC_BACKEND}`);
    }
    // Model: downloaded straight to its place (no second multi-gigabyte copy).
    const target = path.join(root, "models", filename);
    await verifiedDownload(model.url, sha, target, `model:${options.modelId}`, fetchImpl, options.onProgress);
    const ropeScale = extended ? Math.round((tokens / nativeContext) * 1e8) / 1e8 : 1;
    const launchArgs = ["--model", target, "--host", "127.0.0.1", "--port", "0", "--ctx-size", String(tokens), "--n-gpu-layers", "999"];
    if (extended)
        launchArgs.push("--rope-scaling", "yarn", "--rope-scale", String(ropeScale), "--yarn-orig-ctx", String(nativeContext));
    const config = {
        schemaVersion: 1,
        configuredAt: new Date().toISOString(),
        applicationVersion: manifest.applicationVersion,
        model: {
            id: options.modelId,
            displayName: model.displayName,
            filename,
            path: target,
            sha256: sha,
            quantization: model.quantization,
            nativeContext
        },
        context: { requestedTokens: tokens, mode: extended ? "YARN_EXTENDED" : "NATIVE_OR_REDUCED", extendedBeyondNative: extended, ropeScale },
        engine: {
            type: "llama.cpp",
            version: engine.version,
            backend: MAC_BACKEND,
            selectionMode: options.backendMode,
            gpuOffload: true,
            executable,
            fallbackBackend: null,
            fallbackExecutable: null,
            bind: "127.0.0.1",
            launchArgs
        },
        network: { requiredForProvisioning: true, requiredForInference: false }
    };
    const configPath = path.join(root, "config.json");
    fs.writeFileSync(`${configPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
    fs.renameSync(`${configPath}.tmp`, configPath);
    return { configPath, executable };
}
