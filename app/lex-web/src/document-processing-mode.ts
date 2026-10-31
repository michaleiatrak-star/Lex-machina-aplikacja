/**
 * How one file is processed; the user picks it per file. Nothing runs on upload. The local
 * vision model re-reads doubtful OCR lines; the local text model (e.g. Bielik) only helps
 * with personal-data detection - never with the legal answer.
 */
export type DocumentProcessingMode =
  | "OCR"
  | "OCR_AI"
  | "ANONYMIZE"
  | "ANONYMIZE_AI"
  // A scan or photo sent to the model as it is (no OCR, no masking), with the next message.
  | "IMAGE_DIRECT";

export const DOCUMENT_PROCESSING_MODES: ReadonlyArray<{
  mode: DocumentProcessingMode;
  label: string;
  title: string;
}> = [
  {
    mode: "ANONYMIZE",
    label: "OCR + anonimizacja",
    title: "Tekst i OCR stron bez warstwy tekstowej, dane osobowe zastąpione symbolami; osobny zaszyfrowany klucz dokumentu."
  },
  {
    mode: "ANONYMIZE_AI",
    label: "OCR + anonimizacja z AI",
    title: "Jak wyżej, a model wizyjny ponownie czyta niepewne linie skanu, potem model tekstowy (uruchamiany sam przed anonimizacją) podpowiada przy danych osobowych. Wymaga zainstalowanych modeli lokalnych."
  },
  {
    mode: "OCR",
    label: "Tylko OCR",
    title: "Sam tekst i OCR, bez anonimizacji: do modelu trafia tekst jawny z danymi osobowymi."
  },
  {
    mode: "OCR_AI",
    label: "Tylko OCR z korektą AI",
    title: "Tekst i OCR, a model wizyjny ponownie czyta niepewne linie skanu; modele tekstowe są na ten czas zatrzymywane. Bez anonimizacji - tekst jawny. Wymaga zainstalowanego modelu wizyjnego."
  }
];

// The user decides per image: a photo of a document reads best as OCR text (anonymized);
// a photo of a scene (an accident, a road sign, damage) is worth only as an image.
export const IMAGE_DIRECT_MODE = {
  mode: "IMAGE_DIRECT" as const,
  label: "Obraz do modelu (bez OCR)",
  title:
    "Obraz trafia do modelu w oryginale z następną wiadomością: bez OCR i bez anonimizacji (dane osobowe na obrazie będą widoczne dla modelu). Dla zdjęć sytuacji (wypadek, znak, uszkodzenie); zdjęcie dokumentu lepiej przetworzyć OCR. Plik nie jest zapisywany w sprawie."
};

/** PNG and JPEG can go to the model as they are; other files need processing. */
export function directImageType(file: { name: string; type: string }): "image/png" | "image/jpeg" | null {
  if (file.type === "image/png" || /\.png$/iu.test(file.name)) return "image/png";
  if (file.type === "image/jpeg" || /\.jpe?g$/iu.test(file.name)) return "image/jpeg";
  return null;
}

/** The ways one file can be handled: an image may also go to the model as it is. */
export function processingModesFor(file: { name: string; type: string }): ReadonlyArray<{ mode: DocumentProcessingMode; label: string; title: string }> {
  return directImageType(file) ? [...DOCUMENT_PROCESSING_MODES, IMAGE_DIRECT_MODE] : DOCUMENT_PROCESSING_MODES;
}

export const DEFAULT_DOCUMENT_PROCESSING_MODE: DocumentProcessingMode = "ANONYMIZE";

/** The local text model (detection of personal data); started by the runtime when needed. */
export function processingModeUsesLocalAi(mode: DocumentProcessingMode): boolean {
  return mode === "ANONYMIZE_AI";
}

/** The local vision model (doubtful OCR lines). */
export function processingModeUsesVision(mode: DocumentProcessingMode): boolean {
  return mode === "ANONYMIZE_AI" || mode === "OCR_AI";
}

/** Without anonymization the text goes to models in clear. */
export function processingModeKeepsClearText(mode: DocumentProcessingMode): boolean {
  return mode === "OCR" || mode === "OCR_AI";
}

/** Options for the runtime: localAi = AI personal-data check, ocrFix = AI OCR correction. */
export function processingModeOptions(
  mode: DocumentProcessingMode
): { localAi?: true; ocrFix?: boolean } | undefined {
  switch (mode) {
    case "ANONYMIZE_AI":
      return { localAi: true, ocrFix: true };
    case "OCR_AI":
      return { ocrFix: true };
    default:
      return undefined;
  }
}

export function processingModeLabel(mode: DocumentProcessingMode): string {
  return [...DOCUMENT_PROCESSING_MODES, IMAGE_DIRECT_MODE].find((item) => item.mode === mode)?.label ?? mode;
}
