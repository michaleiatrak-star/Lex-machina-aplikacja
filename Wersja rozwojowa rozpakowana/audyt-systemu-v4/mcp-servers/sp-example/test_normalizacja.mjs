// Funkcje czyste konektora sp (bez sieci): Tapestry, portal sądu, id dokumentu, strona wyników.
import { kodujTapestry, hostPortalu, dozwolonyHost, urlSzukania, urlOrzeczenia, rozbierzDocId, tasamaSygnatura, parsujWyniki, tekst } from "./sp-mcp-server.js";
import assert from "node:assert";

assert.strictEqual(kodujTapestry("I  C 100 / 15"), "I$0020C$0020100$002f15");
assert.strictEqual(urlSzukania("https://orzeczenia.ms.gov.pl", "I C 100/15"),
  "https://orzeczenia.ms.gov.pl/search/advanced/$N/I$0020C$0020100$002f15/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/1");
assert.strictEqual(hostPortalu(), "https://orzeczenia.ms.gov.pl");
assert.strictEqual(hostPortalu("poznan.so"), "https://orzeczenia.poznan.so.gov.pl");
assert.strictEqual(hostPortalu("orzeczenia.warszawa.sa.gov.pl"), "https://orzeczenia.warszawa.sa.gov.pl");
assert.throws(() => hostPortalu("evil.com"));
assert.ok(dozwolonyHost("https://orzeczenia.krakow.sr.gov.pl/content/$N/1"));
assert.ok(!dozwolonyHost("https://orzeczenia.evil.pl/content/$N/1"));
console.log("OK: kontekst Tapestry i portale sądów");

const id = "155000000001006_I_C_000100_2015_Uz_2015-06-18_001";
assert.deepStrictEqual(rozbierzDocId(id), { docId: id, kodSadu: "155000000001006", sygnatura: "I C 100/15", rodzaj: "uzasadnienie", data: "2015-06-18" });
assert.deepStrictEqual(rozbierzDocId("abc"), { docId: "abc" });
assert.ok(tasamaSygnatura("I C 100/15", "I C 100/2015"));
assert.ok(!tasamaSygnatura("I C 100/15", "II C 100/15"));
assert.strictEqual(urlOrzeczenia("https://orzeczenia.ms.gov.pl", id), `https://orzeczenia.ms.gov.pl/content/$N/${id}`);
console.log("OK: id dokumentu → sygnatura, rodzaj, data; stały link do orzeczenia");

const html = `<div><span class="big_number">2</span> <a href="/details/$N/${id}">I C 100/15</a>
<a href="/details/$N/${id}">x</a> <a href="/details/$N/155010000000503_I_C_000100_2015_Uz_2016-01-02_001">y</a></div>`;
assert.deepStrictEqual(parsujWyniki(html), { liczba: 2, docIds: [id, "155010000000503_I_C_000100_2015_Uz_2016-01-02_001"] });
assert.deepStrictEqual(parsujWyniki("<p>Nie znaleziono żadnego wyniku pasującego do zapytania</p>"), { liczba: 0, docIds: [] });
assert.strictEqual(tekst("<html><head><title>x</title></head><body><p>Sygn. akt I C 100/15</p><p>WYROK</p></body></html>"), "Sygn. akt I C 100/15\nWYROK");
console.log("OK: strona wyników (liczba, id bez powtórzeń, brak trafień)");

// Fraza w kontekście Tapestry (polskie znaki jako $XXXX) i kontrola, że treść zawiera frazę.
import { urlSzukaniaFrazy, zawieraFraze } from "./sp-mcp-server.js";
assert.strictEqual(kodujTapestry("kredyt ą"), "kredyt$0020$0105");
assert.strictEqual(urlSzukaniaFrazy("https://orzeczenia.ms.gov.pl", "sankcja kredytu"),
  "https://orzeczenia.ms.gov.pl/search/advanced/sankcja$0020kredytu/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/$N/1");
assert.ok(zawieraFraze("Sąd uznał, że sankcja kredytu darmowego przysługuje", "sankcji kredytu darmowego"));
assert.ok(!zawieraFraze("Sprawa o zapłatę z umowy najmu", "sankcja kredytu darmowego"));
console.log("OK: fraza w Portalu Orzeczeń (kodowanie Tapestry, kontrola treści)");
