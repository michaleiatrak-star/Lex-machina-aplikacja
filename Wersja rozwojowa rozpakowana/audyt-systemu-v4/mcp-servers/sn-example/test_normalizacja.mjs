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
