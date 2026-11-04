#!/usr/bin/env python3
"""Wokanda register of the common courts: which court publishes its wokanda and how.

For every court of the court base (app/lex-runtime/src/courts/court-base-data.ts) one request to
its /wokanda page (and to its home page when there is none), with the application's own
User-Agent; nothing is bypassed. Each court gets one status:

  PORTAL      the Ministry's court portal: search by signature (index.php?p=cases), readable by
              the application on the user's request;
  BROWSER     a wokanda exists but only for a browser: verification of the browser (JavaScript),
              reCAPTCHA, or another system; the application gives its address;
  NONE        the court's site names no wokanda;
  UNREACHABLE the site did not answer (network, error).

The result is generated as TypeScript (--out). The application checks again from the user's
computer (Ustawienia, tryb dewelopera): a site that blocks one network may answer another.

  python3 app/courts/probe_wokanda.py --out app/lex-runtime/src/courts/wokanda-registry-data.ts
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import re
import ssl
import urllib.error
import urllib.request
from pathlib import Path

UA = "LexMachina-wokanda-register/1.0 (+https://github.com/michaleiatrak-star/Lex-machina-aplikacja)"
BASE = Path(__file__).resolve().parents[1] / "lex-runtime" / "src" / "courts" / "court-base-data.ts"
VERIFICATION = re.compile(r"weryfikacja przeglądarki|g-recaptcha|recaptcha_response|mosparo|cf-challenge", re.I)
WOKANDA_LINK = re.compile(r'href="([^"]*(?:e-wokanda|ewokanda|wokanda)[^"]*)"', re.I)


def courts() -> list[dict]:
    text = BASE.read_text(encoding="utf-8")
    data = json.loads(text[text.index("= {") + 2 : text.rindex("}") + 1])
    out = []
    for level in ("sa", "so", "sr"):
        for court in data[level]:
            email = (court.get("adres") or {}).get("email", "")
            match = re.search(r"@([\w.-]+)", email)
            out.append({"nazwa": court["nazwa"], "domena": match.group(1).lower() if match else ""})
    return out


def context() -> ssl.SSLContext:
    bundle = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
    return ssl.create_default_context(cafile=bundle) if bundle else ssl.create_default_context()


CTX = context()


def get(url: str) -> tuple[int, str, str]:
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=25, context=CTX)
        return response.status, response.geturl(), response.read(800_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        body = error.read(20_000).decode("utf-8", "replace") if error.fp else ""
        return error.code, url, body
    except Exception as error:  # noqa: BLE001
        return 0, url, f"{type(error).__name__}"


def absolute(base: str, href: str) -> str:
    if href.startswith("http"):
        return href
    root = re.match(r"https?://[^/]+", base).group(0)
    return root + (href if href.startswith("/") else "/" + href)


def probe(court: dict) -> dict:
    domain = court["domena"]
    result = {"nazwa": court["nazwa"], "domena": domain}
    if not domain:
        return {**result, "status": "UNREACHABLE", "powod": "brak domeny w danych MS"}
    last = ""
    for base in (f"https://{domain}", f"https://www.{domain}"):
        status, url, body = get(base + "/wokanda")
        if status == 200 and 'name="nrspr"' in body and 'value="cases"' in body:
            return {**result, "status": "PORTAL", "url": url}
        if VERIFICATION.search(body):
            return {**result, "status": "BROWSER", "url": url, "powod": "weryfikacja przeglądarki"}
        home_status, home_url, home = get(base + "/")
        if VERIFICATION.search(home):
            return {**result, "status": "BROWSER", "url": home_url, "powod": "weryfikacja przeglądarki"}
        if home_status == 200:
            links = [absolute(home_url, href) for href in WOKANDA_LINK.findall(home) if "nawokandzie" not in href and "kwartalnik" not in href]
            if status == 200 and "okand" in body:
                links.insert(0, url)
            if links:
                return {**result, "status": "BROWSER", "url": links[0], "powod": "inny system wokandy"}
            return {**result, "status": "NONE", "url": home_url}
        last = f"HTTP {home_status or status}" if (home_status or status) else body or "brak odpowiedzi"
    return {**result, "status": "UNREACHABLE", "powod": last}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(16) as pool:
        register = list(pool.map(probe, courts()))
    checked = datetime.date.today().isoformat()
    payload = json.dumps({"sprawdzono": checked, "sady": register}, ensure_ascii=False, separators=(",", ":"))
    Path(args.out).write_text(
        "// Generated by app/courts/probe_wokanda.py (one request per court, the application's own\n"
        "// User-Agent). Do not edit; the application re-checks from the user's computer.\n"
        'import type { WokandaRegister } from "./wokanda.js";\n\n'
        f"export const WOKANDA_REGISTER: WokandaRegister = {payload};\n",
        encoding="utf-8",
    )
    counts: dict[str, int] = {}
    for item in register:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    print(checked, counts)


if __name__ == "__main__":
    main()
