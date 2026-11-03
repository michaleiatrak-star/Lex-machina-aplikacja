import { isRecordingMediaType, RECORDING_MEDIA_TYPES } from "./transcription.js";
import { DOCX_MEDIA_TYPE, ODT_MEDIA_TYPE } from "./office-document-extractor.js";
import { CSV_MEDIA_TYPE, TSV_MEDIA_TYPE, XLSM_MEDIA_TYPE, XLSX_MEDIA_TYPE } from "./spreadsheet-extractor.js";
// ZIP containers (OOXML, ODF): only the archive signature is checked here;
// the extractors validate the package itself.
const ZIP_TYPES = new Set([
    DOCX_MEDIA_TYPE,
    ODT_MEDIA_TYPE,
    XLSX_MEDIA_TYPE,
    XLSM_MEDIA_TYPE
]);
const TEXT_TYPES = new Set([
    "text/plain",
    "text/markdown",
    CSV_MEDIA_TYPE,
    TSV_MEDIA_TYPE
]);
const SUPPORTED = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/tiff",
    ...[...ZIP_TYPES, ...TEXT_TYPES],
    "message/rfc822",
    "application/rtf",
    ...Object.keys(RECORDING_MEDIA_TYPES)
]);
export function storedDocumentMediaType(value) {
    const type = value?.split(";")[0].trim().toLowerCase();
    return type &&
        SUPPORTED.has(type)
        ? type
        : null;
}
function startsWithBytes(data, bytes) {
    return (data.byteLength >=
        bytes.length &&
        bytes.every((value, index) => data[index] === value));
}
export function hasStoredDocumentSignature(data, mediaType) {
    if (mediaType ===
        "application/pdf") {
        const prefix = Buffer.from(data.subarray(0, Math.min(data.byteLength, 1024)));
        return (prefix.indexOf(Buffer.from("%PDF-", "ascii")) >= 0);
    }
    if (mediaType ===
        "image/jpeg") {
        return startsWithBytes(data, [0xff, 0xd8, 0xff]);
    }
    if (mediaType ===
        "image/png") {
        return startsWithBytes(data, [
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a
        ]);
    }
    if (mediaType ===
        "image/webp") {
        return (data.byteLength >= 12 &&
            Buffer.from(data.subarray(0, 4)).toString("ascii") ===
                "RIFF" &&
            Buffer.from(data.subarray(8, 12)).toString("ascii") ===
                "WEBP");
    }
    if (mediaType ===
        "image/tiff") {
        return (startsWithBytes(data, [0x49, 0x49, 0x2a, 0x00]) ||
            startsWithBytes(data, [0x4d, 0x4d, 0x00, 0x2a]));
    }
    if (ZIP_TYPES.has(mediaType)) {
        return startsWithBytes(data, [0x50, 0x4b, 0x03, 0x04]);
    }
    if (isRecordingMediaType(mediaType)) {
        return hasRecordingSignature(data);
    }
    if (mediaType === "application/rtf") {
        return Buffer.from(data.subarray(0, 16)).toString("latin1").trimStart().startsWith("{\\rtf");
    }
    if (mediaType === "message/rfc822") {
        // Headers of an e-mail are text; a NUL byte early on means binary content.
        return data.byteLength > 0 && !data.subarray(0, 8192).includes(0);
    }
    if (TEXT_TYPES.has(mediaType)) {
        // Text has no signature; a NUL byte early on means binary content.
        return !data
            .subarray(0, 8192)
            .includes(0);
    }
    return false;
}
export function assertStoredDocumentSignature(data, mediaType) {
    if (!hasStoredDocumentSignature(data, mediaType)) {
        throw new Error("STORED_DOCUMENT_SIGNATURE_MISMATCH");
    }
}
/** A recording container by its first bytes (the exact codec is checked by the decoder). */
export function hasRecordingSignature(data) {
    const ascii = (from, to) => Buffer.from(data.subarray(from, to)).toString("latin1");
    if (data.byteLength < 12)
        return false;
    if (ascii(0, 3) === "ID3")
        return true; // MP3 with tags
    if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
        return true; // MPEG audio / ADTS AAC frame
    if (ascii(0, 4) === "RIFF" && ["WAVE", "AVI "].includes(ascii(8, 12)))
        return true;
    if (ascii(0, 4) === "OggS" || ascii(0, 4) === "fLaC")
        return true;
    if (ascii(4, 8) === "ftyp")
        return true; // MP4, M4A, MOV
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3)
        return true; // WebM, MKV
    return ascii(4, 8) === "moov" || ascii(4, 8) === "wide" || ascii(4, 8) === "mdat"; // older QuickTime
}
