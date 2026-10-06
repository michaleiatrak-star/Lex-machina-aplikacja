// Funkcje czyste serwera SN (bez sieci): sąd po sygnaturze, karta, linki niebędące źródłem, koperty snproxy.
import { sadSygnatury, idKarty, urlKarty, problemLinku, rekordy, bladSn, surowyTekst, tekst, normalizujSygnature } from "./sn-mcp-server.js";
import assert from "node:assert";

assert.strictEqual(normalizujSygnature("II  C.S.K.P. 89 / 26"), "II CSKP 89/26");
assert.strictEqual(sadSygnatury("II CSKP 89/26"), "SN");
assert.strictEqual(sadSygnatury("III OSK 1959/22"), "NSA/WSA");
assert.strictEqual(sadSygnatury("I SA/Wa 123/20"), "NSA/WSA");
assert.strictEqual(sadSygnatury("II Cz 12/20"), "sąd powszechny");
assert.strictEqual(sadSygnatury("KIO 82/18"), "KIO");
assert.strictEqual(sadSygnatury("SK 3/20"), "TK");
console.log("OK: sąd właściwy dla sygnatury (repertoria powszechne wrażliwe na wielkość liter)");

assert.strictEqual(idKarty("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg"), "ZuUySp8Bw1HnVDW6c5lg");
assert.strictEqual(idKarty("ZuUySp8Bw1HnVDW6c5lg"), "ZuUySp8Bw1HnVDW6c5lg");
assert.strictEqual(idKarty("II CSKP 89/26"), null);
assert.strictEqual(urlKarty("abc123DEF456"), "https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=abc123DEF456");
assert.deepStrictEqual(problemLinku("blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466"), { rodzaj: "BLOB" });
assert.deepStrictEqual(problemLinku("https://www.sn.pl/sites/orzecznictwo/Orzeczenia3/II%20CSKP%2089-26.pdf"), { rodzaj: "STARY_PDF", sygnatura: "II CSKP 89/26" });
assert.strictEqual(problemLinku("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=x"), null);
console.log("OK: karta = źródło; blob: i stary katalog PDF rozpoznane");

const rek = { id: "ZuUy", sygnatura_sprawy: "III CZP 25/11", data_wydania: "2011-10-18" };
assert.deepStrictEqual(rekordy({ data: [{ data: [rek] }] }), [rek]);
assert.deepStrictEqual(rekordy({ data: [{ data: { data: rek } }] }), [rek]);
assert.deepStrictEqual(rekordy({ data: [{ data: [] }] }), []);
assert.strictEqual(rekordy({ data: [{ cos: 1 }] }), null);
assert.strictEqual(bladSn({ data: [{ data: { error: "timeout", debug: "x" } }] }), "timeout");
const html = "<html><head><title>x</title></head><body><p>Sygn. akt III CZP 25/11</p><p>UCHWAŁA</p></body></html>";
const b64 = Buffer.from(html, "utf8").toString("base64");
assert.strictEqual(surowyTekst({ data: [{ data: { raw: b64 } }] }), b64);
assert.strictEqual(surowyTekst({ data: [{ raw: b64 }] }), b64);
assert.strictEqual(tekst(html), "Sygn. akt III CZP 25/11\nUCHWAŁA");
console.log("OK: koperty snproxy (rekordy, błąd po stronie sn.pl, base64 tekstu)");

// Parametry wyszukiwarki jak w widżecie sn.pl (q i tresc, „w dniu” = od = do) i kontrola trafień.
import { parametrySzukania, pasujeDoFiltra } from "./sn-mcp-server.js";
assert.deepStrictEqual(parametrySzukania({ tresc: "sankcja kredytu darmowego", forma: "wyrok SN", dataWDniu: "2026-07-08", izba: "Izba Cywilna" }), {
  q: "sankcja kredytu darmowego", tresc: "sankcja kredytu darmowego", forma_orzeczenia: "wyrok SN",
  data_wydania_od: "2026-07-08", data_wydania_do: "2026-07-08", izba: "Izba Cywilna", strona: "1", rozmiar_strony: "25",
});
assert.deepStrictEqual(parametrySzukania({ sygnatura: "II  CSKP 89 / 26", naStrone: 10 }), { sygnatura: "II CSKP 89/26", strona: "1", rozmiar_strony: "10" });
assert.ok(pasujeDoFiltra({ sygnatura_sprawy: "II CSKP 89/26", data_wydania: "2026-07-08", forma_orzeczenia: "wyrok SN" }, { dataOd: "2026-07-01", dataDo: "2026-07-31", forma: "wyrok SN" }));
assert.ok(!pasujeDoFiltra({ sygnatura_sprawy: "II CSKP 89/26", data_wydania: "2026-08-08" }, { dataDo: "2026-07-31" }));
assert.ok(!pasujeDoFiltra({ sygnatura_sprawy: "I CSKP 89/26" }, { sygnatura: "II CSKP 89/26" }));
console.log("OK: parametry wyszukiwarki SN (treść, forma, daty, izba) i kontrola trafień");

// Odpowiedź snproxy: JSON albo strona HTML (ochrona przed botami) — nigdy „Unexpected token '<'”.
import { rozpoznajOdpowiedz, BlokadaSn } from "./sn-mcp-server.js";
assert.deepStrictEqual(rozpoznajOdpowiedz(200, "application/json", '{"data":[]}'), { dane: { data: [] } });
const strona = rozpoznajOdpowiedz(200, "text/html", '<html style="height:100%"><head><META NAME="ROBOTS"></head><body><iframe src="/_Incapsula_Resource?x"></iframe></body></html>');
assert.ok(strona.blad instanceof BlokadaSn && /ochrona przed botami/.test(strona.blad.message), strona.blad?.message);
assert.ok(rozpoznajOdpowiedz(200, "application/json", "<html><body>Przerwa techniczna</body></html>").blad instanceof BlokadaSn);
assert.ok(rozpoznajOdpowiedz(403, "text/html", "<html></html>").blad instanceof BlokadaSn);
assert.ok(!(rozpoznajOdpowiedz(500, "application/json", "{}").blad instanceof BlokadaSn));
assert.match(rozpoznajOdpowiedz(200, "application/json", "{zly").blad.message, /nie jest poprawnym JSON/);
console.log("OK: strona HTML/ochrona przed botami rozpoznana zamiast błędu parsowania JSON");
