import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { SmtpError, SmtpMailTransport } from "../src/server-mode/smtp.js";

type Session = { commands: string[]; data: string; tls: boolean };

const closers: Array<() => void> = [];
const roots: string[] = [];

afterEach(() => {
  while (closers.length) closers.pop()!();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function selfSignedCertificate(): { key: string; cert: string } | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-smtp-cert-"));
  roots.push(dir);
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")
    ], { stdio: "ignore" });
    return { key: fs.readFileSync(path.join(dir, "key.pem"), "utf8"), cert: fs.readFileSync(path.join(dir, "cert.pem"), "utf8") };
  } catch {
    return null;
  }
}

/** A fake SMTP relay: EHLO, optional STARTTLS, AUTH PLAIN/LOGIN, one message. */
async function fakeSmtp(options: { auth: "PLAIN" | "LOGIN"; credentials?: { key: string; cert: string }; user: string; password: string }) {
  const sessions: Session[] = [];
  const server = net.createServer((plain) => {
    const session: Session = { commands: [], data: "", tls: false };
    sessions.push(session);
    let socket: net.Socket = plain;
    let buffer = "";
    let inData = false;
    let loginStep: "user" | "password" | null = null;
    let loginUser = "";
    const reply = (line: string) => socket.write(line + "\r\n");
    const onLine = (line: string) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          reply("250 OK queued");
        } else {
          session.data += line + "\n";
        }
        return;
      }
      session.commands.push(line);
      if (loginStep === "user") {
        loginUser = Buffer.from(line, "base64").toString("utf8");
        loginStep = "password";
        reply("334 UGFzc3dvcmQ6");
        return;
      }
      if (loginStep === "password") {
        loginStep = null;
        const ok = loginUser === options.user && Buffer.from(line, "base64").toString("utf8") === options.password;
        reply(ok ? "235 Authenticated" : "535 Bad credentials");
        return;
      }
      const verb = line.split(" ")[0]!.toUpperCase();
      if (verb === "EHLO") {
        const lines = ["250-fake.local", ...(options.credentials && !session.tls ? ["250-STARTTLS"] : []), `250-AUTH ${options.auth}`, "250 8BITMIME"];
        for (const item of lines) reply(item);
      } else if (verb === "STARTTLS") {
        reply("220 Go ahead");
        socket.removeAllListeners("data");
        const secured = new tls.TLSSocket(plain, { isServer: true, key: options.credentials!.key, cert: options.credentials!.cert });
        session.tls = true;
        socket = secured;
        buffer = "";
        secured.on("data", onData);
      } else if (verb === "AUTH") {
        const [, mechanism, initial] = line.split(" ");
        if (mechanism === "PLAIN") {
          const [, user, password] = Buffer.from(initial ?? "", "base64").toString("utf8").split("\0");
          reply(user === options.user && password === options.password ? "235 Authenticated" : "535 Bad credentials");
        } else {
          loginStep = "user";
          reply("334 VXNlcm5hbWU6");
        }
      } else if (verb === "MAIL" || verb === "RCPT") {
        reply("250 OK");
      } else if (verb === "DATA") {
        inData = true;
        reply("354 End data with <CR><LF>.<CR><LF>");
      } else if (verb === "QUIT") {
        reply("221 Bye");
        socket.end();
      } else {
        reply("502 Not implemented");
      }
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        onLine(line);
      }
    };
    plain.on("data", onData);
    plain.on("error", () => undefined);
    reply("220 fake.local ESMTP");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return { port: (server.address() as net.AddressInfo).port, sessions };
}

describe("minimal SMTP client", () => {
  it("upgrades with STARTTLS, authenticates with AUTH PLAIN and sends one UTF-8 message", async (context) => {
    const credentials = selfSignedCertificate();
    if (!credentials) context.skip();
    const relay = await fakeSmtp({ auth: "PLAIN", credentials: credentials!, user: "lex", password: "tajne" });
    const transport = new SmtpMailTransport(
      { host: "localhost", port: relay.port, secure: false, user: "lex", password: "tajne", from: "lex@example.pl" },
      { ca: credentials!.cert }
    );
    await transport.send({ to: "klient@example.pl", subject: "Potwierdź adres", text: "Zażółć gęślą jaźń" });
    const session = relay.sessions[0]!;
    expect(session.tls).toBe(true);
    expect(session.commands).toContain("STARTTLS");
    // AUTH only after the upgrade.
    expect(session.commands.indexOf("STARTTLS")).toBeLessThan(session.commands.findIndex((line) => line.startsWith("AUTH")));
    expect(session.commands).toContain("RCPT TO:<klient@example.pl>");
    expect(session.data).toContain("Subject: =?UTF-8?B?");
    const body = session.data.split("\n\n").slice(1).join("").replace(/\s+/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Zażółć gęślą jaźń");
  });

  it("authenticates with AUTH LOGIN to a loopback relay and reports a refused login", async () => {
    const relay = await fakeSmtp({ auth: "LOGIN", user: "lex", password: "tajne" });
    await new SmtpMailTransport({ host: "127.0.0.1", port: relay.port, secure: false, user: "lex", password: "tajne", from: "lex@example.pl" }).send({
      to: "a@example.pl",
      subject: "Test",
      text: "tresc"
    });
    expect(relay.sessions[0]!.commands).toContain("AUTH LOGIN");
    const refused = await new SmtpMailTransport({ host: "127.0.0.1", port: relay.port, secure: false, user: "lex", password: "zle", from: "lex@example.pl" })
      .send({ to: "a@example.pl", subject: "Test", text: "tresc" })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SmtpError);
    expect((refused as SmtpError).code).toBe("SMTP_AUTH_FAILED");
  });

  it("refuses header injection in addresses", async () => {
    const transport = new SmtpMailTransport({ host: "127.0.0.1", port: 1, secure: false, from: "lex@example.pl" });
    await expect(transport.send({ to: "a@example.pl\r\nBcc: x@example.pl", subject: "x", text: "x" })).rejects.toMatchObject({ code: "SMTP_INVALID_ADDRESS" });
  });
});
