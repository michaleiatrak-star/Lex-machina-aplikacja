import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The sender of the user's letters (Ustawienia > Papier firmowy, user 2026-11-20): a person's name
 * or a firm's, its address and contact lines. Kept on this computer only; it reaches the letter's
 * file at rendering (its letterhead and the template's {{nadawca}} / {{adres nadawcy}}), never a model.
 */
export type LetterSender = {
  name: string;
  address: string;
  contact: string;
  // A firm template (Wzory i wiedza) used as the letterhead when a letter has no template chosen:
  // its header and footer frame the letter.
  templateId: string;
  // Whether a logo is kept (its bytes are read with readLetterLogo).
  logo: boolean;
};

const EMPTY: LetterSender = { name: "", address: "", contact: "", templateId: "", logo: false };

function rootDir(): string {
  return path.resolve(process.env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"));
}

function fileOf(userId: string, root: string): string {
  if (!/^[A-Za-z0-9_-]{1,96}$/u.test(userId)) throw new Error("LETTER_SENDER_USER_INVALID");
  return path.join(root, "letter-sender", `${userId}.json`);
}

const clean = (value: unknown, max: number, lines: number) =>
  typeof value === "string"
    ? value
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.replace(/[\u0000-\u001f\u007f]/gu, "").trim())
        .filter(Boolean)
        .slice(0, lines)
        .join("\n")
        .slice(0, max)
    : "";

export function readLetterSender(userId: string, root: string = rootDir()): LetterSender {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(userId, root), "utf8")) as Partial<LetterSender>;
    return { ...fields(raw), logo: Boolean(logoFile(userId, root)) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveLetterSender(userId: string, input: unknown, root: string = rootDir()): LetterSender {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sender = fields(body);
  const file = fileOf(userId, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sender), { encoding: "utf8", mode: 0o600 });
  return { ...sender, logo: Boolean(logoFile(userId, root)) };
}

function fields(raw: Record<string, unknown> | Partial<LetterSender>): Omit<LetterSender, "logo"> {
  const record = raw as Record<string, unknown>;
  const templateId = typeof record.templateId === "string" && /^template_[a-f0-9]{32}$/u.test(record.templateId) ? record.templateId : "";
  return { name: clean(record.name, 160, 1), address: clean(record.address, 300, 3), contact: clean(record.contact, 200, 2), templateId };
}

const LOGO_TYPES = { png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), jpeg: Buffer.from([0xff, 0xd8, 0xff]) } as const;
export const MAX_LETTER_LOGO_BYTES = 1024 * 1024;

function logoFile(userId: string, root: string): { file: string; type: "png" | "jpeg" } | null {
  for (const type of ["png", "jpeg"] as const) {
    const file = fileOf(userId, root).replace(/\.json$/u, `.logo.${type}`);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

/** The logo of the letterhead (PNG or JPEG), or null. */
export function readLetterLogo(userId: string, root: string = rootDir()): { data: Buffer; type: "png" | "jpeg" } | null {
  const found = logoFile(userId, root);
  if (!found) return null;
  try {
    return { data: fs.readFileSync(found.file), type: found.type };
  } catch {
    return null;
  }
}

/** Keeps a PNG or JPEG logo (up to 1 MB); null data removes it. */
export function saveLetterLogo(userId: string, data: Buffer | null, root: string = rootDir()): boolean {
  const previous = logoFile(userId, root);
  if (previous) fs.rmSync(previous.file, { force: true });
  if (!data || !data.length) return false;
  if (data.length > MAX_LETTER_LOGO_BYTES) throw new Error("LETTER_LOGO_TOO_LARGE");
  const type = (Object.keys(LOGO_TYPES) as Array<keyof typeof LOGO_TYPES>).find((key) => data.subarray(0, LOGO_TYPES[key].length).equals(LOGO_TYPES[key]));
  if (!type) throw new Error("LETTER_LOGO_TYPE_UNSUPPORTED");
  const file = fileOf(userId, root).replace(/\.json$/u, `.logo.${type}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
  return true;
}
