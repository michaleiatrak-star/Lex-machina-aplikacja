import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Certyfikat HTTPS strony aplikacji. Własny certyfikat kancelarii (LEX_TLS_CERT i LEX_TLS_KEY albo
 * pliki custom.crt i custom.key w katalogu), inaczej certyfikat aplikacji wystawiony przy starcie
 * (ECDSA P-256, SHA-256) dla localhost, 127.0.0.1, nazwy komputera i jego adresów w sieci.
 * Przeglądarka ostrzega o nim, dopóki nie zostanie dodany do zaufanych (Pobierz certyfikat).
 */
export type TlsMaterial = {
  key: string;
  cert: string;
  fingerprint256: string;
  validTo: string;
  custom: boolean;
  names: string[];
};

const VALIDITY_DAYS = 397;
const RENEW_BEFORE_DAYS = 30;

// ---- DER (tylko to, czego potrzebuje certyfikat) ----

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(value.length), value]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const explicit = (index: number, value: Buffer) => tlv(0xa0 + index, value);

function integer(value: Buffer): Buffer {
  let body = value;
  while (body.length > 1 && body[0] === 0 && (body[1]! & 0x80) === 0) body = body.subarray(1);
  if (body[0]! & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes: number[] = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let rest = part;
    do {
      chunk.unshift(rest & 0x7f);
      rest = Math.floor(rest / 128);
    } while (rest > 0);
    for (let index = 0; index < chunk.length - 1; index += 1) chunk[index]! |= 0x80;
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // UTCTime do 2049 r., potem GeneralizedTime (RFC 5280, 4.1.2.5).
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

function name(commonName: string): Buffer {
  return sequence(set(sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from(commonName, "utf8")))));
}

function ipBytes(address: string): Buffer | undefined {
  if (net.isIPv4(address)) return Buffer.from(address.split(".").map(Number));
  if (!net.isIPv6(address)) return undefined;
  const [head = "", tail = ""] = address.split("::");
  const groups = (part: string) => (part ? part.split(":") : []);
  const missing = 8 - groups(head).length - groups(tail).length;
  const all = [...groups(head), ...Array(address.includes("::") ? missing : 0).fill("0"), ...groups(tail)];
  return Buffer.from(all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  }));
}

function subjectAltName(names: string[]): Buffer {
  const entries = names.map((item) => {
    const ip = ipBytes(item);
    return ip ? tlv(0x87, ip) : tlv(0x82, Buffer.from(item, "ascii"));
  });
  return sequence(oid("2.5.29.17"), tlv(0x04, sequence(...entries)));
}

export function createSelfSignedCertificate(names: string[], now = new Date()): { key: string; cert: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaSha256 = sequence(oid("1.2.840.10045.4.3.2"));
  const subject = name(`Lex Machina (${os.hostname()})`);
  const notBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const extensions = explicit(
    3,
    sequence(
      sequence(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, sequence())),
      sequence(oid("2.5.29.15"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, tlv(0x03, Buffer.from([0x07, 0x80])))),
      sequence(oid("2.5.29.37"), tlv(0x04, sequence(oid("1.3.6.1.5.5.7.3.1")))),
      subjectAltName(names)
    )
  );
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(crypto.randomBytes(16)),
    ecdsaSha256,
    subject,
    sequence(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: "spki", format: "der" }),
    extensions
  );
  const signature = crypto.sign("sha256", tbs, privateKey);
  const der = sequence(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/.{1,64}/g, "$&\n")}-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), cert };
}

/** Nazwy w certyfikacie: pętla zwrotna, nazwa komputera, adresy w sieci i nazwy od administratora. */
export function certificateNames(extra: string[] = []): string[] {
  const names = new Set<string>(["localhost", "127.0.0.1", "::1", os.hostname().toLowerCase()]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && (entry.family === "IPv4" || !entry.address.startsWith("fe80"))) names.add(entry.address);
    }
  }
  for (const item of extra) {
    const value = item.trim().toLowerCase();
    if (value && /^[a-z0-9.:-]+$/.test(value)) names.add(value);
  }
  return [...names];
}

function covers(certificate: crypto.X509Certificate, names: string[]): boolean {
  return names.every((item) => (net.isIP(item) ? certificate.checkIP(item) : certificate.checkHost(item)) !== undefined);
}

function material(key: string, cert: string, custom: boolean): TlsMaterial {
  const certificate = new crypto.X509Certificate(cert);
  if (!certificate.checkPrivateKey(crypto.createPrivateKey(key))) throw new Error("TLS_KEY_MISMATCH");
  return {
    key,
    cert,
    fingerprint256: certificate.fingerprint256,
    validTo: new Date(certificate.validTo).toISOString(),
    custom,
    names: (certificate.subjectAltName ?? "").split(", ").map((item) => item.replace(/^(?:DNS|IP Address):/, ""))
  };
}

export function ensureCertificate(dir: string, names: string[], now = new Date()): TlsMaterial {
  const customCert = process.env.LEX_TLS_CERT?.trim() || path.join(dir, "custom.crt");
  const customKey = process.env.LEX_TLS_KEY?.trim() || path.join(dir, "custom.key");
  if (fs.existsSync(customCert) && fs.existsSync(customKey)) {
    return material(fs.readFileSync(customKey, "utf8"), fs.readFileSync(customCert, "utf8"), true);
  }
  const certPath = path.join(dir, "lex-selfsigned.crt");
  const keyPath = path.join(dir, "lex-selfsigned.key");
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const current = material(fs.readFileSync(keyPath, "utf8"), fs.readFileSync(certPath, "utf8"), false);
      const certificate = new crypto.X509Certificate(current.cert);
      const renewAt = Date.parse(certificate.validTo) - RENEW_BEFORE_DAYS * 24 * 60 * 60 * 1000;
      if (renewAt > now.getTime() && covers(certificate, names)) return current;
    } catch {
      // Uszkodzony albo niepasujący klucz: nowy certyfikat poniżej.
    }
  }
  const created = createSelfSignedCertificate(names, now);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyPath, created.key, { mode: 0o600 });
  fs.writeFileSync(certPath, created.cert, { mode: 0o644 });
  return material(created.key, created.cert, false);
}
