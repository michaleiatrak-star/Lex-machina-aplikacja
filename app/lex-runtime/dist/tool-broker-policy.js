import { detectIdentifiers } from "./privacy/identifiers.js";
/**
 * Data-protection policy for calls to external legal sources, enforced in code
 * before a call leaves the application:
 *
 * - A pseudonymization token never leaves (guard in the federation runtime),
 *   except a business identifier the user's case names, sent to the public
 *   register that answers for it: NIP, REGON and KRS to KRS, the VAT white
 *   list, CEIDG and SUDOP; an account number to the white list. The token is
 *   replaced with its value here and the disclosure is audited.
 * - A personal identifier in clear text (PESEL, ID card, passport, e-mail,
 *   phone, payment card, land register, plate, birth date) never leaves, even
 *   when the recognizer missed it in the chat.
 */
const REGISTRY_IDENTIFIERS = {
    krs: new Set(["KRS", "NIP", "REGON"]),
    wl: new Set(["NIP", "REGON", "IBAN"]),
    ceidg: new Set(["NIP", "REGON"]),
    sudop: new Set(["NIP"])
};
const PERSONAL_KINDS = new Set([
    "PESEL",
    "ID_CARD",
    "PASSPORT",
    "EMAIL",
    "PHONE",
    "PAYMENT_CARD",
    "LAND_REGISTRY",
    "VEHICLE_PLATE",
    "BIRTH_DATE"
]);
const TOKEN = /\[PII:([A-Z_]+):(\d{4})\]/gu;
function mapStrings(value, map) {
    if (typeof value === "string")
        return map(value);
    if (Array.isArray(value))
        return value.map((item) => mapStrings(item, map));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]));
    }
    return value;
}
/**
 * A federated call to a public register with the case's business identifiers
 * put back. `disclosed`: the kinds sent (for the audit, never the values).
 */
export function discloseRegistryIdentifiers(call, resolve) {
    const raw = typeof call.input.source === "string" ? call.input.source : call.input.sourceId;
    const source = typeof raw === "string" ? raw.toLowerCase() : "";
    const allowed = REGISTRY_IDENTIFIERS[source];
    if (!allowed)
        return { call, disclosed: [] };
    const disclosed = [];
    const input = mapStrings(call.input, (text) => text.replace(TOKEN, (token, kind) => {
        if (!allowed.has(kind))
            return token;
        const value = resolve(token);
        if (value === null)
            return token;
        disclosed.push(kind);
        return value;
    }));
    return disclosed.length ? { call: { ...call, input }, disclosed } : { call, disclosed };
}
/** Personal identifiers in clear text anywhere in a call's arguments. */
export function personalDataIn(value) {
    const texts = [];
    mapStrings(value, (text) => {
        texts.push(text);
        return text;
    });
    const kinds = new Set();
    for (const text of texts) {
        for (const span of detectIdentifiers(text)) {
            if (PERSONAL_KINDS.has(span.kind))
                kinds.add(span.kind);
        }
    }
    return [...kinds];
}
