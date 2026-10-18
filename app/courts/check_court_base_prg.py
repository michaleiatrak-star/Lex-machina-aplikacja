#!/usr/bin/env python3
"""The court base (regulation t.j. Dz.U. 2026 poz. 492) against the court areas of PRG (GUGiK).

For every commune of PRG A03_Granice_gmin, a point inside it is looked up in PRG
S03_Sad_rejonowy; the court found must be the court the regulation gives that commune (cities
with several district courts: one of their candidates). Inputs are WFS GetFeature responses
(GML 3.2, EPSG:2180) with geometry; needs shapely and lxml.

  python3 check_court_base_prg.py --base court-base.json --gminy A03.xml --courts S03.xml
"""
import argparse
import json
import re
import sys

from lxml import etree
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

NS = {"gml": "http://www.opengis.net/gml/3.2", "ms": "http://mapserver.gis.umn.edu/mapserver", "wfs": "http://www.opengis.net/wfs/2.0"}


def ring(element) -> list[tuple[float, float]]:
    values = [float(value) for value in element.text.split()]
    # EPSG:2180 in GML 3.2: northing, easting.
    return [(values[index + 1], values[index]) for index in range(0, len(values), 2)]


def features(path: str):
    for _, member in etree.iterparse(path, tag="{http://www.opengis.net/wfs/2.0}member", huge_tree=True):
        name = member.findtext(".//ms:JPT_NAZWA_", namespaces=NS) or ""
        code = member.findtext(".//ms:JPT_KOD_JE", namespaces=NS) or ""
        polygons = []
        for polygon in member.iterfind(".//gml:Polygon", namespaces=NS):
            exterior = polygon.find("gml:exterior//gml:posList", namespaces=NS)
            holes = [ring(item) for item in polygon.iterfind("gml:interior//gml:posList", namespaces=NS)]
            polygons.append(Polygon(ring(exterior), holes))
        member.clear()
        yield code, name, unary_union(polygons).buffer(0)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--gminy", required=True)
    parser.add_argument("--courts", required=True)
    args = parser.parse_args()
    base = json.load(open(args.base, encoding="utf-8"))
    by_terc: dict[str, str] = {}
    for court in base["sr"]:
        for code in court["terc"]:
            by_terc[code] = court["nazwa"]
    split = {code: {norm(name) for name in entry["sady"]} for code, entry in base["miasta_dzielone"].items()}
    courts = list(features(args.courts))
    tree = STRtree([geometry for _, _, geometry in courts])
    prg_names = {norm(name) for _, name, _ in courts}
    act_names = {norm(court["nazwa"]) for court in base["sr"]}
    report = {"gminy": 0, "zgodne": 0, "miasta_dzielone": 0, "rozbieznosci": [], "bez_sadu_w_prg": [],
              "sady_tylko_w_akcie": sorted(act_names - prg_names), "sady_tylko_w_prg": sorted(prg_names - act_names)}
    for code, name, geometry in features(args.gminy):
        report["gminy"] += 1
        # The court covering most of the commune's land (a point may fall in the sea or a bay).
        shares = {}
        for index in tree.query(geometry, predicate="intersects"):
            area = courts[index][2].intersection(geometry).area
            if area > 0:
                shares[courts[index][1]] = shares.get(courts[index][1], 0) + area
        if not shares:
            report["bez_sadu_w_prg"].append(f"{code} {name}")
            continue
        if code in split:
            found = {norm(item) for item, area in shares.items() if area > 0.01 * geometry.area}
            if found == split[code]:
                report["miasta_dzielone"] += 1
            else:
                report["rozbieznosci"].append(f"{code} {name}: akt {sorted(split[code])}, PRG {sorted(found)}")
            continue
        dominant = max(shares, key=shares.get)
        expected = by_terc.get(code)
        if expected and norm(expected) == norm(dominant):
            report["zgodne"] += 1
        else:
            report["rozbieznosci"].append(f"{code} {name}: akt {expected}, PRG {dominant}")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)
    print()
    sys.exit(1 if report["rozbieznosci"] or report["bez_sadu_w_prg"] else 0)


if __name__ == "__main__":
    main()
