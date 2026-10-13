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
  const detail = cause instanceof ApiError && cause.description ? ` ${cause.description}` : "";
  return {
    code,
    message: `Nie udało się odczytać pliku.${detail} Spróbuj ponownie albo pomiń ten plik.`,
    retryable: true
  };
}
