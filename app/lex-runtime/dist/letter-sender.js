import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const EMPTY = { name: "", address: "", contact: "", templateId: "", logo: false };
function rootDir() {
    return path.resolve(process.env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"));
}
function fileOf(userId, root) {
    if (!/^[A-Za-z0-9_-]{1,96}$/u.test(userId))
        throw new Error("LETTER_SENDER_USER_INVALID");
    return path.join(root, "letter-sender", `${userId}.json`);
}
const clean = (value, max, lines) => typeof value === "string"
    ? value
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.replace(/[\u0000-\u001f\u007f]/gu, "").trim())
        .filter(Boolean)
        .slice(0, lines)
        .join("\n")
        .slice(0, max)
    : "";
export function readLetterSender(userId, root = rootDir()) {
    try {
        const raw = JSON.parse(fs.readFileSync(fileOf(userId, root), "utf8"));
        return { ...fields(raw), logo: Boolean(logoFile(userId, root)) };
    }
    catch {
        return { ...EMPTY };
    }
}
export function saveLetterSender(userId, input, root = rootDir()) {
    const body = (input && typeof input === "object" ? input : {});
    const sender = fields(body);
    const file = fileOf(userId, root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sender), { encoding: "utf8", mode: 0o600 });
    return { ...sender, logo: Boolean(logoFile(userId, root)) };
}
function fields(raw) {
    const record = raw;
    const templateId = typeof record.templateId === "string" && /^template_[a-f0-9]{32}$/u.test(record.templateId) ? record.templateId : "";
    return { name: clean(record.name, 160, 1), address: clean(record.address, 300, 3), contact: clean(record.contact, 200, 2), templateId };
}
const LOGO_TYPES = { png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), jpeg: Buffer.from([0xff, 0xd8, 0xff]) };
export const MAX_LETTER_LOGO_BYTES = 1024 * 1024;
function logoFile(userId, root) {
    for (const type of ["png", "jpeg"]) {
        const file = fileOf(userId, root).replace(/\.json$/u, `.logo.${type}`);
        if (fs.existsSync(file))
            return { file, type };
    }
    return null;
}
/** The logo of the letterhead (PNG or JPEG), or null. */
export function readLetterLogo(userId, root = rootDir()) {
    const found = logoFile(userId, root);
    if (!found)
        return null;
    try {
        return { data: fs.readFileSync(found.file), type: found.type };
    }
    catch {
        return null;
    }
}
/** Keeps a PNG or JPEG logo (up to 1 MB); null data removes it. */
export function saveLetterLogo(userId, data, root = rootDir()) {
    const previous = logoFile(userId, root);
    if (previous)
        fs.rmSync(previous.file, { force: true });
    if (!data || !data.length)
        return false;
    if (data.length > MAX_LETTER_LOGO_BYTES)
        throw new Error("LETTER_LOGO_TOO_LARGE");
    const type = Object.keys(LOGO_TYPES).find((key) => data.subarray(0, LOGO_TYPES[key].length).equals(LOGO_TYPES[key]));
    if (!type)
        throw new Error("LETTER_LOGO_TYPE_UNSUPPORTED");
    const file = fileOf(userId, root).replace(/\.json$/u, `.logo.${type}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { mode: 0o600 });
    return true;
}
