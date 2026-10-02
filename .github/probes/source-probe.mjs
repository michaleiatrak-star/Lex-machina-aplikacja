// Jednorazowa sonda: python-build-standalone dla macOS arm64 (CPython 3.13.x).
const headers = { Accept: "application/vnd.github+json", "User-Agent": "lex-probe", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
const releases = await (await fetch("https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=20", { headers })).json();
for (const release of releases) {
  for (const asset of release.assets) {
    if (/^cpython-3\.13\.\d+\+\d+-aarch64-apple-darwin-install_only\.tar\.gz$/.test(asset.name)) {
      console.log(JSON.stringify({ tag: release.tag_name, name: asset.name, digest: asset.digest, url: asset.browser_download_url, size: asset.size }));
    }
  }
}
