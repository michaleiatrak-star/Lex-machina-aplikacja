// Kinds of documents a firm template is for, and the firm's default template per
// kind: when a user asks to draft a document of that kind without picking a
// template, the application uses the firm's default (layout, fixed formulas and,
// for a generated file, its styles).
export const TEMPLATE_KINDS = [
    // Most specific first.
    { id: "odpowiedz_na_pozew", label: "Odpowiedź na pozew", documentType: "pleading", words: /odpowied\p{L}*\s+na\s+poz(?:ew|w)/iu },
    { id: "apelacja", label: "Apelacja", documentType: "pleading", words: /apelacj/iu },
    { id: "zazalenie", label: "Zażalenie", documentType: "pleading", words: /zażaleni/iu },
    { id: "sprzeciw", label: "Sprzeciw / zarzuty", documentType: "pleading", words: /sprzeciw|zarzut\p{L}*\s+od\s+nakazu/iu },
    { id: "pozew", label: "Pozew", documentType: "pleading", words: /(?<![\p{L}])poz(?:ew|wu|wem|wy)(?![\p{L}])/iu },
    { id: "wniosek", label: "Wniosek / pismo procesowe", documentType: "pleading", words: /wnios(?:ek|ku)|pism\p{L}*\s+procesow/iu },
    { id: "wezwanie", label: "Wezwanie", documentType: "letter", words: /wezwani/iu },
    { id: "regulamin", label: "Regulamin", documentType: "contract", words: /regulamin/iu },
    { id: "umowa", label: "Umowa", documentType: "contract", words: /(?<![\p{L}])umow/iu },
    { id: "opinia", label: "Opinia prawna", documentType: "opinion", words: /opini\p{L}*\s+prawn/iu },
    { id: "pelnomocnictwo", label: "Pełnomocnictwo", documentType: "other", words: /pełnomocnictw/iu },
    { id: "pismo", label: "Pismo / list", documentType: "letter", words: /(?<![\p{L}])(?:pism[oa]|list)(?![\p{L}])/iu },
    { id: "inne", label: "Inny dokument", documentType: "other", words: null }
];
const FAMILY_KIND = {
    pleading: "pozew",
    contract: "umowa",
    opinion: "opinia",
    letter: "pismo",
    report: null,
    other: "inne"
};
export function validTemplateRole(value) {
    if (!value || typeof value !== "object")
        return null;
    const raw = value;
    const kind = TEMPLATE_KINDS.find((item) => item.id === raw.kind)?.id;
    return kind ? { kind, isDefault: raw.isDefault === true } : null;
}
const DRAFTING = /(?<![\p{L}])(?:napisz|przygotuj|sporządź|zredaguj|wygeneruj|stwórz|opracuj|utwórz|zrób|projekt\p{L}*)(?![\p{L}])/iu;
/** The kind of document the user asks to draft, or null when the message is not a drafting request. */
export function draftingTarget(question, documentType) {
    const drafting = DRAFTING.exec(question);
    if (drafting) {
        const after = question.slice(drafting.index);
        const kind = TEMPLATE_KINDS.find((item) => item.words?.test(after));
        if (kind)
            return kind.id;
    }
    // A generation request names only the family (pleading, contract...): its basic kind.
    return documentType ? FAMILY_KIND[documentType] : null;
}
/** The firm's default template for the kind (a family's default as the fallback). */
export function defaultTemplateFor(templates, kind) {
    const exact = templates.find((template) => template.role?.isDefault && template.role.kind === kind);
    if (exact)
        return exact;
    const family = TEMPLATE_KINDS.find((item) => item.id === kind)?.documentType;
    return (templates.find((template) => template.role?.isDefault && TEMPLATE_KINDS.find((item) => item.id === template.role.kind)?.documentType === family && family !== "other") ?? null);
}
