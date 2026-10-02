// Jednorazowa sonda: python-build-standalone dla macOS arm64 (CPython 3.13.x).
const headers = { Accept: "application/vnd.github+json", "User-Agent": "lex-probe" };
const api = await fetch("https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=5", { headers });
console.log("api", api.status, (await api.text()).slice(0, 300));
const latest = await fetch("https://raw.githubusercontent.com/astral-sh/python-build-standalone/latest-release/latest-release.json");
const latestText = await latest.text();
console.log("latest", latest.status, latestText.slice(0, 400));
let tag = null;
try { tag = JSON.parse(latestText).tag; } catch {}
for (const candidate of [tag, "20260214", "20260127", "20251217"].filter(Boolean)) {
  const sums = await fetch(`https://github.com/astral-sh/python-build-standalone/releases/download/${candidate}/SHA256SUMS`);
  const text = sums.ok ? await sums.text() : "";
  const lines = text.split("\n").filter((line) => /cpython-3\.13\.\d+\+\d+-aarch64-apple-darwin-install_only\.tar\.gz$/.test(line));
  console.log("tag", candidate, sums.status, lines.join(" | "));
  if (lines.length) break;
}
