import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

/**
 * Minimal SMTP submission client (no dependency): implicit TLS (465) or
 * STARTTLS, AUTH PLAIN/LOGIN, one text/plain UTF-8 message. Credentials are
 * never sent over a plain connection except to a loopback relay.
 */
export type SmtpSettings = {
  host: string;
  port: number;
  // true: TLS from the first byte (465); false: STARTTLS when offered.
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export class SmtpError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "SmtpError";
  }
}

const ADDRESS = /^[^\s<>"\r\n,;]{1,64}@[^\s<>"\r\n,;@]{1,253}$/;

export function validMailAddress(value: string): boolean {
  return ADDRESS.test(value);
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function buildMessage(from: string, message: MailMessage, now = new Date()): string {
  const domain = from.split("@")[1] ?? "localhost";
  const body = Buffer.from(message.text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
}

type Reply = { code: number; lines: string[] };

class SmtpConnection {
  private buffer = "";
  private pending: Array<(reply: Reply | Error) => void> = [];
  private replies: Array<Reply | Error> = [];
  private lines: string[] = [];

  constructor(private socket: net.Socket | tls.TLSSocket, private readonly timeoutMs: number) {
    this.attach(socket);
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.setTimeout(this.timeoutMs);
    socket.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    socket.on("timeout", () => this.fail(new SmtpError("SMTP_TIMEOUT")));
    socket.on("error", (error) => this.fail(new SmtpError("SMTP_CONNECTION_FAILED", error.message)));
    socket.on("close", () => this.fail(new SmtpError("SMTP_CONNECTION_CLOSED")));
  }

  private onData(text: string): void {
    this.buffer += text;
    if (this.buffer.length > 64_000) {
      this.fail(new SmtpError("SMTP_REPLY_TOO_LONG"));
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.lines.map((item) => item.slice(4)) };
        this.lines = [];
        this.deliver(reply);
      }
    }
  }

  private deliver(reply: Reply | Error): void {
    const waiter = this.pending.shift();
    if (waiter) waiter(reply);
    else this.replies.push(reply);
  }

  private fail(error: Error): void {
    this.deliver(error);
    while (this.pending.length) this.pending.shift()!(error);
  }

  read(): Promise<Reply> {
    const ready = this.replies.shift();
    if (ready) return ready instanceof Error ? Promise.reject(ready) : Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      this.pending.push((reply) => (reply instanceof Error ? reject(reply) : resolve(reply)));
    });
  }

  async command(line: string, expected: number[], code: string): Promise<Reply> {
    this.socket.write(line + "\r\n");
    const reply = await this.read();
    if (!expected.includes(reply.code)) throw new SmtpError(code, `${reply.code}`);
    return reply;
  }

  async upgrade(host: string, options: tls.ConnectionOptions): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners("data");
    plain.removeAllListeners("timeout");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    const secured = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect({ ...options, socket: plain, servername: net.isIP(host) ? undefined : host }, () => resolve(socket));
      socket.once("error", reject);
    });
    this.buffer = "";
    this.attach(secured);
  }

  get encrypted(): boolean {
    return this.socket instanceof tls.TLSSocket;
  }

  end(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

export class SmtpMailTransport implements MailTransport {
  constructor(
    private readonly settings: SmtpSettings,
    // Tests: a CA for the fake server's self-signed certificate.
    private readonly tlsOptions: tls.ConnectionOptions = {},
    private readonly timeoutMs = 20_000
  ) {}

  async send(message: MailMessage): Promise<void> {
    const { host, port, secure, user, password, from } = this.settings;
    if (!validMailAddress(from) || !validMailAddress(message.to)) throw new SmtpError("SMTP_INVALID_ADDRESS");
    const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const onError = (error: Error) => reject(new SmtpError("SMTP_CONNECTION_FAILED", error.message));
      const created = secure
        ? tls.connect({ ...this.tlsOptions, host, port, servername: net.isIP(host) ? undefined : host }, () => resolve(created))
        : net.connect({ host, port }, () => resolve(created));
      created.once("error", onError);
      created.setTimeout(this.timeoutMs, () => created.destroy(new Error("timeout")));
    });
    const connection = new SmtpConnection(socket, this.timeoutMs);
    try {
      const greeting = await connection.read();
      if (greeting.code !== 220) throw new SmtpError("SMTP_GREETING_REJECTED");
      const name = "lex-machina.local";
      let ehlo = await connection.command(`EHLO ${name}`, [250], "SMTP_EHLO_REJECTED");
      if (!connection.encrypted && ehlo.lines.some((line) => /^STARTTLS\b/i.test(line))) {
        await connection.command("STARTTLS", [220], "SMTP_STARTTLS_REJECTED");
        await connection.upgrade(host, this.tlsOptions);
        ehlo = await connection.command(`EHLO ${name}`, [250], "SMTP_EHLO_REJECTED");
      }
      if (user) {
        if (!connection.encrypted && !isLoopbackHost(host)) throw new SmtpError("SMTP_TLS_REQUIRED");
        const auth = ehlo.lines.find((line) => /^AUTH\b/i.test(line))?.toUpperCase() ?? "";
        if (/\bPLAIN\b/.test(auth)) {
          const token = Buffer.from(`\0${user}\0${password ?? ""}`, "utf8").toString("base64");
          await connection.command(`AUTH PLAIN ${token}`, [235], "SMTP_AUTH_FAILED");
        } else if (/\bLOGIN\b/.test(auth)) {
          await connection.command("AUTH LOGIN", [334], "SMTP_AUTH_FAILED");
          await connection.command(Buffer.from(user, "utf8").toString("base64"), [334], "SMTP_AUTH_FAILED");
          await connection.command(Buffer.from(password ?? "", "utf8").toString("base64"), [235], "SMTP_AUTH_FAILED");
        } else {
          throw new SmtpError("SMTP_AUTH_UNSUPPORTED");
        }
      }
      await connection.command(`MAIL FROM:<${from}>`, [250], "SMTP_SENDER_REJECTED");
      await connection.command(`RCPT TO:<${message.to}>`, [250, 251], "SMTP_RECIPIENT_REJECTED");
      await connection.command("DATA", [354], "SMTP_DATA_REJECTED");
      const data = buildMessage(from, message).replace(/^\./gm, "..");
      await connection.command(`${data}\r\n.`, [250], "SMTP_MESSAGE_REJECTED");
      await connection.command("QUIT", [221], "SMTP_QUIT_FAILED").catch(() => undefined);
    } finally {
      connection.end();
    }
  }
}
