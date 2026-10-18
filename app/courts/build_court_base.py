#!/usr/bin/env python3
"""Court base of Lex Machina from official sources only.

Inputs (downloaded by the caller, paths as arguments):
  --act       text of the regulation of the Minister of Justice of 28.12.2018 on the seats and
              areas of jurisdiction of common courts, consolidated text Dz.U. 2026 poz. 492
              (ELI DU/2026/492 text.pdf through `pdftotext -layout`);
  --contacts  MS open data "Dane teleadresowe sądów" (dane.gov.pl resource 2360934, xlsx);
  --gminy     PRG (GUGiK) A03_Granice_gmin as TSV: TERC code, name, version;
  --out       the generated TypeScript module (app/lex-runtime/src/courts/court-base-data.ts).

Court areas of cities with several district courts (Warszawa, Kraków, Łódź, Poznań, Wrocław,
Gdańsk, Katowice, Lublin, Szczecin) are not resolved here: the runtime asks PRG for the court
of the address point; this base gives their candidates and everything else.
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path

ROMAN_PAGE = re.compile(r"^\s*Dziennik Ustaw\s+–\s*\d+\s*–\s+Poz\.\s*\d+\s*$")
FOOTNOTE_REF = re.compile(r"(?<=\))\d\)")


def clean_act(text: str) -> str:
    """The regulation's body as one line per paragraph, hyphenation undone, page heads dropped."""
    start = text.index("§ 1. Ustala się siedziby")
    end = text.index("§ 3a.")
    lines = []
    footnote = False
    for line in text[start:end].splitlines():
        if ROMAN_PAGE.match(line) or not line.strip():
            footnote = False if not line.strip() and not footnote else footnote
            continue
        # Footnotes at the page foot ("1) Zmiany tekstu jednolitego…") and their continuation lines.
        if re.match(r"^\s*\d\)\s{2,}(?:Zmiany|W brzmieniu|Niniejsze|Ze zmian|Dodan|Zmienion)", line):
            footnote = True
            continue
        if footnote and re.match(r"^\s{4,}\S", line) and not re.match(r"^\s*(?:\d+[a-z]?\)|[a-z]{1,2}\))\s", line):
            continue
        footnote = False
        lines.append(line.strip())
    out = ""
    for line in lines:
        if not out:
            out = line
        elif out.endswith("-") and re.match(r"[a-ząćęłńóśźż]", line):
            out = out[:-1] + line
        elif out.endswith("-") and line.startswith("-"):
            # Polish typesetting repeats the hyphen of a compound at the start of the next line.
            out += line[1:]
        elif out.endswith("-"):
            out += line
        else:
            out += " " + line
    return FOOTNOTE_REF.sub("", out)


def split_list(text: str) -> list[str]:
    text = text.strip().strip(",;").strip()
    parts = re.split(r",\s*|\s+i\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])", text)
    return [part.strip() for part in parts if part.strip()]


AREA_KEY = re.compile(r"(?<![\wąćęłńóśźż])(miasta stołecznego|miasta|miast|gminy|gmin)\s*:?\s+")
STOP = re.compile(r"\s+oraz\s+(?=(?:dla\s+)?(?:miasta|miast|gminy|gmin)\b)|,\s+(?=(?:dla\s+)?(?:miasta|miast|gmin)\b)")


def parse_area(area: str, own_city: str) -> dict:
    """Towns and communes of a district court; a split city named with the part's description."""
    result = {"miasta": [], "gminy": [], "czesc": None}
    if area.startswith("części"):
        # The description of the city's part runs to the first list of whole towns or communes
        # that is not part of the boundary itself ("granicy miasta Lublin z gminą Głusk").
        tail = re.search(r"(?:,\s+a\s+także\s+dla\s+|,\s+dla\s+|\s+oraz\s+(?:dla\s+)?|,\s+)(?=(?:miasta|miast|gmin)\b(?!\s+Lublin\b)(?!\s+[A-ZŁŚŻ]\w+\s+(?:i|z)\s+gmin))", area)
        description = area[: tail.start()] if tail else area
        result["czesc"] = {"miasto": own_city, "opis": description}
        # Kraków, Łódź, Poznań, Warszawa, Wrocław: districts; Gdańsk: auxiliary units.
        units = re.search(r"(?:dzielnicy|dzielnic|jednostek pomocniczych)\s*:?\s+(.+)$", description)
        if units:
            result["czesc"]["jednostki"] = split_list(units.group(1))
        area = area[tail.end():] if tail else ""
    for match in re.finditer(r"(miasta stołecznego|miasta|miast|gminy|gmin)\s*:?\s+(.+?)(?=\s+(?:oraz|i)\s+(?:dla\s+)?(?:miasta|miast|gminy|gmin)\b|,\s+(?:dla\s+)?(?:miasta|miast|gmin)\b|$)", area):
        kind, names = match.group(1), split_list(match.group(2))
        (result["miasta"] if kind.startswith("miast") else result["gminy"]).extend(names)
    return result


ZAKRES = {
    "cywilnego": "cywilne",
    "rodzinnego i opiekuńczego": "rodzinne",
    "karnego": "karne",
    "pracy i ubezpieczeń społecznych": "pracy_ubezpieczen",
    "pracy": "pracy",
    "spraw gospodarczych": "gospodarcze",
    "sprawy gospodarcze": "gospodarcze",
    "upadłościowych i restrukturyzacyjnych": "upadlosciowe",
    "rejestru zastawów": "rejestr_zastawow",
    "Krajowego Rejestru Sądowego": "krs",
    "ksiąg wieczystych": "ksiegi_wieczyste",
    "zgodności z prawdą oświadczeń lustracyjnych": "lustracyjne",
    "własności intelektualnej": "wlasnosc_intelektualna",
    "rejestru dzienników i czasopism": "rejestr_prasy",
}


def zakres(text: str) -> list[str]:
    found = []
    for phrase, key in ZAKRES.items():
        if phrase in text and key not in found:
            if key == "pracy" and "pracy i ubezpieczeń społecznych" in text:
                continue
            found.append(key)
    if "pracy_ubezpieczen" in found:
        found = [key for key in found if key != "pracy"] + ["pracy", "ubezpieczen_spolecznych"]
        found.remove("pracy_ubezpieczen")
    return found


def city_of(name: str) -> str:
    """The seat as written after "w"/"we" in the court's name, nominative not attempted."""
    match = re.search(r"\s(?:w|we)\s+(.+?)(?:\s+z siedzibą\s+w\s+.+)?$", name)
    return match.group(1) if match else ""


def parse_act(text: str) -> dict:
    body = clean_act(text)
    p1 = body[body.index("§ 1."): body.index("§ 2.")]
    p2 = body[body.index("§ 2."): body.index("§ 3.")]
    p3 = body[body.index("§ 3."):]
    appeals = []
    for match in re.finditer(r"(Sąd Apelacyjny (?:w|we) [^–]+?)\s+–\s+obejmujący obszar właściwości sądów okręgowych:?\s*(.+?)\s+oraz rozpoznający (.+?)(?=;\s*\d+\)|\.\s*§|\.$|$)", p1):
        appeals.append({"nazwa": match.group(1).strip(), "zakres": zakres(match.group(3))})
    regionals, districts = [], []
    so_of_section = None
    for block in re.split(r"(?=\b\d+[a-z]?\)\s+w obszarze właściwości Sądu )", p2):
        head = re.match(r"\d+[a-z]?\)\s+w obszarze właściwości (Sądu Apelacyjnego (?:w|we) .+?):", block)
        if not head:
            continue
        sa = head.group(1).replace("Sądu Apelacyjnego", "Sąd Apelacyjny")
        sa = {"w Białymstoku": "w Białymstoku"}.get(sa, sa)
        for match in re.finditer(r"[a-z]{1,2}\)\s+(Sąd Okręgowy .+?)\s+–\s+obejmujący obszar właściwości sądów rejonowych(.+?)\s+oraz rozpoznający (.+?)(?=,\s+[a-z]{1,2}\)\s+Sąd Okręgowy|;\s*\d+[a-z]?\)|\.$|$)", block):
            districts.append({"nazwa": match.group(1).strip(), "sa": sa, "zakres": zakres(match.group(3))})
    for block in re.split(r"(?=\b\d+[a-z]?\)\s+w obszarze właściwości Sądu Okręgowego )", p3):
        head = re.match(r"\d+[a-z]?\)\s+w obszarze właściwości (Sądu Okręgowego .+?):", block)
        if not head:
            continue
        so_of_section = head.group(1)
        for match in re.finditer(r"[a-z]{1,2}\)\s+(Sąd Rejonowy .+?)\s+–\s+dla\s+(.+?)\s+oraz do rozpoznawania spraw (.+?)(?=,\s+[a-z]{1,2}\)\s+(?:Sąd Rejonowy|\(uchylona\))|;\s*\d+[a-z]?\)|;?\s*$)", block):
            name = re.sub(r"\s+", " ", match.group(1)).strip()
            seat = re.search(r"z siedzibą w (.+)$", name)
            regionals.append({
                "nazwa": name,
                "so_dopelniacz": so_of_section,
                "obszar_tekst": match.group(2).strip(),
                "zakres": zakres(match.group(3)),
                **({"siedziba": seat.group(1)} if seat else {}),
            })
    return {"sa": appeals, "so": districts, "sr": regionals}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


# The act writes some communes unlike TERYT: the TERYT name is the key of the register.
ACT_NAME_TO_TERYT = {"kotła": "kotla"}


def place_key(text: str) -> str:
    """A commune's name for matching: hyphen or space alike ("Jedlnia Letnisko" / "Jedlnia-Letnisko")."""
    # PRG names communes of the same name with their region: "Słupia (Jędrzejowska)", "Dobra (Szczecińska)".
    key = re.sub(r"\s*\([^)]*\)", "", norm(text)).replace("-", " ")
    key = re.sub(r"\s+", " ", key)
    return ACT_NAME_TO_TERYT.get(key, key)


def court_key(text: str) -> str:
    """A court's name for matching the MS contact list ("m.st." spelled out, typos without "w")."""
    key = norm(text).replace("m.st.", "miasta stołecznego").replace("-", " ")
    return " ".join(word for word in key.split() if word not in {"w", "we", "dla"})


def genitive_to_nominative(so_genitive: str, names: list[str]) -> str:
    """'Sądu Okręgowego w Białymstoku' -> the district court's own name from § 2."""
    tail = so_genitive.replace("Sądu Okręgowego", "Sąd Okręgowy")
    for name in names:
        if norm(name) == norm(tail):
            return name
    raise ValueError(f"no district court for {so_genitive}")


def load_contacts(path: Path) -> dict:
    from openpyxl import load_workbook

    sheet = load_workbook(path, read_only=True).worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))
    head = [str(cell or "").strip() for cell in rows[0]]
    out = {}
    for row in rows[1:]:
        item = {head[index]: (str(cell).strip() if cell is not None else "") for index, cell in enumerate(row)}
        name = re.sub(r"\s+", " ", item.get("Nazwa sądu", "")).strip()
        if not name:
            continue
        out[court_key(name)] = {
            "ulica": re.sub(r"\s+", " ", item.get("Ulica", "")),
            "kod": item.get("Kod pocztowy", ""),
            "miejscowosc": item.get("Miejscowość", ""),
            "telefon": item.get("Telefon", ""),
            "email": item.get("E-mail", ""),
            "epuap": item.get("adres ePUAP", ""),
        }
    return out


def resolve_gminy(regional: dict, gminy: list[tuple[str, str]], split_cities: set[str]) -> tuple[list[str], list[str]]:
    """TERC codes of a court's towns and communes; names shared by several communes are chosen
    by the region of the court's other, unambiguous communes."""
    by_name: dict[str, list[tuple[str, str]]] = {}
    for code, name in gminy:
        by_name.setdefault(place_key(name), []).append((code, name))
    area = regional["obszar"]
    wanted = [(name, "miasto") for name in area["miasta"]] + [(name, "gmina") for name in area["gminy"]]
    resolved, unresolved, ambiguous = [], [], []
    for name, kind in wanted:
        if norm(name) in split_cities:
            continue
        options = by_name.get(place_key(name), [])
        # A town is a municipal commune (1) or the town of an urban-rural one (3);
        # a commune is rural (2) or urban-rural (3); Warsaw's 0 (city with powiat rights).
        typed = [code for code, _ in options if (code[-1] in "13" if kind == "miasto" else code[-1] in "23")] or [code for code, _ in options]
        if len(typed) == 1:
            resolved.append(typed[0])
        elif typed:
            ambiguous.append((name, typed))
        else:
            unresolved.append(name)
    powiaty = {code[:4] for code in resolved}
    voivodeships = {code[:2] for code in resolved}
    for name, options in ambiguous:
        near = [code for code in options if code[:4] in powiaty] or [code for code in options if code[:2] in voivodeships]
        if len(near) == 1:
            resolved.append(near[0])
        else:
            unresolved.append(f"{name}?{'/'.join(options)}")
    return sorted(set(resolved)), unresolved


SPLIT_CITIES = {
    "Warszawa": "Warszaw",
    "Kraków": "Krakowa",
    "Łódź": "Łodzi",
    "Poznań": "Poznań",
    "Wrocław": "Wrocławia",
    "Gdańsk": "Gdańsk",
    "Katowice": "Katowice",
    "Lublin": "Lublin",
    "Szczecin": "Szczecin",
}


def split_city_table(regionals: list[dict], gminy: list[tuple[str, str]], units: list[tuple[str, str]]) -> dict:
    table = {}
    for city, stem in SPLIT_CITIES.items():
        terc = next(code for code, name in gminy if norm(name) == norm(city) and code.endswith("1"))
        courts = [item for item in regionals if item["obszar"]["czesc"] and stem in item["nazwa"]]
        entry = {"nazwa": city, "terc": terc, "sady": [item["nazwa"] for item in courts]}
        own = [(code, re.sub(r"\s+-\s+(?:dzielnica|delegatura)$", "", name)) for code, name in units if code.startswith(terc[:4]) and code[-1] in "89"]
        if own:
            mapping = {}
            for code, name in own:
                unit = re.sub(rf"^{re.escape(city)}-", "", name)
                court = [item["nazwa"] for item in courts if norm(unit) in {norm(part) for part in item["obszar"]["czesc"].get("jednostki", [])}]
                if len(court) != 1:
                    raise ValueError(f"unit {code} {name}: courts {court}")
                mapping[code] = {"jednostka": unit, "sad": court[0]}
            entry["jednostki_ewidencyjne"] = mapping
        table[terc] = entry
    return table


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--act", required=True)
    parser.add_argument("--contacts", required=True)
    parser.add_argument("--gminy", required=True)
    parser.add_argument("--units", required=True, help="PRG A05 registration units as TSV: code, name")
    parser.add_argument("--out", required=True)
    parser.add_argument("--json", default=None)
    args = parser.parse_args()

    act = parse_act(Path(args.act).read_text(encoding="utf-8"))
    contacts = load_contacts(Path(args.contacts))
    gminy = [tuple(line.split("\t")[:2]) for line in Path(args.gminy).read_text(encoding="utf-8").splitlines() if line.strip()]
    units = [tuple(line.split("\t")[:2]) for line in Path(args.units).read_text(encoding="utf-8").splitlines() if line.strip()]
    so_names = [item["nazwa"] for item in act["so"]]
    split_cities = set()
    for item in act["sr"]:
        item["so"] = genitive_to_nominative(item.pop("so_dopelniacz"), so_names)
        item["obszar"] = parse_area(item["obszar_tekst"], city_of(item["nazwa"]))
        if item["obszar"]["czesc"]:
            split_cities.add(norm(item["obszar"]["czesc"]["miasto"]))
    # Split cities named in the nominative as the act writes them in the lists of other courts.
    split_cities |= {"warszawa", "kraków", "łódź", "poznań", "wrocław", "gdańsk", "katowice", "lublin", "szczecin"}
    problems = []
    for item in act["sr"]:
        item["terc"], unresolved = resolve_gminy(item, gminy, split_cities)
        if unresolved:
            problems.append(f"{item['nazwa']}: {', '.join(unresolved)}")
    for collection in (act["sa"], act["so"], act["sr"]):
        for item in collection:
            contact = contacts.get(court_key(item["nazwa"]))
            if contact:
                item["adres"] = contact
            else:
                problems.append(f"brak danych teleadresowych: {item['nazwa']}")
    # Cities with several district courts: their TERC, the courts sharing them and, where PRG
    # has the parts as registration units (dzielnice of Warsaw, delegatury of Kraków and Łódź),
    # the unit codes (ULDK answers them for a point) with the court of each.
    act["miasta_dzielone"] = split_city_table(act["sr"], gminy, units)
    act["zrodla"] = {
        "akt": "Rozporządzenie Ministra Sprawiedliwości z dnia 28 grudnia 2018 r. w sprawie ustalenia siedzib i obszarów właściwości sądów apelacyjnych, sądów okręgowych i sądów rejonowych oraz zakresu rozpoznawanych przez nie spraw (t.j. Dz.U. 2026 poz. 492)",
        "eli": "https://api.sejm.gov.pl/eli/acts/DU/2026/492",
        "dane_teleadresowe": "dane.gov.pl, Ministerstwo Sprawiedliwości, Dane teleadresowe sądów (zasób 2360934, lipiec 2026)",
        "gminy": "PRG GUGiK, A03_Granice_gmin (TERC), A05_Granice_jednostek_ewidencyjnych",
    }
    act["problemy"] = problems
    payload = json.dumps(act, ensure_ascii=False, separators=(",", ":"))
    if args.json:
        Path(args.json).write_text(json.dumps(act, ensure_ascii=False, indent=1), encoding="utf-8")
    Path(args.out).write_text(
        "// Generated by app/courts/build_court_base.py from official sources (see zrodla). Do not edit.\n"
        "import type { CourtBase } from \"./court-base.js\";\n\n"
        f"export const COURT_BASE: CourtBase = {payload};\n",
        encoding="utf-8",
    )
    print(json.dumps({"sa": len(act["sa"]), "so": len(act["so"]), "sr": len(act["sr"]), "problems": problems}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
