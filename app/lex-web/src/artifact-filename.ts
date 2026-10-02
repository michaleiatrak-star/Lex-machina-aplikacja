// Name of a document made by a model, edited by the user: the stem is edited,
// the extension stays. Mirrors artifactRenameFilename in the runtime.
const WINDOWS_FORBIDDEN = /[<>:"/\\|?*\x00-\x1f\x7f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function splitArtifactFilename(filename: string): { stem: string; extension: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0
    ? { stem: filename.slice(0, dot), extension: filename.slice(dot) }
    : { stem: filename, extension: "" };
}

/** Polish message for an invalid stem, or "" when the name can be saved. */
export function artifactStemProblem(stem: string, extension: string): string {
  const value = stem.normalize("NFKC").trim();
  if (!value) return "Podaj nazwę pliku.";
  if (WINDOWS_FORBIDDEN.test(value)) {
    return "Nazwa nie może zawierać znaków \\ / : * ? \" < > |.";
  }
  if (/[. ]$/.test(value)) return "Nazwa nie może kończyć się kropką ani spacją.";
  if (WINDOWS_RESERVED.test(value.split(".")[0] ?? "")) {
    return "Ta nazwa jest zastrzeżona w systemie Windows.";
  }
  if ((value + extension).length > 180) return "Nazwa jest za długa (najwyżej 180 znaków).";
  return "";
}

export function artifactRenameErrorMessage(code: string): string {
  if (code.includes("ARTIFACT_FILENAME_CHARACTERS_INVALID")) {
    return "Nazwa nie może zawierać znaków \\ / : * ? \" < > |.";
  }
  if (code.includes("ARTIFACT_FILENAME_RESERVED_INVALID")) {
    return "Ta nazwa jest zastrzeżona w systemie Windows albo kończy się kropką.";
  }
  if (code.includes("ARTIFACT_FILENAME_TOO_LONG_INVALID")) return "Nazwa jest za długa.";
  if (code.includes("ARTIFACT_FILENAME_EMPTY_INVALID")) return "Podaj nazwę pliku.";
  if (code.includes("ARTIFACT_NOT_FOUND")) return "Nie znaleziono dokumentu w aktach sprawy.";
  if (code.includes("CASE_ACCESS_DENIED") || code.includes("CASE_ARCHIVED")) {
    return "Brak uprawnień do zmiany nazwy w tej sprawie.";
  }
  return `Nie udało się zmienić nazwy: ${code}`;
}
