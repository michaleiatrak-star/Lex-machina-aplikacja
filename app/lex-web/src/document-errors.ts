import { ApiError } from "./api.js";

// A failed file in plain Polish: what happened and what the user can do. The technical
// code stays available for the details view, never as the only message.
export type DocumentFailure = {
  message: string;
  code: string;
  // Trying the same file again can help (transport, timeout, busy engine).
  retryable: boolean;
};

const MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  DOCUMENT_BODY_REQUIRED: {
    message: "Plik dotarł do programu pusty. Spróbuj ponownie albo wybierz plik jeszcze raz.",
    retryable: true
  },
  FILE_BODY_REQUIRED: {
    message: "Plik dotarł do programu pusty. Spróbuj ponownie albo wybierz plik jeszcze raz.",
    retryable: true
  },
  UNSUPPORTED_DOCUMENT_MEDIA_TYPE: {
    message: "Tego rodzaju pliku nie można odczytać. Obsługiwane są PDF, DOCX, ODT, arkusze, pliki tekstowe, zdjęcia i ZIP.",
    retryable: false
  },
  CASE_STORAGE_NOT_READY: {
    message: "Najpierw wybierz albo utwórz sprawę, do której trafi plik.",
    retryable: false
  },
  CASE_ID_REQUIRED: {
    message: "Najpierw wybierz albo utwórz sprawę, do której trafi plik.",
    retryable: false
  },
  DOCUMENT_INGESTION_UNAVAILABLE: {
    message: "Odczyt dokumentów jest teraz niedostępny. Uruchom program ponownie i spróbuj jeszcze raz.",
    retryable: true
  },
  TOO_MANY_DOCUMENT_ATTACHMENTS: {
    message: "Wybrano za dużo plików naraz. Dodaj je w mniejszych częściach.",
    retryable: false
  },
  HTTP_413: {
    message: "Plik jest za duży do odczytania w programie.",
    retryable: false
  }
};

export const OCR_MODELS_INCOMPLETE =
  "Instalacja programu nie została dokończona: brakuje części modeli OCR. Uruchom instalator Lex Machina ponownie i poczekaj, aż się zakończy (pobierze tylko brakujące modele).";

export function documentFailure(cause: unknown): DocumentFailure {
  const code =
    cause instanceof ApiError
      ? cause.code
      : cause instanceof Error
        ? cause.message
        : String(cause || "DOCUMENT_REVIEW_FAILED");
  const known = MESSAGES[code];
  if (known) return { code, ...known };
  if (code.startsWith("DESKTOP_RUNTIME_PROXY_FAILED")) {
    return {
      code,
      message: "Odczyt pliku trwał zbyt długo i został przerwany. Spróbuj ponownie; duże skany warto dzielić na części.",
      retryable: true
    };
  }
  if (code.startsWith("DOCUMENT_") && /LIMIT|TOO_LARGE|PAGES/u.test(code)) {
    return { code, message: "Dokument przekracza limity odczytu (rozmiar lub liczba stron).", retryable: false };
  }
  // An installation cut short while downloading the OCR models: retrying cannot help,
  // running the installer again downloads only what is missing.
  const description = cause instanceof ApiError ? cause.description ?? "" : "";
  if (code === "OCR_MODELS_INCOMPLETE" || description.includes("OCR_MODELS_INCOMPLETE")) {
    return { code, message: OCR_MODELS_INCOMPLETE, retryable: false };
  }
  const detail = cause instanceof ApiError && cause.description ? ` ${cause.description}` : "";
  return {
    code,
    message: `Nie udało się odczytać pliku.${detail} Spróbuj ponownie albo pomiń ten plik.`,
    retryable: true
  };
}

const CONFIRM_REASONS: Record<string, string> = {
  OVERLAPPING_PRIVACY_DIRECTIVES: "dwa Twoje zaznaczenia nachodzą na siebie. Cofnij jedno z nich (kliknij je) i zatwierdź ponownie.",
  INVALID_PRIVACY_DIRECTIVE_RANGE: "zaznaczenie wychodzi poza tekst strony (tekst mógł się zmienić). Zaznacz fragment jeszcze raz.",
  INVALID_PRIVACY_DIRECTIVE_LABEL: "etykieta zaznaczenia jest pusta albo za długa (do 120 znaków).",
  INVALID_PRIVACY_DIRECTIVE_PAGE: "zaznaczenie wskazuje stronę, której nie ma w dokumencie. Zaznacz fragment jeszcze raz."
};

/** Why confirming a privacy preview failed, in plain Polish (the preview stays open). */
export function privacyConfirmFailure(cause: unknown): string {
  const reason = cause instanceof ApiError ? cause.reason ?? "" : "";
  const code = cause instanceof ApiError ? cause.code : cause instanceof Error ? cause.message : String(cause);
  const known = CONFIRM_REASONS[reason] ?? CONFIRM_REASONS[code];
  if (known) return `Nie zatwierdzono: ${known}`;
  if (code.startsWith("DESKTOP_RUNTIME_PROXY_FAILED")) return "Nie zatwierdzono: zapis trwał zbyt długo. Spróbuj ponownie.";
  return `Nie zatwierdzono pliku. Spróbuj ponownie. Kod: ${reason || code}`;
}

