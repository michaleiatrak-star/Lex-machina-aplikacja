#!/usr/bin/env python3
"""Każda trasa HTTP runtime (app/lex-runtime/src/http/*.ts) a allowlista proxy desktopu
(route_allowed w src-tauri/src/trust_boundary.rs). Kompiluje route_allowed z rustc i
wypisuje trasy, których proxy nie przepuszcza. Kod wyjścia 1 = trasa spoza listy
INTENTIONALLY_BLOCKED.

Uruchom z katalogu repozytorium: python3 app/lex-desktop/scripts/check-route-allowlist.py
"""
import glob
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RUNTIME_HTTP = os.path.join(ROOT, "app", "lex-runtime", "src", "http")
TRUST = os.path.join(ROOT, "app", "lex-desktop", "src-tauri", "src", "trust_boundary.rs")

# Obsługiwane przez desktop wewnętrznie, nie z okna aplikacji.
INTENTIONALLY_BLOCKED = {("POST", "/api/auth/bootstrap-managed")}
SAMPLE = {
    ":server": "nbp",
    ":executionId": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
}


def rust_function(source: str, name: str) -> str:
    start = source.rfind("\n", 0, source.index(f"fn {name}(")) + 1
    depth, index = 0, source.index("{", start)
    while True:
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
        index += 1


def main() -> int:
    routes = set()
    for path in glob.glob(os.path.join(RUNTIME_HTTP, "*.ts")):
        text = open(path, encoding="utf8").read()
        for match in re.finditer(r'\b(?:app|coreApp|router)\.(get|post|put|patch|delete)\(\s*"([^"]+)"', text):
            routes.add((match.group(1).upper(), match.group(2)))
    trust = open(TRUST, encoding="utf8").read()
    helpers = [name for name in re.findall(r"^fn (\w+)\(", trust, re.M)
               if name in {"route_allowed", "is_mcp_route", "is_execution_progress_route"}]
    rows = []
    for method, route in sorted(routes):
        sample = route
        for key, value in SAMPLE.items():
            sample = sample.replace(key, value)
        sample = re.sub(r":\w+", "abc123", sample)
        rows.append(f'("{method}", "{sample}", "{route}"),')
    program = "\n".join(rust_function(trust, name) for name in helpers) + (
        "\nfn main() {\n    for (m, q, p) in [\n" + "\n".join(rows) +
        "\n    ] {\n        if !route_allowed(m, q) { println!(\"{} {}\", m, p); }\n    }\n}\n"
    )
    with tempfile.TemporaryDirectory() as work:
        source = os.path.join(work, "check.rs")
        binary = os.path.join(work, "check.exe" if os.name == "nt" else "check")
        open(source, "w", encoding="utf8").write(program)
        subprocess.run(["rustc", "--edition", "2021", "-A", "warnings", source, "-o", binary], check=True)
        blocked = subprocess.run([binary], check=True, capture_output=True, text=True).stdout.split("\n")
    unexpected = [line for line in blocked if line and tuple(line.split(" ", 1)) not in INTENTIONALLY_BLOCKED]
    print(f"Trasy runtime: {len(routes)}; zablokowane celowo: {len(INTENTIONALLY_BLOCKED)}; bez dostępu: {len(unexpected)}")
    for line in unexpected:
        print("  BRAK W ALLOWLIŚCIE:", line)
    return 1 if unexpected else 0


if __name__ == "__main__":
    sys.exit(main())
