import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** AES-256-GCM ciphertext of one secret, bound to its purpose and owner (AAD). */
export type SealedSecret = {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
};

function aesSeal(key: Buffer, aad: string, plaintext: Buffer): SealedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

function aesOpen(key: Buffer, aad: string, sealed: SealedSecret): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

function derive(root: Buffer, salt: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", root, Buffer.from(salt, "utf8"), Buffer.from(purpose, "utf8"), 32));
}

/**
 * Secrets the server needs without a user session (SMTP password, the
 * admin's global provider API keys, the UMK escrow for password reset by
 * e-mail). The root key comes from
 * LEX_SERVER_SECRET_KEY (base64, 32 bytes; a secret store of the container)
 * or a 0600 file next to the data, created on first use.
 */
export class ServerSecretBox {
  private readonly root: Buffer;

  constructor(options: { keyPath: string; envKey?: string | undefined }) {
    const fromEnv = options.envKey?.trim();
    if (fromEnv) {
      const key = Buffer.from(fromEnv, "base64");
      if (key.byteLength !== 32) throw new Error("LEX_SERVER_SECRET_KEY_INVALID");
      this.root = key;
      return;
    }
    if (existsSync(options.keyPath)) {
      const key = readFileSync(options.keyPath);
      if (key.byteLength !== 32) throw new Error("SERVER_SECRET_KEY_INVALID");
      this.root = Buffer.from(key);
      return;
    }
    mkdirSync(path.dirname(options.keyPath), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    writeFileSync(options.keyPath, key, { flag: "wx", mode: 0o600 });
    this.root = key;
  }

  seal(purpose: string, subject: string, plaintext: Buffer | string): SealedSecret {
    const key = derive(this.root, subject, `lex-server-box:${purpose}`);
    try {
      return aesSeal(key, `${purpose}:${subject}`, typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext);
    } finally {
      key.fill(0);
    }
  }

  open(purpose: string, subject: string, sealed: SealedSecret): Buffer {
    const key = derive(this.root, subject, `lex-server-box:${purpose}`);
    try {
      return aesOpen(key, `${purpose}:${subject}`, sealed);
    } finally {
      key.fill(0);
    }
  }

  close(): void {
    this.root.fill(0);
  }
}

export function sealedToJson(sealed: SealedSecret): string {
  return JSON.stringify({
    nonce: sealed.nonce.toString("base64"),
    ciphertext: sealed.ciphertext.toString("base64"),
    tag: sealed.tag.toString("base64")
  });
}

export function sealedFromJson(value: string): SealedSecret {
  const parsed = JSON.parse(value) as Record<string, string>;
  return {
    nonce: Buffer.from(parsed.nonce ?? "", "base64"),
    ciphertext: Buffer.from(parsed.ciphertext ?? "", "base64"),
    tag: Buffer.from(parsed.tag ?? "", "base64")
  };
}
