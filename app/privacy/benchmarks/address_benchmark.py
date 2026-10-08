"""Address anonymization, deanonymization and declension test on TERYT.

    python address_benchmark.py APP_PRIVACY_DIR BASE_DIR [N] [examples.json]

N localities (SIMC) and N street addresses (ULIC), seed 10000. BASE_DIR holds
localities_teryt.tsv (official genitives, the reference for the genitive);
other cases come from SGJP. LEX_TERYT_RAW: directory with SIMC/ and ULIC/
unpacked from the TERYT "pliki pełne" (urzędowy) download.
"""
import os
import collections, csv, json, random, re, sys, time
sys.path.insert(0, sys.argv[1])
import morfeusz2
import polish_pii_gazetteer as gz
try:
    from polish_address_morphology import AddressMorphology
    NEW = True
except ImportError:
    from polish_person_morphology import AddressMorphology
    NEW = False

BASE = sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 5000
RAW = os.environ.get("LEX_TERYT_RAW", "raw")
CASES = ("nom", "gen", "dat", "acc", "inst", "loc", "voc")
M = morfeusz2.Morfeusz()
engine = AddressMorphology(M)
holdout = AddressMorphology(M, use_sgjp=False) if NEW else None
random.seed(10000)

def feats(tag):
    return [set(p.split(".")) for p in tag.split(":")]

def cap(model, value):
    return value[:1].upper() + value[1:] if model[:1].isupper() else value

# --- wzorzec: dopelniacz urzedowy (PRNG) + SGJP --------------------------------
GEN = {}
for line in open(BASE + "/localities_teryt.tsv", encoding="utf-8"):
    f = line.rstrip("\n").split("\t")
    if f[4]:
        GEN[f[1]] = f[4].split("|")[0].rpartition(":")[0]

def sgjp_word_gold(word, gen_word):
    """Formy przypadkow wszystkich lematow SGJP, ktorych dopelniacz to urzedowy."""
    if word.lower() == gen_word.lower():
        return {c: [word] for c in CASES}
    union = {c: set() for c in CASES}
    primary = None
    readings = sorted(M.analyse(word), key=lambda it: ("nazwa_geograficzna" not in it[2][3], ":sg:" not in it[2][2]))
    for _s, _e, (_o, lemma, tag, types, _q) in readings:
        p = feats(tag)
        if not (p[0] & {"subst", "adj"}) or len(p) < 4 or "nom" not in p[2]:
            continue
        pos = next(iter(p[0] & {"subst", "adj"}))
        for number in p[1] & {"sg", "pl"}:
            for gender in p[3]:
                out = {c: set() for c in CASES}
                for orth, _l, t, *_r in M.generate(lemma):
                    q = feats(t)
                    if pos not in q[0] or number not in q[1] or len(q) < 4 or gender not in q[3]:
                        continue
                    if pos == "adj" and "pos" not in q[-1]:
                        continue
                    for c in q[2] & set(CASES):
                        out[c].add(cap(word, orth))
                if gen_word in out["gen"] and word in out["nom"] and all(out.values()):
                    if primary is None:
                        primary = out
                    for c in CASES:
                        union[c] |= out[c]
    if not primary:
        return None
    # Pierwszy (glowny) wariant: z odczytu podstawowego.
    return {c: [sorted(primary[c])[0]] + sorted(union[c] - {sorted(primary[c])[0]}) for c in CASES}

def locality_gold(name):
    gen = GEN.get(name)
    if not gen:
        return None, "bez dopełniacza"
    words = re.split(r"([ \-])", name); gwords = re.split(r"([ \-])", gen)
    if len(words) != len(gwords):
        return {"nom": [name], "gen": [gen]}, "spoza"
    golds = []
    frozen = False
    for w, g in zip(words, gwords):
        if w in (" ", "-"):
            golds.append({c: [w] for c in CASES}); continue
        if frozen or w.lower() in ("nad", "pod", "przy", "za", "na", "k.", "koło"):
            frozen = True; golds.append({c: [w] for c in CASES}); continue
        gd = sgjp_word_gold(w, g)
        if not gd:
            return {"nom": [name], "gen": [gen]}, "spoza"
        golds.append(gd)
    out = {}
    for c in CASES:
        combos = [""]
        for item in golds:
            combos = [a + b for a in combos for b in item[c]]
        out[c] = combos[:50]  # pierwszy: forma glowna
    out["gen"] = [gen] + [x for x in out["gen"] if x != gen]
    return out, "SGJP"

# --- probka -----------------------------------------------------------------
simc = list(csv.DictReader(open(RAW + "/SIMC/SIMC_Urzedowy_2026-10-08.csv", encoding="utf-8-sig"), delimiter=";"))
by_sym = {r["SYM"]: r["NAZWA"] for r in simc}
ulic = [r for r in csv.DictReader(open(RAW + "/ULIC/ULIC_Urzedowy_2026-10-08.csv", encoding="utf-8-sig"), delimiter=";")
        if r["CECHA"] in ("ul.", "al.", "pl.", "os.", "rondo", "skwer")
        and not re.match(r"(?i)(ulica|aleja|aleje|plac|osiedle|rondo|skwer)\b", r["NAZWA_2"] or r["NAZWA_1"])]
MARKERS = {"ul.": ("ulica", "f"), "al.": ("aleja", "f"), "pl.": ("plac", "m3"), "os.": ("osiedle", "n"),
           "rondo": ("rondo", "n"), "skwer": ("skwer", "m3")}

def noun_forms(lemma, gender):
    out = {}
    for orth, _l, t, *_r in M.generate(lemma):
        q = feats(t)
        if q[0] == {"subst"} and "sg" in q[1] and gender in q[3]:
            for c in q[2] & set(CASES):
                out.setdefault(c, orth)
    return out
MARKER_FORMS = {k: noun_forms(l, g) for k, (l, g) in MARKERS.items()}

def adj_table(nom, gender):
    """Wzorzec odmiany przymiotnika (tabela podrecznikowa)."""
    l = nom.lower()
    if gender == "f":
        s = nom[:-1]; o = s + ("iej" if l[-2:-1] in ("k", "g") else "ej")
        return {"nom": nom, "gen": o, "dat": o, "acc": s + "ą", "inst": s + "ą", "loc": o, "voc": nom}
    if l.endswith("i"):
        b = nom
    elif l.endswith("ie"):
        b = nom[:-1]
    else:
        s = nom[:-1]
        return {"nom": nom, "gen": s + "ego", "dat": s + "emu", "acc": nom, "inst": s + "ym", "loc": s + "ym", "voc": nom}
    return {"nom": nom, "gen": b + "ego", "dat": b + "emu", "acc": nom, "inst": b + "m", "loc": b + "m", "voc": nom}

ADJ_END = {"f": ("ska", "cka", "dzka", "owa", "ewa", "na", "ina", "yna", "ya"), "m3": ("ski", "cki", "dzki", "owy", "ny", "wy"),
           "n": ("skie", "ckie", "owe", "ne", "we")}

def street_gold(cecha, name):
    """(formy nazwy w przypadkach, klasa)."""
    gender = MARKERS[cecha][1]
    if " " in name or not name[:1].isupper():
        return {c: name for c in CASES}, "nieodmienna(wielowyrazowa)"
    adj = None
    known = False
    for _s, _e, (_o, lemma, tag, _t, _q) in M.analyse(name):
        p = feats(tag)
        if p[0] != {"ign"}:
            known = True
        if p[0] == {"adj"} and "sg" in p[1] and "nom" in p[2] and len(p) > 3 and gender in p[3]:
            adj = lemma.split(":")[0]
    if adj:
        out = {}
        for orth, _l, t, *_r in M.generate(adj):
            q = feats(t)
            if q[0] == {"adj"} and "sg" in q[1] and gender in q[3] and "pos" in q[-1]:
                for c in q[2] & set(CASES):
                    out.setdefault(c, cap(name, orth))
        if len(out) == 7:
            return out, "przymiotnik(SGJP)"
    if not known and name.lower().endswith(ADJ_END[gender]):
        return adj_table(name, gender), "przymiotnik(spoza SGJP)"
    return {c: name for c in CASES}, "nieodmienna(dopełniacz/rzeczownik)"

def house():
    n = str(random.randint(1, 120))
    r = random.random()
    return n + "/" + str(random.randint(1, 40)) if r < 0.3 else (n + random.choice("ABC") if r < 0.4 else n)

def prep_w(form):
    return "we" if re.match(r"(?i)[wf][^aąeęioóuy]", form) else "w"

stats = collections.defaultdict(collections.Counter)
examples = collections.defaultdict(list)
def note(key, ok, ex):
    stats[key]["ok" if ok else "bad"] += 1
    if not ok and len(examples[key]) < 25:
        examples[key].append(ex)

def covered(text, spans, start, mention):
    for wm in re.finditer(r"[^\s,./-]+", mention):
        a, b = start + wm.start(), start + wm.end()
        if wm.group().isdigit():
            continue
        if not any(s <= a and b <= e for s, e in spans):
            return False
    return True

def span_for(spans, start, end):
    for s, e in spans:
        if s <= start < e or s < end <= e:
            return s, e
    return None

t0 = time.time()
# --- 1. miejscowosci -----------------------------------------------------------
locs = random.sample(simc, N)
for row in locs:
    name = row["NAZWA"]
    gold, stratum = locality_gold(name)
    kind = "miasto" if row["RM"] == "96" else "wieś/część"
    key = ("miejscowość", stratum)
    stats[key + ("rodzaj",)][kind] += 1
    if not gold:
        continue
    nr = str(random.randint(1, 150))
    # odmiana z mianownika
    r = engine.analyze(name)
    forms = {c: r["forms"][c]["text"] for c in CASES}
    checked = [c for c in CASES if c in gold]
    bad = [c for c in checked if forms[c] not in gold[c]]
    note(key + ("odmiana z mianownika (" + ("7 przypadków" if len(checked) == 7 else "dopełniacz") + ")",), not bad,
         (name, {c: forms[c] for c in bad}, {c: sorted(gold[c])[:2] for c in bad}))
    if holdout and stratum == "SGJP":
        res = holdout.locality_paradigm(name, GEN[name])
        hb = [c for c in CASES if not res or res[0][c][0] not in gold[c]]
        note(key + ("reguły bez SGJP: 7 przypadków",), not hb, (name, GEN[name], {c: res[0][c][0] if res else None for c in hb}, {c: sorted(gold[c])[:2] for c in hb}))
    # tekst
    lo = gold["loc"][0] if "loc" in gold else None
    ge = gold["gen"][0]
    parts, mentions = [], []
    def add(prefix, mention, suffix, canon):
        start = len(" ".join(parts)) + (1 if parts else 0) + len(prefix)
        parts.append(prefix + mention + suffix)
        mentions.append((start, mention, canon))
    if lo:
        add(f"Pozwany zamieszkały {prep_w(lo)} ", f"{lo} {nr}", ".", f"{name} {nr}")
    add("Wcześniej mieszkał w miejscowości ", name, ".", name)
    add("Pozwana pochodzi z ", ge, ".", name)
    add("W 2021 r. przeprowadziła się do ", ge, " z rodziną.", name)
    text = " ".join(parts)
    spans = [(s["start"], s["end"]) for s in gz.recognize(text) if s["kind"] == "ADDRESS"]
    for start, mention, canon in mentions:
        ok = covered(text, spans, start, mention)
        note(key + ("wykrycie wzmianki",), ok, (mention, text))
        if not ok:
            continue
        sp = span_for(spans, start, start + len(mention))
        rr = engine.analyze(text[sp[0]:sp[1]], tuple(text[a:b] for a, b in spans)) if NEW else engine.analyze(text[sp[0]:sp[1]])
        if mention != canon:
            note(key + ("deanonimizacja z formy odmienionej",), rr["canonical"] == canon, (mention, text[sp[0]:sp[1]], rr["canonical"], canon))
    # sad w nazwie miejscowosci nie jest adresem
    court = f"Sprawę rozpoznał Sąd Rejonowy {prep_w(lo)} {lo}." if lo else None
    if court:
        found = [s for s in gz.recognize(court) if s["kind"] == "ADDRESS"]
        note(key + ("nazwa sądu nie jest maskowana",), not found, court)

# --- 2. adresy uliczne -----------------------------------------------------------
LGOLD = {}
for row in random.sample(ulic, N):
    cecha = row["CECHA"]
    name = (row["NAZWA_2"].strip() + " " + row["NAZWA_1"].strip()).strip()
    city = by_sym.get(row["SYM"], "")
    if city not in LGOLD:
        LGOLD[city] = locality_gold(city)
    cgold, cstr = LGOLD[city]
    sgold, scls = street_gold(cecha, name)
    key = ("ulica", scls)
    nr = house()
    marker, mg = MARKERS[cecha]
    mf = MARKER_FORMS[cecha]
    full = {c: f"{cap(marker, mf[c]) if False else mf[c]} {sgold[c]} {nr}" for c in CASES}
    abbr = {c: f"{cecha} {sgold[c]} {nr}" for c in CASES}
    # odmiana
    r1 = engine.analyze(full["nom"]); r2 = engine.analyze(abbr["nom"])
    if cecha in ("rondo", "skwer"):  # pelne slowo, nie skrot: odmienia sie
        abbr = full
    b1 = [c for c in CASES if r1["forms"][c]["text"] != full[c]]
    b2 = [c for c in CASES if r2["forms"][c]["text"] != abbr[c]]
    note(key + ("odmiana: nazwa typu wypisana (ulica Długa)",), not b1, (full["nom"], {c: r1["forms"][c]["text"] for c in b1}, {c: full[c] for c in b1}))
    note(key + ("odmiana: skrót (ul. Długa)",), not b2, (abbr["nom"], {c: r2["forms"][c]["text"] for c in b2}, {c: abbr[c] for c in b2}))
    # tekst
    city_loc = cgold["loc"][0] if cgold and "loc" in cgold else None
    parts, mentions = [], []
    def add(prefix, mention, suffix, canon, kind):
        start = len(" ".join(parts)) + (1 if parts else 0) + len(prefix)
        parts.append(prefix + mention + suffix)
        mentions.append((start, mention, canon, kind))
    if city_loc:
        add(f"Powód zamieszkały przy {full['loc']} {prep_w(city_loc)} ", city_loc, ".", city, "miejscowość")
        mentions.append((len("Powód zamieszkały przy "), full["loc"], full["nom"], "ulica"))
    else:
        add("Powód zamieszkały przy ", full["loc"], ".", full["nom"], "ulica")
    add("Adres do doręczeń: ", abbr["nom"], f", {city}." if city else ".", abbr["nom"], "ulica")
    add("Pozwany wyprowadził się z ", full["gen"], " w 2020 r.", full["nom"], "ulica")
    sname = f"{mf['acc']} {sgold['acc']}"
    add("Następnie przeprowadził się na ", sname, ".", f"{mf['nom']} {sgold['nom']}", "ulica bez numeru")
    text = " ".join(parts)
    spans = [(s["start"], s["end"]) for s in gz.recognize(text) if s["kind"] == "ADDRESS"]
    for start, mention, canon, kind in mentions:
        ok = covered(text, spans, start, mention)
        note(key + ("wykrycie: " + kind,), ok, (mention, text))
        if ok:
            sp = span_for(spans, start, start + len(mention))
            rr = engine.analyze(text[sp[0]:sp[1]], tuple(text[a:b] for a, b in spans)) if NEW else engine.analyze(text[sp[0]:sp[1]])
            if mention != canon:
                note(key + ("deanonimizacja: " + kind,), rr["canonical"] == canon, (mention, text[sp[0]:sp[1]], rr["canonical"], canon))
    if city:
        cs = text.index("Adres do doręczeń: ") + len("Adres do doręczeń: ") + len(abbr["nom"]) + 2
        note(key + ("wykrycie: miejscowość po adresie (\", Kraków\")",), covered(text, spans, cs, city), (city, text))

print(f"czas {time.time() - t0:.0f}s, nowy kod: {NEW}")
for k in sorted(stats, key=str):
    c = stats[k]
    if set(c) <= {"ok", "bad"}:
        tot = c["ok"] + c["bad"]
        print(f"{' | '.join(k):<95} {100 * c['ok'] / tot:6.1f}%  ({c['bad']} błędów / {tot})")
    else:
        print(f"{' | '.join(k):<95} {dict(c)}")
json.dump({" | ".join(k): v for k, v in examples.items()}, open(sys.argv[4] if len(sys.argv) > 4 else "examples.json", "w"), ensure_ascii=False, indent=1)
