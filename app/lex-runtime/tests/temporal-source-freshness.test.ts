import { describe, expect, it } from "vitest";
import { entryStages, partEntryDates } from "../src/amendment-applicability.js";
import {
  TemporalSourceFreshnessChecker,
  amendmentHasEntryIntoForceExceptions,
  amendmentMentionsArticle,
  amendmentPartFor,
  actCitationKey,
  transitionalProvisions
} from "../src/temporal-source-freshness.js";
import {
  DeterministicLegalActResolver
} from "../src/legal-act-resolver.js";

const kc =
  new DeterministicLegalActResolver().resolve("KC");

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function fixtureFetcher(options?: {
  currentEli?: string;
  textHTML?: boolean;
  textPDF?: boolean;
  relationStatus?: string;
  metadataStatus?: string;
  amendments?: Array<{
    eli: string;
    relationDate: string;
    promulgation?: string;
    entryIntoForce?: string;
    comments?: string;
  }>;
  amendmentTexts?: Record<string, string>;
  amendmentTextHTML?: boolean;
}) {
  const currentEli =
    options?.currentEli ?? "DU/2026/795";
  const amendments = options?.amendments ?? [];

  return async (input: string | URL): Promise<Response> => {
    const url = String(input);

    if (url.endsWith("/DU/1964/93/references")) {
      return jsonResponse({
        "Inf. o tekście jednolitym": [{
          act: {
            ELI: currentEli,
            year: Number(currentEli.split("/")[1]),
            pos: Number(currentEli.split("/")[2]),
            status:
              options?.relationStatus ??
              "obowiązujący"
          }
        }],
        "Akty zmieniające": amendments.map(
          (item) => ({
            act: {
              ELI: item.eli,
              date: item.relationDate,
              promulgation:
                item.promulgation ??
                item.relationDate,
              displayAddress: item.eli,
              title: "Ustawa zmieniająca"
            }
          })
        )
      });
    }

    if (url.endsWith("/references")) {
      return jsonResponse({
        "Nowelizacje po tekście jednolitym":
          amendments.map((item) => ({
            act: {
              ELI: item.eli,
              date: item.relationDate,
              promulgation:
                item.promulgation ??
                item.relationDate,
              displayAddress: item.eli,
              title: "Ustawa zmieniająca"
            }
          }))
      });
    }

    const amendmentText =
      amendments.find((item) =>
        url.endsWith(
          "/" +
            item.eli +
            "/text.html"
        )
      );

    if (amendmentText) {
      return new Response(
        options?.amendmentTexts?.[
          amendmentText.eli
        ] ??
          "<html><body>Art. 1. Zmiana innej jednostki.</body></html>",
        {
          status: 200,
          headers: {
            "content-type":
              "text/html; charset=utf-8"
          }
        }
      );
    }

    const amendmentPdf =
      amendments.find((item) =>
        url.endsWith(
          "/" +
            item.eli +
            "/text.pdf"
        )
      );

    if (amendmentPdf) {
      return new Response(
        new Uint8Array(
          [37, 80, 68, 70]
        ),
        {
          status: 200,
          headers: {
            "content-type":
              "application/pdf"
          }
        }
      );
    }

    const amendment =
      amendments.find((item) =>
        url.endsWith("/" + item.eli)
      );

    if (amendment) {
      return jsonResponse({
        ELI: amendment.eli,
        promulgation:
          amendment.promulgation ??
          amendment.relationDate,
        textHTML:
          options?.amendmentTextHTML ??
          true,
        textPDF: true,
        ...(amendment.entryIntoForce
          ? {
              entryIntoForce:
                amendment.entryIntoForce
            }
          : {}),
        ...(amendment.comments ? { comments: amendment.comments } : {})
      });
    }

    return jsonResponse({
      ELI: currentEli,
      status:
        options?.metadataStatus ??
        "obowiązujący",
      promulgation: "2026-06-17",
      textHTML: options?.textHTML ?? true,
      textPDF: options?.textPDF ?? true
    });
  };
}

function historicalFetcher(options?: {
  amendmentDate?: string;
  amendmentText?: string;
}) {
  return async (input: string | URL): Promise<Response> => {
    const url = String(input);

    if (url.endsWith("/DU/1964/93/references")) {
      return jsonResponse({
        "Inf. o tekście jednolitym": [
          {
            act: {
              ELI: "DU/2019/1145",
              year: 2019,
              pos: 1145,
              status: "uznany za uchylony"
            }
          },
          {
            act: {
              ELI: "DU/2026/795",
              year: 2026,
              pos: 795,
              status: "obowiązujący"
            }
          }
        ],
        "Akty zmieniające": options?.amendmentDate
          ? [{
              act: {
                ELI: "DU/2020/1000",
                date: options.amendmentDate,
                displayAddress: "Dz.U. 2020 poz. 1000",
                title: "Ustawa zmieniająca"
              }
            }]
          : []
      });
    }

    if (url.endsWith("/DU/1964/93")) {
      return jsonResponse({
        ELI: "DU/1964/93",
        status: "obowiązujący",
        entryIntoForce: "1965-01-01",
        repealDate: "2021-01-01",
        promulgation: "1964-05-18"
      });
    }

    if (url.endsWith("/DU/2019/1145")) {
      return jsonResponse({
        ELI: "DU/2019/1145",
        status: "uznany za uchylony",
        legalStatusDate: "2019-06-01",
        repealDate: "2021-01-01",
        promulgation: "2019-06-19",
        textHTML: true,
        textPDF: true
      });
    }

    if (url.endsWith("/DU/2026/795")) {
      return jsonResponse({
        ELI: "DU/2026/795",
        status: "obowiązujący",
        legalStatusDate: "2026-05-20",
        promulgation: "2026-06-17",
        textHTML: true,
        textPDF: true
      });
    }

    if (options?.amendmentText && url.endsWith("/DU/2020/1000/text.html")) {
      return new Response(options.amendmentText, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (
      options?.amendmentDate &&
      url.endsWith("/DU/2020/1000")
    ) {
      return jsonResponse({
        ELI: "DU/2020/1000",
        promulgation: "2020-01-10",
        entryIntoForce:
          options.amendmentDate,
        ...(options.amendmentText ? { textHTML: true } : {})
      });
    }

    if (url.endsWith("/references")) {
      return jsonResponse({});
    }

    throw new Error("Unexpected historical fixture URL: " + url);
  };
}

describe("TemporalSourceFreshnessChecker", () => {
  it("returns CURRENT only for the pinned in-force t.j. with no later amendments", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher(),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc);

    expect(result).toMatchObject({
      status: "CURRENT",
      mode: "CURRENT",
      currentEli: "DU/2026/795",
      sourceUrl:
        "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.html",
      amendmentsAfter: []
    });
  });

  it("a newer in-force t.j. replaces the pinned one: its text is the source", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        currentEli: "DU/2027/10"
      })
    ).check(kc);

    expect(result).toMatchObject({
      status: "CURRENT",
      mode: "CURRENT",
      currentEli: "DU/2027/10",
      pinnedSuperseded: true,
      sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2027/10/text.html",
      reason: "PINNED_TJ_SUPERSEDED_CURRENT_TJ_USED"
    });
  });

  it("does not treat the base-act text.html as a current unified text after post-t.j. amendments", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/999",
          relationDate: "2026-07-01",
          promulgation: "2026-06-20",
          entryIntoForce: "2026-07-01"
        }]
      })
    ).check(kc);

    expect(result).toMatchObject({
      status:
        "POST_TJ_AMENDMENTS",
      reason:
        "EFFECTIVE_AMENDMENTS_AFTER_CONSOLIDATED_TEXT"
    });
    expect(result.sourceUrl).toBeUndefined();
  });

  it("keeps an exact article current when every effective post-t.j. amendment provably leaves it untouched", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/999",
          relationDate: "2026-07-01",
          promulgation: "2026-06-20",
          entryIntoForce: "2026-07-01"
        }],
        amendmentTexts: {
          "DU/2026/999":
            "<html><body>Art. 1. W art. 191 § 1 wyrazy X zastępuje się wyrazami Y.</body></html>"
        }
      })
    ).check(kc, {
      claim: "art. 190a KK"
    });

    expect(result).toMatchObject({
      status: "CURRENT",
      currentEli:
        "DU/2026/795",
      sourceUrl:
        "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.html",
      reason:
        "POST_TJ_AMENDMENTS_DO_NOT_TOUCH_REQUESTED_ARTICLE"
    });
  });

  it("inspects a PDF-only effective amendment before keeping an exact article current", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/999",
          relationDate: "2026-07-01",
          promulgation: "2026-06-20",
          entryIntoForce: "2026-07-01"
        }],
        amendmentTextHTML: false
      }),
      () => "2026-09-15T20:00:00.000Z",
      undefined,
      {
        async extract(data) {
          expect(
            data.byteLength
          ).toBeGreaterThan(0);
          return {
            text:
              "USTAWA zmieniająca\nArt. 1. W art. 191 § 1 wyrazy X zastępuje się wyrazami Y.",
            pages: 1,
            bytes:
              data.byteLength
          };
        }
      }
    ).check(kc, {
      claim: "art. 190a KK"
    });

    expect(result).toMatchObject({
      status: "CURRENT",
      currentEli:
        "DU/2026/795",
      reason:
        "POST_TJ_AMENDMENTS_DO_NOT_TOUCH_REQUESTED_ARTICLE"
    });
  });

  it("fails closed when an effective post-t.j. amendment touches the requested article", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/999",
          relationDate: "2026-07-01",
          promulgation: "2026-06-20",
          entryIntoForce: "2026-07-01"
        }],
        amendmentTexts: {
          "DU/2026/999":
            "<html><body>Art. 1. W art. 190a § 1 wyrazy X zastępuje się wyrazami Y.</body></html>"
        }
      })
    ).check(kc, {
      claim: "art. 190a KK"
    });

    expect(result).toMatchObject({
      status:
        "POST_TJ_AMENDMENTS",
      reason:
        "POST_TJ_AMENDMENT_TOUCHES_REQUESTED_ARTICLE"
    });
  });

  it("does not block current law solely for a future amendment", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/1001",
          relationDate: "2026-10-01",
          promulgation: "2026-07-15",
          entryIntoForce: "2026-10-01"
        }]
      }),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc);

    expect(result.status).toBe("CURRENT");
    expect(result.amendmentApplicability).toEqual([
      expect.objectContaining({
        eli: "DU/2026/1001",
        status: "FUTURE",
        effectiveFrom: "2026-10-01"
      })
    ]);
  });

  it("liczy dzień wejścia noweli w życie w czasie polskim, nie w UTC", async () => {
    // 00:30 w Warszawie 1.07.2026, w UTC jeszcze 30.06.2026.
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/999",
          relationDate: "2026-07-01",
          promulgation: "2026-06-20",
          entryIntoForce: "2026-07-01"
        }]
      }),
      () => "2026-06-30T22:30:00.000Z"
    ).check(kc);

    expect(result.status).toBe("POST_TJ_AMENDMENTS");

    const historical = await new TemporalSourceFreshnessChecker(
      historicalFetcher(),
      () => "2026-06-30T22:30:00.000Z"
    ).check(kc, { asOf: "2026-06-30" });
    expect(historical.status).not.toBe("INVALID_HISTORICAL_DATE");
  });

  it("rozpoznaje artykuł w zakresie i wyliczeniu w tekście noweli", () => {
    expect(amendmentMentionsArticle("uchyla się art. 10–15;", "12")).toBe(true);
    expect(amendmentMentionsArticle("uchyla się art. 10-15;", "12a")).toBe(true);
    expect(amendmentMentionsArticle("uchyla się art. 10 do 15;", "15")).toBe(true);
    expect(amendmentMentionsArticle("art. 10, 11 i 12 otrzymują brzmienie", "11")).toBe(true);
    expect(amendmentMentionsArticle("w art. 10 oraz 14 wyrazy", "14")).toBe(true);
    expect(amendmentMentionsArticle("uchyla się art. 10–15;", "15a")).toBe(false);
    expect(amendmentMentionsArticle("uchyla się art. 10–15;", "1")).toBe(false);
    // Po "§" kolejne liczby to paragrafy, nie artykuły.
    expect(amendmentMentionsArticle("w art. 10 § 2 i 3 otrzymują brzmienie", "3")).toBe(false);
    // Zakres z odwróconymi granicami: nie wiadomo.
    expect(amendmentMentionsArticle("uchyla się art. 15–10;", "12")).toBeNull();
  });

  it("fails closed when a post-t.j. amendment repeals a range containing the requested article", async () => {
    for (const text of [
      "<html><body>Art. 1. Uchyla się art. 188–192.</body></html>",
      "<html><body>Art. 1. Art. 189, 190a i 191 otrzymują brzmienie:</body></html>"
    ]) {
      const result = await new TemporalSourceFreshnessChecker(
        fixtureFetcher({
          amendments: [{
            eli: "DU/2026/999",
            relationDate: "2026-07-01",
            promulgation: "2026-06-20",
            entryIntoForce: "2026-07-01"
          }],
          amendmentTexts: { "DU/2026/999": text }
        }),
        () => "2026-09-15T20:00:00.000Z"
      ).check(kc, { claim: "art. 190a KK" });

      expect(result).toMatchObject({
        status: "POST_TJ_AMENDMENTS",
        reason: "POST_TJ_AMENDMENT_TOUCHES_REQUESTED_ARTICLE"
      });
    }
  });

  it("nowela ogłoszona, wchodząca w życie później, z wyjątkiem dla artykułu: UNKNOWN zamiast CURRENT", async () => {
    const check = (text: string) =>
      new TemporalSourceFreshnessChecker(
        fixtureFetcher({
          amendments: [{
            eli: "DU/2026/1001",
            relationDate: "2027-01-01",
            promulgation: "2026-09-01",
            entryIntoForce: "2027-01-01"
          }],
          amendmentTexts: { "DU/2026/1001": text }
        }),
        () => "2026-09-15T20:00:00.000Z"
      ).check(kc, { claim: "art. 190a KK" });

    const exception = await check(
      "<html><body>Art. 1. W art. 190a § 1 wyrazy X zastępuje się wyrazami Y. Art. 2. Ustawa wchodzi w życie z dniem 1 stycznia 2027 r., z wyjątkiem art. 1, który wchodzi w życie po upływie 14 dni od dnia ogłoszenia.</body></html>"
    );
    expect(exception).toMatchObject({
      status: "AMENDMENT_EFFECT_DATE_UNKNOWN",
      reason: "FUTURE_AMENDMENT_ARTICLE_EFFECT_DATE_UNKNOWN"
    });

    // Jedna data wejścia w życie dla całej noweli: dziś obowiązuje brzmienie sprzed zmiany.
    const single = await check(
      "<html><body>Art. 1. W art. 190a § 1 wyrazy X zastępuje się wyrazami Y. Art. 2. Ustawa wchodzi w życie z dniem 1 stycznia 2027 r.</body></html>"
    );
    expect(single.status).toBe("CURRENT");

    // Wyjątek dotyczy innej jednostki, której artykuł nie jest powołany.
    const other = await check(
      "<html><body>Art. 1. W art. 191 § 1 wyrazy X zastępuje się wyrazami Y. Art. 2. Ustawa wchodzi w życie z dniem 1 stycznia 2027 r., z wyjątkiem art. 1, który wchodzi w życie z dniem ogłoszenia.</body></html>"
    );
    expect(other.status).toBe("CURRENT");

    expect(amendmentHasEntryIntoForceExceptions("ustawa wchodzi w życie z dniem 1 stycznia 2027 r.")).toBe(false);
  });

  it("każde zapytanie do ELI ma limit czasu (AbortSignal)", async () => {
    const signals: unknown[] = [];
    const base = fixtureFetcher({
      amendments: [{
        eli: "DU/2026/999",
        relationDate: "2026-07-01",
        promulgation: "2026-06-20",
        entryIntoForce: "2026-07-01"
      }]
    });
    await new TemporalSourceFreshnessChecker(
      async (input, init) => {
        signals.push(init?.signal);
        return base(input);
      },
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc, { claim: "art. 190a KK" });

    expect(signals.length).toBeGreaterThan(3);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("blocks when an amendment effect date cannot be established", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{
          eli: "DU/2026/1002",
          relationDate: "",
          promulgation: "2026-07-15"
        }]
      }),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc);

    expect(result).toMatchObject({
      status: "AMENDMENT_EFFECT_DATE_UNKNOWN",
      reason: "OFFICIAL_AMENDMENT_EFFECT_DATE_UNKNOWN"
    });
    expect(result.amendmentApplicability).toEqual([
      expect.objectContaining({
        eli: "DU/2026/1002",
        status: "UNKNOWN"
      })
    ]);
  });

  it("blocks when the pinned consolidated text is repealed in ELI references", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        relationStatus: "wygaśnięcie aktu"
      })
    ).check(kc);

    expect(result).toMatchObject({
      status: "REPEALED_CONSOLIDATED_TEXT",
      mode: "CURRENT",
      reason: "PINNED_CONSOLIDATED_TEXT_REPEALED"
    });
  });

  it("blocks when current act metadata reports repeal", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        metadataStatus: "uchylony"
      })
    ).check(kc);

    expect(result).toMatchObject({
      status: "REPEALED_CONSOLIDATED_TEXT",
      mode: "CURRENT",
      currentEli: "DU/2026/795",
      reason: "CURRENT_CONSOLIDATED_TEXT_REPEALED"
    });
  });

  it("allows a repealed historical t.j. only for a date when the base act and that t.j. were in force", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      historicalFetcher(),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc, {
      asOf: "2020-06-01"
    });

    expect(result).toMatchObject({
      status: "HISTORICAL",
      mode: "HISTORICAL",
      requestedAsOf: "2020-06-01",
      currentEli: "DU/2019/1145",
      sourceUrl:
        "https://api.sejm.gov.pl/eli/acts/DU/2019/1145/text.html",
      actValidFrom: "1965-01-01",
      actValidTo: "2021-01-01"
    });
  });

  it("keeps repeal red when the requested historical date is after the act ceased to be in force", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      historicalFetcher(),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc, {
      asOf: "2021-01-01"
    });

    expect(result).toMatchObject({
      status: "ACT_NOT_IN_FORCE_AT_DATE",
      mode: "HISTORICAL",
      requestedAsOf: "2021-01-01",
      reason: "BASE_ACT_NOT_IN_FORCE_AT_AS_OF"
    });
  });

  it("blocks a historical t.j. when a later amendment was already effective by asOf", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      historicalFetcher({
        amendmentDate: "2020-01-15"
      }),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc, {
      asOf: "2020-06-01"
    });

    expect(result).toMatchObject({
      status: "HISTORICAL_POST_TJ_AMENDMENTS",
      mode: "HISTORICAL",
      currentEli: "DU/2019/1145"
    });
  });

  it("historical t.j.: an amendment before asOf that leaves the cited article untouched does not block it", async () => {
    const amendmentText = "<html><body>Art. 1. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny w art. 20 § 1 otrzymuje brzmienie: „§ 1. …”.</body></html>";
    const checker = new TemporalSourceFreshnessChecker(historicalFetcher({ amendmentDate: "2020-01-15", amendmentText }), () => "2026-09-15T20:00:00.000Z");
    expect(await checker.check(kc, { asOf: "2020-06-01", claim: "art. 10 KC" })).toMatchObject({
      status: "HISTORICAL",
      reason: "HISTORICAL_POST_TJ_AMENDMENTS_DO_NOT_TOUCH_REQUESTED_ARTICLE"
    });
    expect(await checker.check(kc, { asOf: "2020-06-01", claim: "art. 20 KC" })).toMatchObject({
      status: "HISTORICAL_POST_TJ_AMENDMENTS",
      reason: "HISTORICAL_AMENDMENT_TOUCHES_REQUESTED_ARTICLE"
    });
  });

  it("rejects current/future dates from the historical exception", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      historicalFetcher(),
      () => "2026-09-15T20:00:00.000Z"
    ).check(kc, {
      asOf: "2026-09-15"
    });

    expect(result).toMatchObject({
      status: "INVALID_HISTORICAL_DATE",
      mode: "HISTORICAL"
    });
  });

  it("treats an official PDF-only current text as a normal current source", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        textHTML: false,
        textPDF: true
      })
    ).check(kc);

    expect(result).toMatchObject({
      status: "CURRENT",
      mode: "CURRENT",
      currentEli: "DU/2026/795",
      sourceUrl:
        "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf"
    });
  });
});

describe("zmiana objęta t.j., a jeszcze nieobowiązująca (DU/2026/507 w t.j. KC 2026/795)", () => {
  // Excerpt of DU/2026/507: art. 2 amends KC from 1.11.2028, art. 6 the VAT act.
  const omnibus =
    "<html><body>Art. 1. W ustawie z dnia 6 marca 2018 r. o Centralnej Ewidencji i Informacji o Działalności Gospodarczej w art. 3 ust. 1a otrzymuje brzmienie: „1a. …”." +
    " Art. 2. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny (Dz. U. z 2025 r. poz. 1071) w art. 860 dodaje się § 3 i 4 w brzmieniu: „§ 3. …”." +
    " Art. 6. W ustawie z dnia 11 marca 2004 r. o podatku od towarów i usług w art. 96 po ust. 3d dodaje się ust. 3e." +
    " Art. 31. Ustawa wchodzi w życie po upływie 6 miesięcy od dnia ogłoszenia.</body></html>";
  const fetcher = () =>
    fixtureFetcher({
      amendments: [{ eli: "DU/2026/507", relationDate: "2028-11-01", promulgation: "2026-04-13", entryIntoForce: "2028-11-01" }],
      amendmentTexts: { "DU/2026/507": omnibus }
    });
  const today = () => "2026-10-15T10:00:00.000Z";

  it("artykuł zmieniony w części noweli dotyczącej KC: weryfikacja tylko brzmienia z odnośników t.j.", async () => {
    const result = await new TemporalSourceFreshnessChecker(fetcher(), today).check(kc, { claim: "art. 860 § 3 KC" });
    // The verifier then requires the footnotes to give today's wording (legal-source-wording tests).
    expect(result).toMatchObject({ status: "CURRENT", pendingWordingAmendments: ["DU/2026/507"] });
  });

  it("numer artykułu z części zmieniającej inną ustawę (VAT art. 96) nie blokuje art. 96 KC", async () => {
    const result = await new TemporalSourceFreshnessChecker(fetcher(), today).check(kc, { claim: "art. 96 KC" });
    expect(result.status).toBe("CURRENT");
  });
});

describe("część noweli zmieniająca dany akt", () => {
  it("wycina jednostkę „W ustawie … – Kodeks cywilny”, bez innych ustaw", () => {
    const body = [
      "Art. 1. W ustawie z dnia 6 marca 2018 r. o Centralnej Ewidencji w art. 860 wyrazy …",
      "Art. 2. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cy-\nwilny w art. 860 dodaje się § 3.",
      "Art. 3. W ustawie z dnia 11 marca 2004 r. o podatku od towarów i usług w art. 96 …"
    ].join("\n");
    expect(amendmentPartFor(body, "Kodeks cywilny")).toBe("Art. 2. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cy-\nwilny w art. 860 dodaje się § 3.\n");
    expect(amendmentPartFor(body, "Obwieszczenie Marszałka Sejmu w sprawie ogłoszenia jednolitego tekstu ustawy o podatku od towarów i usług")).toContain("art. 96");
    // A single-act amendment or an unknown act: the whole text.
    expect(amendmentPartFor(body, "ustawa o czymś innym zupełnie")).toBe(body);
    expect(actCitationKey("Obwieszczenie … w sprawie ogłoszenia jednolitego tekstu ustawy – Prawo wodne")).toBe("prawo wodne");
  });
});

describe("wejście w życie etapami (pole comments w ELI)", () => {
  // DU/2026/507 in force since 14.10.2026, art. 2 (the KC part) only from 1.11.2028.
  const comments = [
    "1) art. 1 pkt 2 lit. a, pkt 46 i 53 w zakresie art. 64 ust. 2 wchodzą w życie z dniem 21 kwietnia 2026 r.;",
    "2) art. 1 pkt 4 lit. a tiret pierwsze, pkt 43 lit. a, art. 8, art. 22 i art. 29 wchodzą w życie z dniem 1 listopada 2026 r.;",
    "3) art. 3 pkt 1 lit. a oraz pkt 2 wchodzą w życie z dniem 18 grudnia 2026 r.;",
    "4) art. 1 pkt 1, pkt 2 lit. c, art. 2, art. 3 pkt 1 lit. b, art. 4-6, art. 9, art. 26-28 i art. 30 wchodzą w życie z dniem 1 listopada 2028 r."
  ].join("\n");
  const omnibus =
    "<html><body>Art. 1. W ustawie z dnia 6 marca 2018 r. o Centralnej Ewidencji i Informacji o Działalności Gospodarczej w art. 3 ust. 1a otrzymuje brzmienie: „1a. …”." +
    " Art. 2. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny (Dz. U. z 2025 r. poz. 1071) w art. 860 dodaje się § 3 i 4 w brzmieniu: „§ 3. …”." +
    " Art. 31. Ustawa wchodzi w życie po upływie 6 miesięcy od dnia ogłoszenia, z wyjątkiem: 1) art. 1 pkt 2…</body></html>";
  const today = () => "2026-10-16T10:00:00.000Z";

  it("terminy z comments; daty części noweli dla jej artykułu", () => {
    const stages = entryStages(comments);
    expect(stages.map((stage) => stage.date)).toEqual(["2026-04-21", "2026-11-01", "2026-12-18", "2028-11-01"]);
    expect(partEntryDates(stages, "2026-10-14", "2")).toEqual(["2028-11-01"]);
    expect(partEntryDates(stages, "2026-10-14", "5")).toEqual(["2028-11-01"]);
    expect(partEntryDates(stages, "2026-10-14", "1")).toEqual(["2026-04-21", "2026-10-14", "2026-11-01", "2028-11-01"]);
    expect(partEntryDates(stages, "2026-10-14", "64")).toEqual(["2026-10-14"]);
    expect(partEntryDates(stages, "2026-10-14", "7")).toEqual(["2026-10-14"]);
  });

  it("nowela w mocy, jej zmiana art. 860 KC dopiero od 2028 (ogłoszona po t.j.): brzmienie z t.j. jest aktualne", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{ eli: "DU/2026/507", relationDate: "2026-10-14", promulgation: "2026-07-13", entryIntoForce: "2026-10-14", comments }],
        amendmentTexts: { "DU/2026/507": omnibus }
      }),
      today
    ).check(kc, { claim: "art. 860 § 3 KC" });
    expect(result).toMatchObject({ status: "CURRENT", notYetForArticle: ["DU/2026/507"] });
    expect(result.pendingWordingAmendments).toBeUndefined();
  });

  it("bez terminów w comments ta sama nowela blokuje artykuł jak dotąd, z jej przepisami przejściowymi", async () => {
    const withTransitional = omnibus.replace(
      " Art. 31.",
      " Art. 25. Do umów zawartych przed dniem wejścia w życie niniejszej ustawy stosuje się przepisy dotychczasowe. Art. 31."
    );
    const result = await new TemporalSourceFreshnessChecker(
      fixtureFetcher({
        amendments: [{ eli: "DU/2026/507", relationDate: "2026-10-14", promulgation: "2026-07-13", entryIntoForce: "2026-10-14" }],
        amendmentTexts: { "DU/2026/507": withTransitional }
      }),
      today
    ).check(kc, { claim: "art. 860 § 3 KC" });
    expect(result.status).toBe("POST_TJ_AMENDMENTS");
    expect(result.transitionalProvisions).toEqual([
      { eli: "DU/2026/507", text: "art. 25. do umów zawartych przed dniem wejścia w życie niniejszej ustawy stosuje się przepisy dotychczasowe." }
    ]);
  });

  it("przepisy przejściowe: tylko jednostki z formułą intertemporalną, bez części zmieniających", () => {
    const body = "art. 1. w ustawie z dnia … w art. 5 stosuje się przepisy dotychczasowe. art. 7. postępowania wszczęte i niezakończone prowadzi się według przepisów dotychczasowych. art. 8. minister wyda rozporządzenie.";
    expect(transitionalProvisions(body)).toEqual(["art. 7. postępowania wszczęte i niezakończone prowadzi się według przepisów dotychczasowych."]);
  });
});

// KK: t.j. 2025/383 expired, t.j. 2026/1342 announced 16.10.2026 with no text in ELI yet.
function pendingTextFetcher(amendmentText: string) {
  return async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/DU/1964/93/references")) {
      return jsonResponse({
        "Inf. o tekście jednolitym": [
          { act: { ELI: "DU/2025/383", year: 2025, pos: 383, status: "wygaśnięcie aktu" } },
          { act: { ELI: "DU/2026/1342", year: 2026, pos: 1342, status: "obowiązujący" } }
        ],
        "Akty zmieniające": [{
          act: { ELI: "DU/2025/1872", date: "2026-01-29", promulgation: "2025-12-30", displayAddress: "DU/2025/1872", title: "Ustawa zmieniająca" }
        }]
      });
    }
    if (url.endsWith("/references")) return jsonResponse({});
    if (url.endsWith("/DU/2026/1342")) {
      return jsonResponse({ ELI: "DU/2026/1342", status: "obowiązujący", promulgation: "2026-10-16", textHTML: false, textPDF: false });
    }
    if (url.endsWith("/DU/2025/383")) {
      return jsonResponse({ ELI: "DU/2025/383", status: "wygaśnięcie aktu", promulgation: "2025-03-25", textHTML: true, textPDF: true });
    }
    if (url.endsWith("/DU/2025/1872")) {
      return jsonResponse({ ELI: "DU/2025/1872", promulgation: "2025-12-30", entryIntoForce: "2026-01-29", textHTML: true, textPDF: true });
    }
    if (url.endsWith("/DU/2025/1872/text.html")) {
      return new Response(amendmentText, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw new Error("Unexpected pending-text fixture URL: " + url);
  };
}

describe("najnowszy t.j. bez tekstu w ELI (KK 2026/1342)", () => {
  const descriptor = { ...kc, eli: "DU/2025/383" };

  it("brzmienie z poprzedniego t.j., gdy zmiany po nim nie dotyczą artykułu", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      pendingTextFetcher("<html><body>Art. 1. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny art. 999 otrzymuje brzmienie.</body></html>"),
      () => "2026-10-19T10:00:00.000Z"
    ).check(descriptor, { claim: "art. 5 KC" });

    expect(result).toMatchObject({
      status: "CURRENT",
      currentEli: "DU/2026/1342",
      textPendingEli: "DU/2026/1342",
      textEli: "DU/2025/383",
      sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html",
      reason: "CURRENT_TJ_TEXT_PENDING_PREVIOUS_TJ_AMENDMENTS_DO_NOT_TOUCH_ARTICLE"
    });
    expect(result.amendmentsAfter.map((item) => item.eli)).toEqual(["DU/2025/1872"]);
  });

  it("zmiana po poprzednim t.j. dotyczy artykułu: bez weryfikacji ze starego tekstu", async () => {
    const result = await new TemporalSourceFreshnessChecker(
      pendingTextFetcher("<html><body>Art. 1. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny art. 5 otrzymuje brzmienie.</body></html>"),
      () => "2026-10-19T10:00:00.000Z"
    ).check(descriptor, { claim: "art. 5 KC" });

    expect(result).toMatchObject({
      status: "POST_TJ_AMENDMENTS",
      reason: "POST_TJ_AMENDMENT_TOUCHES_REQUESTED_ARTICLE",
      textPendingEli: "DU/2026/1342"
    });
    expect(result.sourceUrl).toBeUndefined();
  });
});
