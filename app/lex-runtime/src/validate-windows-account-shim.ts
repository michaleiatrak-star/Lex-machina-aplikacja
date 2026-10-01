import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  npmCliScript,
  spawnResolved
} from "./providers/account-session.js";

/**
 * Windows only: account clients (npm.cmd, gemini.cmd, grok.cmd) are .cmd shims
 * started through cmd.exe, from a path with a space ("Lex Machina"). Checks
 * the exact spawn path used by the runtime, and a real npm install.
 */

function run(executable: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnResolved(executable, args, undefined, process.env);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function check(condition: boolean, message: string, detail = ""): void {
  if (!condition) {
    process.stderr.write(`WINDOWS_ACCOUNT_SHIM_FAILED:${message}\n${detail}\n`);
    process.exit(1);
  }
  process.stdout.write(`PASS ${message}\n`);
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    process.stdout.write("SKIP: Windows only\n");
    return;
  }
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-shim-")), "Lex Machina");
  fs.mkdirSync(root, { recursive: true });

  const probe = path.join(root, "probe.cmd");
  fs.writeFileSync(probe, "@echo off\r\necho ARG1=[%~1]\r\necho ARG2=[%~2]\r\necho ARG3=[%~3]\r\n");
  const echoed = await run(probe, ["-p", "", "C:\\Lex Machina\\x & y"]);
  check(
    echoed.code === 0 &&
      echoed.stdout.includes("ARG1=[-p]") &&
      echoed.stdout.includes("ARG2=[]") &&
      echoed.stdout.includes("ARG3=[C:\\Lex Machina\\x & y]"),
    ".cmd w katalogu ze spacją, argumenty puste i ze spacjami",
    echoed.stdout + echoed.stderr
  );

  // Copy of the Node directory under "Lex Machina", like the installed runtime.
  const systemNpm = execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8" }).split(/\r?\n/)[0]!.trim();
  const nodeDir = path.join(root, "runtime", "node");
  fs.cpSync(path.dirname(systemNpm), nodeDir, { recursive: true });
  const npmCmd = path.join(nodeDir, "npm.cmd");

  const version = await run(npmCmd, ["--version"]);
  check(version.code === 0 && /^\d+\.\d+\.\d+/m.test(version.stdout.trim()), "npm.cmd --version", version.stdout + version.stderr);

  const prefix = path.join(root, "optional-tools", "account-clients", "probe");
  const viaCmd = await run(npmCmd, ["install", "--prefix", prefix, "--no-audit", "--no-fund", "is-number@7.0.0"]);
  check(
    viaCmd.code === 0 && fs.existsSync(path.join(prefix, "node_modules", "is-number", "package.json")),
    "npm.cmd install do katalogu ze spacją",
    viaCmd.stdout + viaCmd.stderr
  );

  const cli = npmCliScript(npmCmd);
  check(cli !== null, "npm-cli.js obok npm.cmd");
  const prefix2 = `${prefix}-node`;
  const viaNode = await run(process.execPath, [cli!, "install", "--prefix", prefix2, "--no-audit", "--no-fund", "is-number@7.0.0"]);
  check(
    viaNode.code === 0 && fs.existsSync(path.join(prefix2, "node_modules", "is-number", "package.json")),
    "node npm-cli.js install do katalogu ze spacją",
    viaNode.stdout + viaNode.stderr
  );
}

void main().catch((error) => {
  process.stderr.write(`WINDOWS_ACCOUNT_SHIM_FAILED:${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
