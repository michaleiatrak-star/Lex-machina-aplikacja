// Funkcje czyste konektora tk (bez sieci).
import { toSygnaturaTk, dozwolonyHost, zawieraSygnature, normalizujSygnature } from "./tk-mcp-server.js";
import assert from "node:assert";

assert.strictEqual(normalizujSygnature("K  33 / 07"), "K 33/07");
assert.ok(toSygnaturaTk("K 33/07") && toSygnaturaTk("SK 3/20") && toSygnaturaTk("Kp 1/09"));
assert.ok(!toSygnaturaTk("I C 100/15") && !toSygnaturaTk("II CSKP 89/26"));
assert.ok(dozwolonyHost("https://ipo.trybunal.gov.pl/ipo/Sprawa?cid=1&dokument=123&sprawa=456"));
assert.ok(!dozwolonyHost("https://example.com/ipo"));
assert.ok(zawieraSygnature("Wyrok z dnia 3 lipca 2008 r. Sygn. akt K. 33/07", "K 33/07"));
assert.ok(zawieraSygnature("sygn. K 33/2007", "K 33/07"));
assert.ok(!zawieraSygnature("Sygn. akt SK 33/07", "K 33/07"));
assert.ok(!zawieraSygnature("Sygn. akt K 333/07", "K 33/07"));
console.log("OK: sygnatury TK, hosty IPO/OTK ZU, kontrola tożsamości dokumentu");

// Formularz JSF wyszukiwarki IPO: pola odczytywane z HTML (nazwy nie są stałe).
import { formularzIpo, wynikiIpo } from "./tk-mcp-server.js";
const strona = `<html><body><form id="wyszukiwanie" name="wyszukiwanie" method="post" action="/ipo/Szukaj?cid=1">
<input type="hidden" name="wyszukiwanie" value="wyszukiwanie" />
<input id="wyszukiwanie:sygnatura" name="wyszukiwanie:sygnatura" type="text" value="" />
<input id="wyszukiwanie:fraza" name="wyszukiwanie:fraza" type="text" value="" />
<button id="wyszukiwanie:j_idt42" name="wyszukiwanie:j_idt42" type="submit"><span class="ui-button-text">Szukaj</span></button>
<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="-123:456&amp;x" />
</form></body></html>`;
assert.deepStrictEqual(formularzIpo(strona), {
  akcja: "https://ipo.trybunal.gov.pl/ipo/Szukaj?cid=1",
  pola: { wyszukiwanie: "wyszukiwanie", "javax.faces.ViewState": "-123:456&x" },
  poleSygnatury: "wyszukiwanie:sygnatura",
  przycisk: "wyszukiwanie:j_idt42",
});
assert.strictEqual(formularzIpo("<form><input name='x' type='text'></form>"), null);
const wyniki = `<table><tr><td><a href="/ipo/Sprawa?cid=1&amp;dokument=4519&amp;sprawa=4796">K 33/07</a></td><td>Wyrok</td></tr>
<tr><td><a href="/ipo/Sprawa?cid=1&amp;dokument=9999&amp;sprawa=1">SK 33/07</a></td></tr></table>`;
assert.deepStrictEqual(wynikiIpo(wyniki, "K 33/07"), ["https://ipo.trybunal.gov.pl/ipo/Sprawa?cid=1&dokument=4519&sprawa=4796"]);
console.log("OK: formularz JSF IPO (ViewState, pole sygnatury, przycisk Szukaj) i wyniki przy pytanej sygnaturze");

// Źródła urzędowe bez SAOS: karta sprawy IPO (GET po sygnaturze) i pozycje OTK ZU.
import { urlSprawyIpo, dokumentyIpo, formularzSygnatury, wynikiOtkzu } from "./tk-mcp-server.js";
assert.strictEqual(urlSprawyIpo("K 28/05"), "https://ipo.trybunal.gov.pl/ipo/view/sprawa.xhtml?pokaz=dokumenty&sygnatura=K+28%2F05");
assert.strictEqual(urlSprawyIpo("P  21 / 19"), "https://ipo.trybunal.gov.pl/ipo/view/sprawa.xhtml?pokaz=dokumenty&sygnatura=P+21%2F19");
const karta = `<h1>Sprawa P 21/19</h1><ul><li><a href="/ipo/Sprawa?cid=1&amp;dokument=20359&amp;sprawa=22412">Wyrok z dnia 1 lipca 2020</a></li>
<li><a href="/ipo/view/sprawa.xhtml?pokaz=dokumenty">Dokumenty</a></li><li><a href="https://example.com/dokument">obcy</a></li></ul>`;
assert.deepStrictEqual(dokumentyIpo(karta), [{ tytul: "Wyrok z dnia 1 lipca 2020", url: "https://ipo.trybunal.gov.pl/ipo/Sprawa?cid=1&dokument=20359&sprawa=22412" }]);
assert.deepStrictEqual(formularzSygnatury(`<form action="/Wyszukiwanie" method="get"><input name="Sygnatura" type="text"><input name="MiejscePublikacji" type="text"><button type="submit" name="szukaj" value="1">Szukaj</button></form>`),
  { akcja: "https://otkzu.trybunal.gov.pl/Wyszukiwanie", metoda: "get", pola: {}, poleSygnatury: "Sygnatura", przycisk: { nazwa: "szukaj", wartosc: "1" } });
assert.strictEqual(formularzSygnatury("<form><input name='fraza'></form>"), null);
const lista = `<table><tr><td><a href="/2020/A/43">OTK ZU A/2020, poz. 43</a></td><td>Wyrok (P 21/19)</td></tr>
<tr><td><a href="/2021/A/1">OTK ZU A/2021, poz. 1</a></td><td>Wyrok (SK 21/19)</td></tr></table>`;
assert.deepStrictEqual(wynikiOtkzu(lista, "P 21/19"), ["https://otkzu.trybunal.gov.pl/2020/A/43"]);
console.log("OK: karta sprawy IPO po sygnaturze, dokumenty sprawy, formularz i wyniki OTK ZU");
