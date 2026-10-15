/**
 * Amounts misread by OCR, fixed by rule (no model): a kwota next to a currency
 * with letters in place of digits ("20.ooo,00 zł", "60.0o0,00 zł", "1 5OO zl"),
 * a dot or comma in the wrong place ("20.000.00 zł", "20,000,00 zł") or a lost
 * diacritic in the currency ("zl"). A fix is taken only when the whole amount
 * becomes a valid Polish amount; anything else stays as read.
 */
// Letters OCR typically reads in place of a digit. Lowercase z/s are left out:
// they are too often real letters next to an amount.
const CONFUSABLE = {
    o: "0", O: "0", D: "0", Q: "0",
    l: "1", I: "1", i: "1", "|": "1", "!": "1",
    S: "5", B: "8", Z: "2"
};
const CHAR = "[\\dOoDQlIi|!SBZ]";
const CURRENCY = "(?:złotych|złote|złoty|zł|zl|PLN|EUR|USD|€)";
// The amount starts with a digit and ends right before the currency.
const AMOUNT = new RegExp(`(?<![\\p{L}\\p{N}.,])(\\d${CHAR}*(?:[. ,]${CHAR}+)*)(\\s?)(${CURRENCY})(?![\\p{L}])`, "gu");
const VALID = /^(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:,\d{2})?$/u;
function fixAmount(raw) {
    const letters = [...raw].filter((char) => CONFUSABLE[char]).length;
    const digits = (raw.match(/\d/gu) ?? []).length;
    // Digits carry the amount: at most two misread letters per digit read ("1 5OO,OO").
    if (digits < 2 || letters > 2 * digits)
        return null;
    let fixed = [...raw].map((char) => CONFUSABLE[char] ?? char).join("");
    // Grosze after a dot, thousands after dots: "20.000.00" -> "20.000,00".
    if (/^\d{1,3}(?:\.\d{3})+\.\d{2}$/u.test(fixed))
        fixed = fixed.replace(/\.(\d{2})$/u, ",$1");
    // Thousands after commas: "20,000,00" -> "20.000,00".
    else if (/^\d{1,3}(?:,\d{3})+,\d{2}$/u.test(fixed))
        fixed = fixed.replace(/,(?=\d{3}(?:[,]|$))/gu, ".");
    return VALID.test(fixed) ? fixed : null;
}
/** The line with its amounts fixed and the changes made ("from" as read). */
export function fixOcrAmounts(text) {
    const fixes = [];
    const result = text.replace(AMOUNT, (whole, raw, space, currency) => {
        const amount = fixAmount(raw) ?? raw;
        const unit = currency === "zl" ? "zł" : currency;
        const replaced = `${amount}${space}${unit}`;
        if (replaced === whole)
            return whole;
        fixes.push({ from: whole, to: replaced });
        return replaced;
    });
    return { text: result, fixes };
}
