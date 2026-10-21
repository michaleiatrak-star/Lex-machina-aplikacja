import fs from "node:fs";

/** Fails the run up front when Node is older than package.json "engines" requires. */
export default function nodeVersion(): void {
  const wanted = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { engines?: { node?: string } }).engines?.node ?? "";
  const minimum = /(\d+)\.(\d+)\.(\d+)/.exec(wanted);
  if (!minimum) return;
  const have = process.versions.node.split(".").map(Number);
  const need = minimum.slice(1).map(Number);
  const older = have[0]! !== need[0]! ? have[0]! < need[0]! : have[1]! !== need[1]! ? have[1]! < need[1]! : have[2]! < need[2]!;
  if (older) {
    throw new Error(
      `lex-runtime: testy wymagają Node ${wanted} (crypto.argon2), uruchomiono Node ${process.versions.node}. ` +
        "Zainstaluj Node 24.7+; na starszej wersji błędy Argon2 nie są regresją."
    );
  }
}
