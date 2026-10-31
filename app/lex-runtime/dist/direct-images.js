export const MAX_DIRECT_IMAGES = 4;
// About 5 MB of image per file.
export const MAX_DIRECT_IMAGE_BASE64 = 7 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
/** The request's images, or null when any of them is not a PNG/JPEG within the limits. */
export function parseDirectImages(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > MAX_DIRECT_IMAGES)
        return null;
    const images = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            return null;
        const { name, mediaType, data } = item;
        if (mediaType !== "image/png" && mediaType !== "image/jpeg")
            return null;
        if (typeof data !== "string" || data.length < 16 || data.length > MAX_DIRECT_IMAGE_BASE64 || !BASE64.test(data))
            return null;
        const label = typeof name === "string" ? name.normalize("NFKC").replace(/[\r\n[\]]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120) : "";
        images.push({ name: label || "obraz", mediaType, data });
    }
    return images;
}
/** What the model is told about the images that follow the message. */
export function directImageNote(images, delivered) {
    if (!delivered) {
        return [
            "# OBRAZY PRZESŁANE BEZPOŚREDNIO — NIEDOSTARCZONE",
            `Użytkownik dołączył ${images.length === 1 ? "obraz" : `obrazy (${images.length})`}, ale wybrany model przyjmuje tylko tekst.`,
            "Powiedz to wprost i poproś o przepisanie potrzebnych fragmentów albo wybór modelu z obsługą obrazów. Nie zgaduj treści obrazu."
        ].join("\n");
    }
    return [
        "# OBRAZY PRZESŁANE BEZPOŚREDNIO (bez OCR i bez anonimizacji)",
        "Użytkownik dołączył obrazy w oryginale, w kolejności poniżej. Odczytaj z nich treść sam.",
        "Gdy fragment jest nieczytelny albo niepewny, napisz to i nie dopowiadaj go. Daty, kwoty, sygnatury i nazwiska przepisuj dokładnie tak, jak na obrazie.",
        ...images.map((image, index) => `[OBRAZ BEZPOŚREDNI ${index + 1}: ${image.name}]`)
    ].join("\n");
}
