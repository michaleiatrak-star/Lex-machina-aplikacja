#!/usr/bin/env python3
# One-off: turned the colour literals of src/*.css into role tokens and generated src/theme.css.
# New colours: use an existing token or add one to every block of theme.css (src/theme.test.ts checks).
# Usage: python3 scripts/theme-tokens.py src
# Tokenizes color literals of the lex-web CSS into role-aware variables and generates themes.
import re, glob, math, collections, sys, os
os.chdir(sys.argv[1])
files = sorted(f for f in glob.glob("*.css") if f != "theme.css")
PAT = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)')

def parse(c):
    c = c.lower()
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4): h = ''.join(x * 2 for x in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), (int(h[6:8], 16) / 255) if len(h) == 8 else 1.0)
    n = [x for x in re.split(r'[\s,/]+', c[c.index('(') + 1:-1]) if x]
    if len(n) < 3 or any(not re.match(r'^[\d.]+%?$', x) for x in n): return None
    r, g, b = [float(x) for x in n[:3]]
    a = (float(n[3].rstrip('%')) / (100 if n[3].endswith('%') else 1)) if len(n) > 3 else 1.0
    return (round(r), round(g), round(b), a)

def lin(u):
    u /= 255
    return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
def delin(u):
    u = max(0.0, min(1.0, u))
    return 255 * (12.92 * u if u <= 0.0031308 else 1.055 * u ** (1 / 2.4) - 0.055)
def to_oklab(rgb):
    r, g, b = (lin(x) for x in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = (math.copysign(abs(x) ** (1 / 3), x) for x in (l, m, s))
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
def from_oklab(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return tuple(round(delin(v)) for v in (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                                           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                                           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))
def lch(rgb):
    L, a, b = to_oklab(rgb)
    return L, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360
def from_lch(L, C, H):
    L = max(0.0, min(1.0, L))
    # Reduce chroma until the color fits in sRGB.
    for _ in range(30):
        a, b = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
        l = L + 0.3963377774 * a + 0.2158037573 * b
        m = L - 0.1055613458 * a - 0.0638541728 * b
        s = L - 0.0894841775 * a - 1.2914855480 * b
        rgb = (4.0767416621 * l**3 - 3.3077115913 * m**3 + 0.2309699292 * s**3,
               -1.2684380046 * l**3 + 2.6097574011 * m**3 - 0.3413193965 * s**3,
               -0.0041960863 * l**3 - 0.7034186147 * m**3 + 1.7076147010 * s**3)
        if all(-0.001 <= v <= 1.001 for v in rgb): break
        C *= 0.9
    return from_oklab(L, C * math.cos(math.radians(H)), C * math.sin(math.radians(H)))

TEXT_PROPS = {"color", "fill", "stroke", "caret-color", "text-decoration-color", "-webkit-text-fill-color", "accent-color"}
def role(prop, alpha=1.0):
    if prop in TEXT_PROPS: return "t"
    # Translucent veils and shadows tint what is under them: they keep their colour.
    if alpha < 0.5: return "o"
    if prop.startswith("border") or prop.startswith("outline") or prop in ("column-rule", "text-decoration"): return "l"
    return "s"

# Pass 1: collect.
uses = collections.Counter()
for f in files:
    for line in open(f):
        m = re.match(r'\s*([\w-]+)\s*:', line)
        prop = m.group(1).lower() if m else "background"
        for c in PAT.findall(line):
            v = parse(c)
            if v: uses[(role(prop, v[3]), v[:3])] += 1

# Cluster per role in OKLab (threshold: barely perceptible).
clusters = {}  # (role, rgb) -> token
tokens = {}    # token -> (role, rgb)
for r in "tslo":
    members = sorted([k[1] for k in uses if k[0] == r], key=lambda x: -uses[(r, x)])
    reps = []
    for rgb in members:
        lab = to_oklab(rgb)
        for rep, rlab, name in reps:
            if math.dist(lab, rlab) < 0.012:
                clusters[(r, rgb)] = name
                break
        else:
            name = f"--lm-{r}{len(reps) + 1}"
            reps.append((rgb, lab, name))
            clusters[(r, rgb)] = name
            tokens[name] = (r, rgb)

# Pass 2: rewrite.
def rewrite(line):
    m = re.match(r'\s*([\w-]+)\s*:', line)
    prop = m.group(1).lower() if m else "background"
    def sub(mo):
        v = parse(mo.group(0))
        if not v: return mo.group(0)
        name = clusters[(role(prop, v[3]), v[:3])]
        if v[3] >= 0.999: return f"var({name})"
        return f"rgb(var({name}-rgb) / {round(v[3], 3):g})"
    if line.lstrip().startswith(("/*", "*")): return line
    return PAT.sub(sub, line)
for f in files:
    src = open(f).read().split("\n")
    open(f, "w").write("\n".join(rewrite(l) for l in src))

# Themes.
def night(r, rgb):
    L, C, H = lch(rgb)
    if r == "o": return rgb
    if r == "s": L, C = ((0.17 + (1 - L) * 0.85, C * 0.7) if L > 0.5 else (L * 0.92, C))
    elif r == "t": L, C = ((max(0.9 - L * 0.45, 0.7), C * 0.85) if L < 0.6 else (L, C))
    else: L, C = ((0.32 + (1 - L) * 0.6, C * 0.7) if L > 0.5 else (max(L, 0.4), C))
    return from_lch(L, C, H)
DEMO_BLUE = lch((8, 105, 218))
def neutral(r, rgb):
    L, C, H = lch(rgb)
    if 80 <= H <= 210:
        if C >= 0.06 and r != "s": return from_lch(min(L, DEMO_BLUE[0]) if L < 0.6 else L, min(C * 1.5, DEMO_BLUE[1]), DEMO_BLUE[2])
        return from_lch(L, C * 0.55, 262)
    return rgb
def contrast(r, rgb):
    L, C, H = lch(rgb)
    # A tinted light surface marks a selection or a notice: grey, so it stays visible.
    if r == "s": L = (0.86 if C >= 0.015 and L <= 0.97 else 1.0) if L > 0.62 else (0.0 if L < 0.42 else 0.86)
    elif r == "t": L = 0.0 if L < 0.62 else 1.0
    elif r == "l": L = 0.0 if L < 0.6 else 0.25
    else: L = 1.0 if L > 0.5 else 0.0
    return from_lch(L, 0, 0)

def block(selector, fn, extra=""):
    out = [f"{selector} {{"] + ([f"  {extra}"] if extra else [])
    for name, (r, rgb) in sorted(tokens.items(), key=lambda kv: ("tslo".index(kv[0][5]), int(kv[0][6:]))):
        c = fn(r, rgb)
        out.append(f"  {name}: #{c[0]:02x}{c[1]:02x}{c[2]:02x};")
        out.append(f"  {name}-rgb: {c[0]} {c[1]} {c[2]};")
    return "\n".join(out + ["}"])
ident = lambda r, rgb: rgb
theme = [
    "/* Generated by the colour tokenizer: every colour of the interface is a role token",
    "   (t = text, s = surface, l = line, o = translucent veil or shadow). Themes recompute the tokens in OKLCH by role:",
    "   night keeps dark surfaces dark and turns light ones dark, text light; neutral moves",
    "   the green tints to blue-grey (UI demo); contrast is black and white. */",
    block(":root", ident),
    block(':root[data-theme="night"]', night, "color-scheme: dark;"),
    block(':root[data-theme="neutral"]', neutral),
    block(':root[data-theme="contrast"]', contrast),
    "@media (prefers-color-scheme: dark) {",
    block('  :root[data-theme="system"]', night, "color-scheme: dark;").replace("\n", "\n  "),
    "}",
]
open("theme.css", "w").write("\n\n".join(theme) + "\n")
print("tokens", len(tokens), {r: sum(1 for t in tokens.values() if t[0] == r) for r in "tslo"})
