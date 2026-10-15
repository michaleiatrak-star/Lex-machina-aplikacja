import { access, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { readCaseBlob, rekeyCaseBlob, writeCaseBlob } from "./case-blob.js";
function defaultRootDir() {
    return path.resolve(process.env.LEX_DATA_DIR ??
        path.join(process.env.HOME ??
            process.cwd(), ".lex-machina", "data"));
}
function validCaseId(value) {
    return /^case_[a-f0-9]{32}$/
        .test(value);
}
function validDocumentId(value) {
    return /^doc_[a-f0-9]{24}$/
        .test(value);
}
function storageObjectId(documentId) {
    if (!validDocumentId(documentId)) {
        throw new Error("INVALID_DOCUMENT_ID");
    }
    return ("docblob_" +
        createHash("sha256")
            .update(documentId, "utf8")
            .digest("hex")
            .slice(0, 32));
}
// Page images live next to source.lme as separate blobs named by the SHA-256
// of the image, written once: a page text edit rewrites only the small source.
const IMAGES_DIR = "images";
const MAX_PAGE_IMAGE_BYTES = 32 * 1024 * 1024;
// Page fields holding an image: the OCR evidence and the scan kept after a hand edit.
const PAGE_IMAGE_FIELDS = ["image", "scan"];
const imageHashes = new WeakMap();
function imageHash(image) {
    let hash = imageHashes.get(image);
    if (!hash) {
        hash = createHash("sha256").update(image.jpeg, "utf8").digest("hex");
        imageHashes.set(image, hash);
    }
    return hash;
}
function pageImageIdentity(caseId, documentId, hash, keyVersion) {
    return {
        caseId,
        objectId: "pageimg_" +
            createHash("sha256")
                .update(`${documentId}:${hash}`, "utf8")
                .digest("hex")
                .slice(0, 32),
        purpose: "document-page-image",
        keyVersion
    };
}
function sourceIdentity(caseId, documentId, keyVersion) {
    return {
        caseId,
        objectId: storageObjectId(documentId),
        purpose: "document-source",
        keyVersion
    };
}
function protectedIdentity(caseId, documentId, keyVersion) {
    return {
        caseId,
        objectId: storageObjectId(documentId),
        purpose: "protected-document",
        keyVersion
    };
}
function parseJson(value, errorCode) {
    try {
        return JSON.parse(value.toString("utf8"));
    }
    catch {
        throw new Error(errorCode);
    }
}
export class SecureCaseDocumentStore {
    rootDir;
    maxSourceBytes;
    maxProtectedBytes;
    constructor(options = {}) {
        this.rootDir =
            path.resolve(options.rootDir ??
                defaultRootDir());
        this.maxSourceBytes =
            options.maxSourceBytes ??
                256 * 1024 * 1024;
        this.maxProtectedBytes =
            options.maxProtectedBytes ??
                256 * 1024 * 1024;
    }
    caseDir(caseId) {
        if (!validCaseId(caseId)) {
            throw new Error("INVALID_CASE_ID");
        }
        const target = path.resolve(this.rootDir, "cases", caseId);
        const base = path.resolve(this.rootDir, "cases") + path.sep;
        if (!target.startsWith(base)) {
            throw new Error("CASE_PATH_ESCAPE");
        }
        return target;
    }
    documentsDir(caseId) {
        return path.join(this.caseDir(caseId), "secure", "documents");
    }
    documentDir(caseId, documentId) {
        if (!validDocumentId(documentId)) {
            throw new Error("INVALID_DOCUMENT_ID");
        }
        const base = path.resolve(this.documentsDir(caseId));
        const target = path.resolve(base, documentId);
        if (!target.startsWith(base + path.sep)) {
            throw new Error("DOCUMENT_PATH_ESCAPE");
        }
        return target;
    }
    async assertCaseKeyVersion(caseId, keyVersion) {
        const metadataPath = path.join(this.caseDir(caseId), "case.json");
        await access(metadataPath);
        const raw = JSON.parse(await readFile(metadataPath, "utf8"));
        if (raw.caseId !==
            caseId ||
            raw.keyVersion !==
                keyVersion ||
            typeof raw
                .createdByUserId !==
                "string") {
            throw new Error("CASE_KEY_VERSION_MISMATCH");
        }
    }
    async saveSource(args) {
        await this
            .assertCaseKeyVersion(args.caseId, args.keyVersion);
        const documentDir = this.documentDir(args.caseId, args.documentId);
        const imagesDir = path.join(documentDir, IMAGES_DIR);
        const referenced = new Set();
        const pages = [];
        for (const page of args.source.pages) {
            let stored = page;
            for (const field of PAGE_IMAGE_FIELDS) {
                const image = page[field];
                if (!image?.jpeg)
                    continue;
                const { jpeg, ...meta } = image;
                const hash = imageHash(image);
                const targetFile = path.join(imagesDir, `${hash}.lme`);
                if (!referenced.has(hash)) {
                    referenced.add(hash);
                    try {
                        await access(targetFile);
                    }
                    catch {
                        const data = Buffer.from(jpeg, "utf8");
                        try {
                            await writeCaseBlob({
                                targetFile,
                                identity: pageImageIdentity(args.caseId, args.documentId, hash, args.keyVersion),
                                caseDataKey: args.caseDataKey,
                                data
                            });
                        }
                        finally {
                            data.fill(0);
                        }
                    }
                }
                const blob = { ...meta, blob: hash };
                stored = { ...stored, [field]: blob };
            }
            pages.push(stored);
        }
        const payload = {
            schemaVersion: 1,
            caseId: args.caseId,
            documentId: args.documentId,
            mediaType: args.mediaType,
            source: {
                ...args.source,
                pages
            }
        };
        const bytes = Buffer.from(JSON.stringify(payload), "utf8");
        try {
            if (bytes.byteLength >
                this.maxSourceBytes) {
                throw new Error("DOCUMENT_SOURCE_STORE_LIMIT_EXCEEDED");
            }
            await writeCaseBlob({
                targetFile: path.join(this.documentDir(args.caseId, args.documentId), "source.lme"),
                identity: sourceIdentity(args.caseId, args.documentId, args.keyVersion),
                caseDataKey: args.caseDataKey,
                data: bytes
            });
        }
        finally {
            bytes.fill(0);
        }
        await this.removeUnreferencedImages(imagesDir, referenced);
    }
    async removeUnreferencedImages(imagesDir, referenced) {
        let names;
        try {
            names = await readdir(imagesDir);
        }
        catch {
            return;
        }
        for (const name of names) {
            const match = /^([a-f0-9]{64})\.lme$/.exec(name);
            if (match && !referenced.has(match[1])) {
                await rm(path.join(imagesDir, name), { force: true });
            }
        }
    }
    /** Puts the image blobs back into pages; a missing one leaves the page text-only. */
    async attachImages(args) {
        const imagesDir = path.join(this.documentDir(args.caseId, args.documentId), IMAGES_DIR);
        const pages = [];
        for (const page of args.pages) {
            let restored = page;
            for (const field of PAGE_IMAGE_FIELDS) {
                const stored = page[field];
                if (!stored || typeof stored.blob !== "string")
                    continue;
                const { [field]: _image, ...rest } = restored;
                restored = rest;
                const { blob, ...meta } = stored;
                if (!/^[a-f0-9]{64}$/.test(blob))
                    continue;
                try {
                    const bytes = await readCaseBlob({
                        targetFile: path.join(imagesDir, `${blob}.lme`),
                        identity: pageImageIdentity(args.caseId, args.documentId, blob, args.keyVersion),
                        caseDataKey: args.caseDataKey,
                        maxBytes: MAX_PAGE_IMAGE_BYTES
                    });
                    const image = { ...meta, jpeg: bytes.toString("utf8") };
                    bytes.fill(0);
                    imageHashes.set(image, blob);
                    restored = { ...restored, [field]: image };
                }
                catch {
                    // Missing or unreadable blob: the page stays text-only.
                }
            }
            pages.push(restored);
        }
        return pages;
    }
    async saveProtected(args) {
        await this
            .assertCaseKeyVersion(args.caseId, args.keyVersion);
        const payload = {
            schemaVersion: 1,
            caseId: args.caseId,
            documentId: args.documentId,
            ingestion: args.ingestion
        };
        const bytes = Buffer.from(JSON.stringify(payload), "utf8");
        try {
            if (bytes.byteLength >
                this.maxProtectedBytes) {
                throw new Error("PROTECTED_DOCUMENT_STORE_LIMIT_EXCEEDED");
            }
            await writeCaseBlob({
                targetFile: path.join(this.documentDir(args.caseId, args.documentId), "protected.lme"),
                identity: protectedIdentity(args.caseId, args.documentId, args.keyVersion),
                caseDataKey: args.caseDataKey,
                data: bytes
            });
        }
        finally {
            bytes.fill(0);
        }
    }
    async listDocumentIds(caseId) {
        let entries;
        try {
            entries =
                await readdir(this.documentsDir(caseId), {
                    withFileTypes: true
                });
        }
        catch (error) {
            if (error instanceof Error &&
                "code" in error &&
                error.code ===
                    "ENOENT") {
                return [];
            }
            throw error;
        }
        return entries
            .filter((entry) => entry.isDirectory() &&
            validDocumentId(entry.name))
            .map((entry) => entry.name)
            .sort();
    }
    async loadSource(args) {
        await this
            .assertCaseKeyVersion(args.caseId, args.keyVersion);
        const bytes = await readCaseBlob({
            targetFile: path.join(this.documentDir(args.caseId, args.documentId), "source.lme"),
            identity: sourceIdentity(args.caseId, args.documentId, args.keyVersion),
            caseDataKey: args.caseDataKey,
            maxBytes: this.maxSourceBytes
        });
        try {
            const parsed = parseJson(bytes, "DOCUMENT_SOURCE_STORE_INVALID");
            if (parsed.schemaVersion !==
                1 ||
                parsed.caseId !==
                    args.caseId ||
                parsed.documentId !==
                    args.documentId ||
                !parsed.source ||
                parsed.source.complete !==
                    true ||
                !Array.isArray(parsed.source.pages) ||
                !Array.isArray(parsed.source.chunks)) {
                throw new Error("DOCUMENT_SOURCE_STORE_INVALID");
            }
            return {
                mediaType: parsed.mediaType,
                source: {
                    ...parsed.source,
                    pages: await this.attachImages({
                        caseId: args.caseId,
                        documentId: args.documentId,
                        caseDataKey: args.caseDataKey,
                        keyVersion: args.keyVersion,
                        pages: parsed.source.pages
                    })
                }
            };
        }
        finally {
            bytes.fill(0);
        }
    }
    async loadProtected(args) {
        await this
            .assertCaseKeyVersion(args.caseId, args.keyVersion);
        const bytes = await readCaseBlob({
            targetFile: path.join(this.documentDir(args.caseId, args.documentId), "protected.lme"),
            identity: protectedIdentity(args.caseId, args.documentId, args.keyVersion),
            caseDataKey: args.caseDataKey,
            maxBytes: this.maxProtectedBytes
        });
        try {
            const parsed = parseJson(bytes, "PROTECTED_DOCUMENT_STORE_INVALID");
            if (parsed.schemaVersion !==
                1 ||
                parsed.caseId !==
                    args.caseId ||
                parsed.documentId !==
                    args.documentId ||
                !parsed.ingestion ||
                parsed.ingestion
                    .documentId !==
                    args.documentId ||
                !Array.isArray(parsed.ingestion.chunks)) {
                throw new Error("PROTECTED_DOCUMENT_STORE_INVALID");
            }
            return parsed.ingestion;
        }
        finally {
            bytes.fill(0);
        }
    }
    async listProtectedDocuments(args) {
        await this
            .assertCaseKeyVersion(args.caseId, args.keyVersion);
        let entries;
        try {
            entries =
                await readdir(this.documentsDir(args.caseId), {
                    withFileTypes: true
                });
        }
        catch (error) {
            if (error instanceof
                Error &&
                "code" in error &&
                error.code ===
                    "ENOENT") {
                return [];
            }
            throw error;
        }
        const result = [];
        for (const entry of entries) {
            if (!entry.isDirectory() ||
                !validDocumentId(entry.name)) {
                continue;
            }
            try {
                result.push(await this
                    .loadProtected({
                    caseId: args.caseId,
                    documentId: entry.name,
                    caseDataKey: args.caseDataKey,
                    keyVersion: args.keyVersion
                }));
            }
            catch (error) {
                if (error instanceof
                    Error &&
                    error.message ===
                        "ENOENT") {
                    continue;
                }
                throw error;
            }
        }
        return result.sort((a, b) => a.documentId
            .localeCompare(b.documentId));
    }
    async rekeyCaseDocuments(args) {
        let entries;
        try {
            entries =
                await readdir(this.documentsDir(args.caseId), {
                    withFileTypes: true
                });
        }
        catch (error) {
            if (error instanceof Error &&
                "code" in error &&
                error.code ===
                    "ENOENT") {
                return false;
            }
            throw error;
        }
        const descriptors = [];
        for (const entry of entries) {
            if (!entry.isDirectory() ||
                !validDocumentId(entry.name)) {
                continue;
            }
            const dir = this.documentDir(args.caseId, entry.name);
            for (const kind of [
                "source",
                "protected"
            ]) {
                const targetFile = path.join(dir, kind === "source"
                    ? "source.lme"
                    : "protected.lme");
                try {
                    await access(targetFile);
                }
                catch {
                    continue;
                }
                descriptors.push({
                    targetFile,
                    oldIdentity: kind === "source"
                        ? sourceIdentity(args.caseId, entry.name, args.oldKeyVersion)
                        : protectedIdentity(args.caseId, entry.name, args.oldKeyVersion),
                    newIdentity: kind === "source"
                        ? sourceIdentity(args.caseId, entry.name, args.newKeyVersion)
                        : protectedIdentity(args.caseId, entry.name, args.newKeyVersion)
                });
            }
            let images = [];
            try {
                images = await readdir(path.join(dir, IMAGES_DIR));
            }
            catch {
                images = [];
            }
            for (const name of images.sort()) {
                const match = /^([a-f0-9]{64})\.lme$/.exec(name);
                if (!match)
                    continue;
                descriptors.push({
                    targetFile: path.join(dir, IMAGES_DIR, name),
                    oldIdentity: pageImageIdentity(args.caseId, entry.name, match[1], args.oldKeyVersion),
                    newIdentity: pageImageIdentity(args.caseId, entry.name, match[1], args.newKeyVersion)
                });
            }
        }
        const completed = [];
        try {
            for (const descriptor of descriptors) {
                await rekeyCaseBlob({
                    targetFile: descriptor.targetFile,
                    oldIdentity: descriptor
                        .oldIdentity,
                    newIdentity: descriptor
                        .newIdentity,
                    oldCaseDataKey: args.oldCaseDataKey,
                    newCaseDataKey: args.newCaseDataKey
                });
                completed.push(descriptor);
            }
            return (descriptors.length > 0);
        }
        catch (error) {
            try {
                for (const descriptor of [...completed]
                    .reverse()) {
                    await rekeyCaseBlob({
                        targetFile: descriptor.targetFile,
                        oldIdentity: descriptor
                            .newIdentity,
                        newIdentity: descriptor
                            .oldIdentity,
                        oldCaseDataKey: args.newCaseDataKey,
                        newCaseDataKey: args.oldCaseDataKey
                    });
                }
            }
            catch {
                throw new Error("SECURE_DOCUMENT_REKEY_ROLLBACK_FAILED");
            }
            throw error;
        }
    }
}
