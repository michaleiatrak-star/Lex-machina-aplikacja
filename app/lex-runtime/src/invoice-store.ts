import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  NumberingError,
  nextAutoNumber,
  validateNumbering,
  type NumberingSettings
} from "./invoice-numbering.js";

// Faktury, ustawienia KSeF i wzór faktury jednego użytkownika: jeden plik
// zaszyfrowany kluczem wyprowadzonym z klucza głównego użytkownika (UMK).
// Token KSeF nie opuszcza pliku — API zwraca tylko informację, że jest ustawiony.

export type KsefEnvironment = "test" | "production";

export type InvoiceParty = {
  name: string;
  nip?: string;
  address: string;
  countryCode?: string;
};

export type InvoiceLine = {
  name: string;
  unit: string;
  // Dziesiętne jako tekst z kropką: "1", "2.5", "1234.56".
  quantity: string;
  unitNetPrice: string;
  // Stawka w procentach ("23") albo oznaczenie bez stawki ("zw", "np").
  vatRate: string;
  // Opust kwotowo (netto, cała pozycja), gdy nie jest wliczony w cenę jednostkową.
  discount?: string;
};

// Oznaczenia faktury wybierane przez użytkownika (art. 106e ust. 1 pkt 16–19,
// mapowanie weryfikowane na żywo przez ELI, zob. invoice-requirements.ts).
export type InvoiceAnnotations = {
  cashMethod?: boolean;
  selfBilling?: boolean;
  reverseCharge?: boolean;
  splitPayment?: boolean;
  exemptionBasis?: string;
};

export type InvoiceStatus = "DRAFT" | "ISSUED";

export type InvoiceRecord = {
  invoiceId: string;
  number: string;
  issueDate: string;
  saleDate?: string;
  placeOfIssue?: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  currency: string;
  paymentMethod?: string;
  paymentDueDate?: string;
  bankAccount?: string;
  notes?: string;
  annotations?: InvoiceAnnotations;
  status: InvoiceStatus;
  basedOnInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceInput = Omit<
  InvoiceRecord,
  "invoiceId" | "status" | "createdAt" | "updatedAt" | "basedOnInvoiceId"
>;

export type InvoiceLogo = {
  mediaType: "image/png" | "image/jpeg";
  fileName: string;
  base64: string;
  uploadedAt: string;
};

type StoredKsef = {
  environment: KsefEnvironment;
  token?: string;
  tokenSetAt?: string;
  contextNip?: string;
};

type StoredInvoices = {
  schemaVersion: 1;
  userId: string;
  ksef: StoredKsef;
  seller?: InvoiceParty;
  logo?: InvoiceLogo;
  numbering?: NumberingSettings;
  invoices: InvoiceRecord[];
};

export type KsefSettingsView = {
  environment: KsefEnvironment;
  tokenConfigured: boolean;
  tokenHint?: string;
  tokenSetAt?: string;
  contextNip?: string;
};

export type InvoiceTotals = {
  byRate: Array<{ vatRate: string; net: string; vat: string; gross: string }>;
  net: string;
  vat: string;
  gross: string;
};

export type InvoiceSort =
  | "date-desc"
  | "date-asc"
  | "client-asc"
  | "client-desc";

export const INVOICE_SORTS: InvoiceSort[] = [
  "date-desc",
  "date-asc",
  "client-asc",
  "client-desc"
];

export class InvoiceError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number
  ) {
    super(code);
    this.name = "InvoiceError";
  }
}

const FILE_PURPOSE = "lex-invoices-v1";
const MAX_LOGO_BYTES = 512 * 1024;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_LINES = 200;
const MAX_TEXT = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;
const PRICE = /^\d{1,12}(\.\d{1,2})?$/;
const PERCENT_RATE = /^\d{1,2}(\.\d{1,2})?$/;
const CODE_RATE = /^[a-z]{2,4}$/;
const NIP = /^\d{10}$/;

function defaultRootDir(): string {
  return path.resolve(
    process.env.LEX_DATA_DIR ??
      path.join(os.homedir(), ".lex-machina", "data")
  );
}

function validUserId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,96}$/.test(value);
}

function fileKey(userMasterKey: Buffer, userId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      userMasterKey,
      Buffer.from(userId, "utf8"),
      Buffer.from(FILE_PURPOSE, "utf8"),
      32
    )
  );
}

function aad(userId: string): Buffer {
  return Buffer.from([FILE_PURPOSE, userId].join("\u0000"), "utf8");
}

function text(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new InvoiceError(`INVOICE_FIELD_REQUIRED:${field}`, 400);
    return undefined;
  }
  if (typeof value !== "string") throw new InvoiceError(`INVOICE_FIELD_INVALID:${field}`, 400);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new InvoiceError(`INVOICE_FIELD_REQUIRED:${field}`, 400);
    return undefined;
  }
  if (trimmed.length > MAX_TEXT) throw new InvoiceError(`INVOICE_FIELD_TOO_LONG:${field}`, 400);
  return trimmed;
}

function pattern(value: unknown, field: string, regex: RegExp, required: boolean): string | undefined {
  const cleaned = text(value, field, required);
  if (cleaned !== undefined && !regex.test(cleaned)) {
    throw new InvoiceError(`INVOICE_FIELD_INVALID:${field}`, 400);
  }
  return cleaned;
}

export function normalizeNip(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/[\s-]/g, "");
  return digits || undefined;
}

function party(value: unknown, field: string): InvoiceParty {
  if (!value || typeof value !== "object") {
    throw new InvoiceError(`INVOICE_FIELD_REQUIRED:${field}`, 400);
  }
  const raw = value as Record<string, unknown>;
  const nip = normalizeNip(raw.nip);
  if (nip !== undefined && !NIP.test(nip)) {
    throw new InvoiceError(`INVOICE_FIELD_INVALID:${field}.nip`, 400);
  }
  const countryCode = pattern(raw.countryCode, `${field}.countryCode`, /^[A-Z]{2}$/, false);
  return {
    name: text(raw.name, `${field}.name`, true)!,
    ...(nip ? { nip } : {}),
    address: text(raw.address, `${field}.address`, true)!,
    ...(countryCode ? { countryCode } : {})
  };
}

function line(value: unknown, index: number): InvoiceLine {
  if (!value || typeof value !== "object") {
    throw new InvoiceError(`INVOICE_FIELD_INVALID:lines.${index}`, 400);
  }
  const raw = value as Record<string, unknown>;
  const field = (name: string) => `lines.${index}.${name}`;
  const vatRate = text(raw.vatRate, field("vatRate"), true)!.toLowerCase();
  if (!PERCENT_RATE.test(vatRate) && !CODE_RATE.test(vatRate)) {
    throw new InvoiceError(`INVOICE_FIELD_INVALID:${field("vatRate")}`, 400);
  }
  const discount = pattern(
    typeof raw.discount === "string" ? raw.discount.replace(",", ".") : raw.discount,
    field("discount"),
    PRICE,
    false
  );
  const quantity = pattern(
    typeof raw.quantity === "string" ? raw.quantity.replace(",", ".") : raw.quantity,
    field("quantity"),
    DECIMAL,
    true
  )!;
  if (toScaled(quantity, 6) === 0n) {
    throw new InvoiceError(`INVOICE_FIELD_INVALID:${field("quantity")}`, 400);
  }
  return {
    name: text(raw.name, field("name"), true)!,
    unit: text(raw.unit, field("unit"), true)!,
    quantity,
    unitNetPrice: pattern(
      typeof raw.unitNetPrice === "string" ? raw.unitNetPrice.replace(",", ".") : raw.unitNetPrice,
      field("unitNetPrice"),
      PRICE,
      true
    )!,
    vatRate,
    ...(discount && toScaled(discount, 2) > 0n ? { discount } : {})
  };
}

function annotations(value: unknown): InvoiceAnnotations | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new InvoiceError("INVOICE_FIELD_INVALID:annotations", 400);
  const raw = value as Record<string, unknown>;
  const result: InvoiceAnnotations = {};
  for (const flag of ["cashMethod", "selfBilling", "reverseCharge", "splitPayment"] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") {
      throw new InvoiceError(`INVOICE_FIELD_INVALID:annotations.${flag}`, 400);
    }
    if (raw[flag] === true) result[flag] = true;
  }
  const basis = text(raw.exemptionBasis, "annotations.exemptionBasis", false);
  if (basis) result.exemptionBasis = basis;
  return Object.keys(result).length ? result : undefined;
}

export function validateInvoiceInput(
  value: unknown,
  options: { allowAutoNumber?: boolean } = {}
): InvoiceInput {
  if (!value || typeof value !== "object") {
    throw new InvoiceError("INVOICE_INVALID", 400);
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
    throw new InvoiceError("INVOICE_FIELD_REQUIRED:lines", 400);
  }
  if (raw.lines.length > MAX_LINES) {
    throw new InvoiceError("INVOICE_FIELD_TOO_LONG:lines", 400);
  }
  const seller = party(raw.seller, "seller");
  if (!seller.nip) throw new InvoiceError("INVOICE_FIELD_REQUIRED:seller.nip", 400);
  const optional = {
    saleDate: pattern(raw.saleDate, "saleDate", DATE, false),
    placeOfIssue: text(raw.placeOfIssue, "placeOfIssue", false),
    paymentMethod: text(raw.paymentMethod, "paymentMethod", false),
    paymentDueDate: pattern(raw.paymentDueDate, "paymentDueDate", DATE, false),
    bankAccount: text(raw.bankAccount, "bankAccount", false),
    notes: text(raw.notes, "notes", false),
    annotations: annotations(raw.annotations)
  };
  const lines = raw.lines.map(line);
  lines.forEach((entry, index) => {
    if (lineNetCents(entry) < 0n) throw new InvoiceError(`INVOICE_FIELD_INVALID:lines.${index}.discount`, 400);
  });
  return {
    // Pusty numer = autonumeracja (jeśli ustawiona) przy zapisie.
    number: text(raw.number, "number", !options.allowAutoNumber) ?? "",
    issueDate: pattern(raw.issueDate, "issueDate", DATE, true)!,
    seller,
    buyer: party(raw.buyer, "buyer"),
    lines,
    currency: (pattern(raw.currency, "currency", /^[A-Z]{3}$/, false) ?? "PLN"),
    ...Object.fromEntries(
      Object.entries(optional).filter(([, entry]) => entry !== undefined)
    )
  };
}

// Kwoty liczone na liczbach całkowitych (grosze), bez błędów zmiennoprzecinkowych.
function toScaled(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole! + fraction.padEnd(scale, "0").slice(0, scale));
}

function roundDiv(value: bigint, divisor: bigint): bigint {
  return (value * 2n + divisor) / (divisor * 2n);
}

function money(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function lineNetCents(entry: InvoiceLine): bigint {
  // ilość (×10^6) · cena (×10^2) → ×10^8, zaokrąglenie do groszy, minus opust.
  return roundDiv(toScaled(entry.quantity, 6) * toScaled(entry.unitNetPrice, 2), 1_000_000n) -
    (entry.discount ? toScaled(entry.discount, 2) : 0n);
}

// Podatek liczony od sumy wartości netto w danej stawce.
export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const byRate = new Map<string, bigint>();
  for (const entry of lines) {
    byRate.set(entry.vatRate, (byRate.get(entry.vatRate) ?? 0n) + lineNetCents(entry));
  }
  let net = 0n;
  let vat = 0n;
  const rows = [...byRate.entries()].map(([vatRate, rateNet]) => {
    const rateVat = PERCENT_RATE.test(vatRate)
      ? roundDiv(rateNet * toScaled(vatRate, 2), 10_000n)
      : 0n;
    net += rateNet;
    vat += rateVat;
    return {
      vatRate,
      net: money(rateNet),
      vat: money(rateVat),
      gross: money(rateNet + rateVat)
    };
  });
  return { byRate: rows, net: money(net), vat: money(vat), gross: money(net + vat) };
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "pl", { sensitivity: "base" });
}

export function searchInvoices(
  invoices: InvoiceRecord[],
  query: string,
  sort: InvoiceSort
): InvoiceRecord[] {
  const needle = query.trim().toLocaleLowerCase("pl");
  const matching = needle
    ? invoices.filter((invoice) =>
        invoice.number.toLocaleLowerCase("pl").includes(needle) ||
        invoice.buyer.name.toLocaleLowerCase("pl").includes(needle) ||
        (invoice.buyer.nip ?? "").includes(needle.replace(/[\s-]/g, ""))
      )
    : invoices.slice();
  const byDate = (left: InvoiceRecord, right: InvoiceRecord) =>
    left.issueDate.localeCompare(right.issueDate) ||
    left.createdAt.localeCompare(right.createdAt);
  return matching.sort((left, right) => {
    switch (sort) {
      case "date-asc":
        return byDate(left, right);
      case "client-asc":
        return compareText(left.buyer.name, right.buyer.name) || byDate(right, left);
      case "client-desc":
        return compareText(right.buyer.name, left.buyer.name) || byDate(right, left);
      default:
        return byDate(right, left);
    }
  });
}

function decodeLogo(input: { mediaType?: unknown; base64?: unknown; fileName?: unknown }): InvoiceLogo {
  const mediaType = input.mediaType;
  if (mediaType !== "image/png" && mediaType !== "image/jpeg") {
    throw new InvoiceError("INVOICE_LOGO_TYPE", 400);
  }
  if (typeof input.base64 !== "string" || !input.base64) {
    throw new InvoiceError("INVOICE_LOGO_REQUIRED", 400);
  }
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength === 0) throw new InvoiceError("INVOICE_LOGO_REQUIRED", 400);
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new InvoiceError("INVOICE_LOGO_TOO_LARGE", 413);
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((mediaType === "image/png" && !png) || (mediaType === "image/jpeg" && !jpeg)) {
    throw new InvoiceError("INVOICE_LOGO_TYPE", 400);
  }
  const fileName = typeof input.fileName === "string"
    ? input.fileName.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "logo"
    : "logo";
  return {
    mediaType,
    fileName,
    base64: bytes.toString("base64"),
    uploadedAt: new Date().toISOString()
  };
}

function tokenHint(token: string): string {
  return token.length > 8 ? `…${token.slice(-4)}` : "…";
}

export type EncryptedInvoiceStoreOptions = {
  rootDir?: string;
  now?: () => Date;
};

export class EncryptedInvoiceStore {
  readonly rootDir: string;
  private readonly now: () => Date;
  // Zapisy jednego użytkownika po kolei: odczyt–zmiana–zapis bez wyścigu.
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: EncryptedInvoiceStoreOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? defaultRootDir());
    this.now = options.now ?? (() => new Date());
  }

  filePath(userId: string): string {
    if (!validUserId(userId)) throw new InvoiceError("INVALID_USER_ID", 400);
    return path.join(this.rootDir, "users", userId, "invoices.lme");
  }

  private async read(userId: string, userMasterKey: Buffer): Promise<StoredInvoices> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(userId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, userId, ksef: { environment: "test" }, invoices: [] };
      }
      throw error;
    }
    if (raw.length > MAX_STORE_BYTES * 2) throw new InvoiceError("INVOICE_STORE_INVALID", 500);
    const envelope = JSON.parse(raw) as { v?: unknown; nonce?: string; tag?: string; data?: string };
    if (envelope.v !== 1 || !envelope.nonce || !envelope.tag || !envelope.data) {
      throw new InvoiceError("INVOICE_STORE_INVALID", 500);
    }
    const key = fileKey(userMasterKey, userId);
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
      decipher.setAAD(aad(userId));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    } catch {
      throw new InvoiceError("INVOICE_STORE_DECRYPT_FAILED", 500);
    } finally {
      key.fill(0);
    }
    try {
      const parsed = JSON.parse(plaintext.toString("utf8")) as StoredInvoices;
      if (parsed.schemaVersion !== 1 || parsed.userId !== userId || !Array.isArray(parsed.invoices)) {
        throw new InvoiceError("INVOICE_STORE_INVALID", 500);
      }
      return parsed;
    } finally {
      plaintext.fill(0);
    }
  }

  private async write(userId: string, userMasterKey: Buffer, state: StoredInvoices): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(state), "utf8");
    if (plaintext.byteLength > MAX_STORE_BYTES) {
      plaintext.fill(0);
      throw new InvoiceError("INVOICE_STORE_TOO_LARGE", 413);
    }
    const key = fileKey(userMasterKey, userId);
    const nonce = randomBytes(12);
    let data: Buffer;
    let tag: Buffer;
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(userId));
      data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      tag = cipher.getAuthTag();
    } finally {
      key.fill(0);
      plaintext.fill(0);
    }
    const target = this.filePath(userId);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ v: 1, nonce: nonce.toString("base64"), tag: tag.toString("base64"), data: data.toString("base64") }),
        { mode: 0o600 }
      );
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private mutate<T>(
    userId: string,
    userMasterKey: Buffer,
    change: (state: StoredInvoices) => T
  ): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const state = await this.read(userId, userMasterKey);
      const result = change(state);
      await this.write(userId, userMasterKey, state);
      return result;
    });
    this.queues.set(userId, next);
    void next.finally(() => {
      if (this.queues.get(userId) === next) this.queues.delete(userId);
    }).catch(() => undefined);
    return next;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  async ksefSettings(userId: string, userMasterKey: Buffer): Promise<KsefSettingsView> {
    return ksefView((await this.read(userId, userMasterKey)).ksef);
  }

  setKsefToken(userId: string, userMasterKey: Buffer, token: unknown, contextNip: unknown): Promise<KsefSettingsView> {
    const cleaned = typeof token === "string" ? token.trim() : "";
    if (!cleaned) throw new InvoiceError("KSEF_TOKEN_REQUIRED", 400);
    if (cleaned.length > 2048 || /\s/.test(cleaned)) throw new InvoiceError("KSEF_TOKEN_INVALID", 400);
    const nip = normalizeNip(contextNip);
    if (nip !== undefined && !NIP.test(nip)) throw new InvoiceError("KSEF_CONTEXT_NIP_INVALID", 400);
    return this.mutate(userId, userMasterKey, (state) => {
      state.ksef = {
        ...state.ksef,
        token: cleaned,
        tokenSetAt: this.stamp(),
        ...(nip ? { contextNip: nip } : {})
      };
      return ksefView(state.ksef);
    });
  }

  clearKsefToken(userId: string, userMasterKey: Buffer): Promise<KsefSettingsView> {
    return this.mutate(userId, userMasterKey, (state) => {
      state.ksef = { environment: state.ksef.environment, ...(state.ksef.contextNip ? { contextNip: state.ksef.contextNip } : {}) };
      return ksefView(state.ksef);
    });
  }

  // Produkcja tylko po jawnym potwierdzeniu; powrót na test bez potwierdzenia.
  setKsefEnvironment(
    userId: string,
    userMasterKey: Buffer,
    environment: unknown,
    confirmProduction: unknown
  ): Promise<KsefSettingsView> {
    if (environment !== "test" && environment !== "production") {
      throw new InvoiceError("KSEF_ENVIRONMENT_INVALID", 400);
    }
    if (environment === "production" && confirmProduction !== true) {
      throw new InvoiceError("KSEF_PRODUCTION_CONFIRMATION_REQUIRED", 400);
    }
    return this.mutate(userId, userMasterKey, (state) => {
      state.ksef = { ...state.ksef, environment };
      return ksefView(state.ksef);
    });
  }

  // Dla przyszłej wysyłki do KSeF: token tylko po stronie runtime.
  async ksefCredentials(userId: string, userMasterKey: Buffer): Promise<StoredKsef> {
    return { ...(await this.read(userId, userMasterKey)).ksef };
  }

  async profile(userId: string, userMasterKey: Buffer): Promise<{ seller?: InvoiceParty; logo?: InvoiceLogo; numbering?: NumberingSettings }> {
    const state = await this.read(userId, userMasterKey);
    return {
      ...(state.seller ? { seller: state.seller } : {}),
      ...(state.logo ? { logo: state.logo } : {}),
      ...(state.numbering ? { numbering: state.numbering } : {})
    };
  }

  setNumbering(userId: string, userMasterKey: Buffer, input: unknown): Promise<NumberingSettings | null> {
    const cleaned = input === null ? null : numberingOrThrow(input);
    return this.mutate(userId, userMasterKey, (state) => {
      if (cleaned) state.numbering = cleaned;
      else delete state.numbering;
      return cleaned;
    });
  }

  // Podgląd numeru, który dostanie nowa faktura z tą datą (bez rezerwacji).
  async previewNumber(userId: string, userMasterKey: Buffer, issueDate: string): Promise<string | null> {
    const state = await this.read(userId, userMasterKey);
    return state.numbering ? autoNumber(state, issueDate) : null;
  }

  setSeller(userId: string, userMasterKey: Buffer, seller: unknown): Promise<InvoiceParty> {
    const cleaned = party(seller, "seller");
    return this.mutate(userId, userMasterKey, (state) => {
      state.seller = cleaned;
      return cleaned;
    });
  }

  setLogo(userId: string, userMasterKey: Buffer, input: { mediaType?: unknown; base64?: unknown; fileName?: unknown }): Promise<InvoiceLogo> {
    const logo = decodeLogo(input);
    return this.mutate(userId, userMasterKey, (state) => {
      state.logo = logo;
      return logo;
    });
  }

  clearLogo(userId: string, userMasterKey: Buffer): Promise<void> {
    return this.mutate(userId, userMasterKey, (state) => {
      delete state.logo;
    });
  }

  async list(userId: string, userMasterKey: Buffer, query = "", sort: InvoiceSort = "date-desc"): Promise<InvoiceRecord[]> {
    return searchInvoices((await this.read(userId, userMasterKey)).invoices, query, sort);
  }

  async get(userId: string, userMasterKey: Buffer, invoiceId: string): Promise<InvoiceRecord> {
    const found = (await this.read(userId, userMasterKey)).invoices.find((entry) => entry.invoiceId === invoiceId);
    if (!found) throw new InvoiceError("INVOICE_NOT_FOUND", 404);
    return found;
  }

  create(userId: string, userMasterKey: Buffer, input: unknown): Promise<InvoiceRecord> {
    const cleaned = validateInvoiceInput(input, { allowAutoNumber: true });
    return this.mutate(userId, userMasterKey, (state) => {
      if (!cleaned.number) {
        if (!state.numbering) throw new InvoiceError("INVOICE_FIELD_REQUIRED:number", 400);
        cleaned.number = autoNumber(state, cleaned.issueDate);
      }
      assertNumberFree(state.invoices, cleaned.number);
      const now = this.stamp();
      const record: InvoiceRecord = {
        ...cleaned,
        invoiceId: `inv_${randomBytes(16).toString("hex")}`,
        status: "DRAFT",
        createdAt: now,
        updatedAt: now
      };
      state.invoices.push(record);
      return record;
    });
  }

  update(userId: string, userMasterKey: Buffer, invoiceId: string, input: unknown): Promise<InvoiceRecord> {
    const cleaned = validateInvoiceInput(input);
    return this.mutate(userId, userMasterKey, (state) => {
      const index = draftIndex(state.invoices, invoiceId);
      assertNumberFree(state.invoices, cleaned.number, invoiceId);
      const current = state.invoices[index]!;
      const record: InvoiceRecord = {
        ...cleaned,
        invoiceId,
        status: "DRAFT",
        ...(current.basedOnInvoiceId ? { basedOnInvoiceId: current.basedOnInvoiceId } : {}),
        createdAt: current.createdAt,
        updatedAt: this.stamp()
      };
      state.invoices[index] = record;
      return record;
    });
  }

  remove(userId: string, userMasterKey: Buffer, invoiceId: string): Promise<void> {
    return this.mutate(userId, userMasterKey, (state) => {
      state.invoices.splice(draftIndex(state.invoices, invoiceId), 1);
    });
  }

  // Szkic → wystawiona. Wystawionej faktury nie da się już edytować ani usunąć.
  issue(userId: string, userMasterKey: Buffer, invoiceId: string): Promise<InvoiceRecord> {
    return this.mutate(userId, userMasterKey, (state) => {
      const index = draftIndex(state.invoices, invoiceId);
      // Pola formularza są sprawdzane przy każdym zapisie szkicu; tu warunki całej faktury.
      assertIssuable(state.invoices[index]!);
      const record: InvoiceRecord = { ...state.invoices[index]!, status: "ISSUED", updatedAt: this.stamp() };
      state.invoices[index] = record;
      return record;
    });
  }

  // Nowy szkic na podstawie istniejącej faktury: strony, pozycje, waluta i
  // płatność z wzoru; numer i daty nowe.
  duplicate(userId: string, userMasterKey: Buffer, invoiceId: string): Promise<InvoiceRecord> {
    return this.mutate(userId, userMasterKey, (state) => {
      const source = state.invoices.find((entry) => entry.invoiceId === invoiceId);
      if (!source) throw new InvoiceError("INVOICE_NOT_FOUND", 404);
      const now = this.stamp();
      const today = now.slice(0, 10);
      const record: InvoiceRecord = {
        number: state.numbering ? autoNumber(state, today) : nextNumber(state.invoices, source.number),
        issueDate: today,
        saleDate: today,
        ...(source.placeOfIssue ? { placeOfIssue: source.placeOfIssue } : {}),
        seller: state.seller ?? source.seller,
        buyer: { ...source.buyer },
        lines: source.lines.map((entry) => ({ ...entry })),
        currency: source.currency,
        ...(source.paymentMethod ? { paymentMethod: source.paymentMethod } : {}),
        ...(source.bankAccount ? { bankAccount: source.bankAccount } : {}),
        ...(source.notes ? { notes: source.notes } : {}),
        ...(source.annotations ? { annotations: { ...source.annotations } } : {}),
        invoiceId: `inv_${randomBytes(16).toString("hex")}`,
        status: "DRAFT",
        basedOnInvoiceId: source.invoiceId,
        createdAt: now,
        updatedAt: now
      };
      state.invoices.push(record);
      return record;
    });
  }
}

function ksefView(ksef: StoredKsef): KsefSettingsView {
  return {
    environment: ksef.environment,
    tokenConfigured: Boolean(ksef.token),
    ...(ksef.token ? { tokenHint: tokenHint(ksef.token) } : {}),
    ...(ksef.tokenSetAt ? { tokenSetAt: ksef.tokenSetAt } : {}),
    ...(ksef.contextNip ? { contextNip: ksef.contextNip } : {})
  };
}

function numberingOrThrow(input: unknown): NumberingSettings {
  try {
    return validateNumbering(input);
  } catch (error) {
    if (error instanceof NumberingError) throw new InvoiceError(error.code, 400);
    throw error;
  }
}

function autoNumber(state: StoredInvoices, issueDate: string): string {
  if (!state.numbering) throw new InvoiceError("NUMBERING_NOT_CONFIGURED", 400);
  return nextAutoNumber(state.invoices.map((entry) => entry.number), state.numbering, issueDate);
}

// Warunki dotyczące całej faktury, sprawdzane przy wystawieniu.
export function assertIssuable(invoice: InvoiceRecord): void {
  if (
    invoice.lines.some((entry) => entry.vatRate === "zw") &&
    !invoice.annotations?.exemptionBasis
  ) {
    throw new InvoiceError("INVOICE_FIELD_REQUIRED:annotations.exemptionBasis", 400);
  }
}

function sameNumber(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("pl") === right.trim().toLocaleLowerCase("pl");
}

function assertNumberFree(invoices: InvoiceRecord[], number: string, exceptId?: string): void {
  if (invoices.some((entry) => entry.invoiceId !== exceptId && sameNumber(entry.number, number))) {
    throw new InvoiceError("INVOICE_NUMBER_TAKEN", 409);
  }
}

function draftIndex(invoices: InvoiceRecord[], invoiceId: string): number {
  const index = invoices.findIndex((entry) => entry.invoiceId === invoiceId);
  if (index < 0) throw new InvoiceError("INVOICE_NOT_FOUND", 404);
  if (invoices[index]!.status !== "DRAFT") throw new InvoiceError("INVOICE_ALREADY_ISSUED", 409);
  return index;
}

// Zwiększa pierwszą liczbę w numerze („FV 7/2026” → „FV 8/2026”), aż numer będzie wolny.
export function nextNumber(invoices: InvoiceRecord[], template: string): string {
  const match = /\d+/.exec(template);
  if (!match) {
    let suffix = 2;
    while (invoices.some((entry) => sameNumber(entry.number, `${template}-${suffix}`))) suffix += 1;
    return `${template}-${suffix}`;
  }
  let value = Number(match[0]);
  let candidate: string;
  do {
    value += 1;
    const digits = String(value).padStart(match[0].length, "0");
    candidate = template.slice(0, match.index) + digits + template.slice(match.index + match[0].length);
  } while (invoices.some((entry) => sameNumber(entry.number, candidate)));
  return candidate;
}
