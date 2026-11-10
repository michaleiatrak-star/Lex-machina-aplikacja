import type { Express, Request, Response } from "express";
import { CaseLawPreviewService } from "../case-law-preview.js";
import { caseLawRepository } from "../case-law-store.js";
import { localOfflineMode, setLocalOfflineMode } from "../local-offline-mode.js";
import { PublicWebSearch } from "../web-search.js";
import { runWebSearchBenchmark } from "../web-search-benchmark.js";
import {
  SEARCH_ENGINES,
  effectiveSearchOrder,
  saveWebSearchTest,
  firecrawlKeyForced,
  searxngUrlForced,
  setFirecrawlApiKey,
  setGoogleSession,
  setSearxngUrl,
  webSearchSettings
} from "../web-search-settings.js";
import { DOMAIN_FALLBACK_CHOICES, domainFallbackChoice, setDomainFallbackChoice, type DomainFallbackChoice } from "../domain-fallback.js";
import { SupremeCourtCaseVerifier, supremeCourtCardId } from "../case-law-verifier.js";
import { caseLinkProblem, courtOfSignature } from "../court-of-signature.js";
import {
  AuthError,
  type AuthService
} from "../auth/service.js";
import type {
  LegalFederationToolRuntime
} from "../legal-federation-tool-runtime.js";
import {
  isLexMcpServerId,
  type LexMcpConnectorStore
} from "../lex-mcp-connectors.js";
import {
  fetchSourcePreview,
  type PreviewFetch
} from "../source-preview.js";
import {
  CaseAccessError,
  type LocalCaseAccessService
} from "../case-access.js";
import { buildLegiIndex, defaultLegiIndexDir, latestLegiDump } from "../eli/fr-legi.js";
import { promises as legiFs } from "node:fs";
import legiPath from "node:path";
import { activeCountry, activeJurisdictionPack, COMPONENT_LABELS, jurisdictionStatus, listJurisdictions, setActiveCountry, setActiveJurisdictionPack } from "../jurisdiction.js";
import { ELI_COUNTRIES, LEGAL_FAMILY_LABELS } from "../eli/eli-countries.js";

function requireAdmin(
  req: Request,
  res: Response,
  authService: AuthService
): boolean {
  return authorize(req, res, authService, true);
}

function requireUser(
  req: Request,
  res: Response,
  authService: AuthService
): boolean {
  return authorize(req, res, authService, false);
}

function authorize(
  req: Request,
  res: Response,
  authService: AuthService,
  adminOnly: boolean
): boolean {
  try {
    const actor = authService.authenticateAuthorization(
      req.get("authorization")
    );
    if (adminOnly && actor.user.appRole !== "ADMIN") {
      res.status(403).json({
        error: "AUTHORIZATION_DENIED"
      });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.httpStatus).json({
        error: error.code,
        ...(error.retryAfter
          ? { retryAfter: error.retryAfter }
          : {})
      });
      return false;
    }
    throw error;
  }
}

function sendConnectorError(
  res: Response,
  error: unknown
): void {
  const code = error instanceof Error
    ? error.message.split(":", 1)[0]!
    : "LEX_MCP_FAILED";
  const status =
    code === "CEIDG_KEY_NOT_JWT" ||
    code === "CEIDG_KEY_REQUIRED" ||
    code === "SN_SESSION_EMPTY"
      ? 400
      : code === "CEIDG_KEY_REJECTED"
        ? 422
        : code === "CLAUDE_DESKTOP_NOT_INSTALLED" ||
            code === "CLAUDE_DESKTOP_CONFIG_INVALID"
          ? 409
          : code.startsWith("LEX_MCP_")
            ? 503
            : 500;
  res.status(status).json({ error: code });
}

export function registerMcpConnectorRoutes(
  app: Express,
  dependencies: {
    authService: AuthService;
    connectors: LexMcpConnectorStore;
    // Osobna instancja dla karty „Wyszukiwanie” — nie ta, której audyt czytają sesje.
    search: LegalFederationToolRuntime;
    // Testy: pobieranie stron źródeł bez sieci.
    previewFetch?: PreviewFetch;
    // Orzeczenia zapisywane w sprawie: tylko w sprawie, do której użytkownik ma dostęp.
    caseAccess?: Pick<LocalCaseAccessService, "assertAccess">;
  }
): void {
  const { authService, connectors, search, previewFetch, caseAccess } = dependencies;
  const caseLawPreview = new CaseLawPreviewService(previewFetch);
  // Orzeczenia w katalogu sprawy: podgląd wymaga dostępu do sprawy, zapis kopii prawa zapisu.
  const caseAllowed = (req: Request, res: Response, caseId: string | undefined, capability: "READ" | "WRITE"): boolean => {
    if (!caseId || !caseAccess) return true;
    try {
      caseAccess.assertAccess(authService.authenticateAuthorization(req.get("authorization")), caseId, capability);
      return true;
    } catch (error) {
      if (error instanceof CaseAccessError || error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return false;
      }
      throw error;
    }
  };

  app.get(
    "/api/admin/mcp-connectors",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      res.json(connectors.status());
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/install",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      try {
        const { tools } = await connectors.install(server, {
          desktop: req.body?.desktop === true
        });
        res.json({ server, tools, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/check",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      const check = await connectors.check(server);
      res.json({ server, check, status: connectors.status() });
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/uninstall",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      try {
        connectors.uninstall(server, {
          desktop: req.body?.desktop === true
        });
        res.json({ server, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.put(
    "/api/admin/mcp-connectors/ceidg/key",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const key = typeof req.body?.key === "string" ? req.body.key : "";
      try {
        const result = await connectors.setCeidgKey(key);
        res.json({ ...result, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.delete(
    "/api/admin/mcp-connectors/ceidg/key",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        connectors.clearCeidgKey();
        res.json({ status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  // Sesja sn.pl po weryfikacji (captcha) wykonanej przez zalogowanego użytkownika w oknie sn.pl aplikacji.
  // Ciasteczek nie zwracamy ani nie logujemy.
  app.put(
    "/api/mcp-search/sn-session",
    (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
      const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
      try {
        res.json(connectors.setSnSession(cookie, userAgent));
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  // Auto-„Gotowe”: aplikacja sonduje snproxy z bieżącymi ciasteczkami okna sn.pl. Gdy przeszło
  // (brak captchy albo rozwiązana), zapisujemy sesję i zwracamy ready:true — aplikacja ponawia
  // zapytanie bez ręcznego kliknięcia. Ciasteczek nie zwracamy ani nie logujemy.
  app.post(
    "/api/mcp-search/sn-session/probe",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
      const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
      try {
        const { ready } = await connectors.probeSnSession(cookie, userAgent);
        if (ready) connectors.setSnSession(cookie, userAgent);
        res.json({ ready });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  // Weryfikacja sn.pl wykonana przez serwer (tryb serwerowy, przeglądarka bez okna sn.pl aplikacji):
  // narzędzie sn_captcha_auto konektora SN próbuje przejść ochronę bez okna. Gdy sn.pl odrzuca adres
  // serwera, odpowiedź mówi to wprost; orzeczenia SN są wtedy sprawdzane zastępczo w SAOS.
  app.post(
    "/api/mcp-search/sn-session/server-attempt",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const reply = await search.direct({ source: "sn", tool: "sn_captcha_auto", arguments: { headless: true } });
      const result = (reply.result ?? {}) as { status?: unknown; steps?: unknown; challenge?: { strona?: unknown; kind?: unknown } };
      const ready = reply.ok && result.status === "OK";
      res.json({
        ready,
        ...(ready
          ? {}
          : {
              reason: !reply.ok
                ? "SN_CONNECTOR_UNAVAILABLE"
                : Array.isArray(result.steps) && result.steps.some((step) => /Brak playwright/u.test(String(step)))
                  ? "SN_SERVER_BROWSER_MISSING"
                  : "SN_SERVER_REJECTED"
            })
      });
    }
  );

  app.delete(
    "/api/mcp-search/sn-session",
    (req, res) => {
      if (!requireUser(req, res, authService)) return;
      try {
        connectors.clearSnSession();
        res.json({ cleared: true });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  // Karta „Wyszukiwanie” (każdy zalogowany użytkownik, tylko odczyt).
  app.get(
    "/api/mcp-search/sources",
    (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const status = connectors.status();
      res.json({
        package: status.package,
        sources: status.servers.map((server) => ({
          id: server.id,
          group: server.group,
          label: server.label,
          ready: server.ready,
          ...(server.lastCheck ? { lastCheck: server.lastCheck } : {})
        }))
      });
    }
  );

  app.get(
    "/api/mcp-search/sources/:server/tools",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      const reply = await search.direct({ source: server });
      if (!reply.ok) {
        res.status(503).json({ error: "MCP_SOURCE_UNAVAILABLE", result: reply.result });
        return;
      }
      const tools = (reply.result as { tools?: unknown }).tools;
      res.json({ source: server, tools: Array.isArray(tools) ? tools : [] });
    }
  );

  app.post(
    "/api/mcp-search/query",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const source = typeof req.body?.source === "string" ? req.body.source : "";
      const tool = typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
      const args = req.body?.arguments;
      if (!isLexMcpServerId(source)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      if (!tool) {
        res.status(400).json({ error: "MCP_TOOL_REQUIRED" });
        return;
      }
      if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) {
        res.status(400).json({ error: "MCP_ARGUMENTS_INVALID" });
        return;
      }
      const reply = await search.direct({ source, tool, arguments: args ?? {} });
      res.json({ source, tool, ok: reply.ok, result: reply.result });
    }
  );

  // Pełny tekst orzeczenia / interpretacji (SN, NSA/WSA, SAOS, KIO, EUREKA, UODO, TSUE)
  // z zaznaczonym fragmentem przywołanym w odpowiedzi, do ręcznej weryfikacji kontekstu.
  app.post(
    "/api/case-law/preview",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const text = (value: unknown, max: number) =>
        typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
      const sourceUrl = text(req.body?.sourceUrl, 2000);
      const passage = text(req.body?.passage, 8000);
      const signature = text(req.body?.signature, 200);
      const attributed = text(req.body?.attributed, 4000);
      const previewCase = text(req.body?.caseId, 100);
      if (!sourceUrl || (req.body?.passage !== undefined && !passage && req.body.passage !== "")) {
        res.status(400).json({ error: "CASE_PREVIEW_INVALID" });
        return;
      }
      if (!caseAllowed(req, res, previewCase, "READ")) return;
      try {
        res.json(
          await caseLawPreview.preview({
            sourceUrl,
            ...(passage ? { passage } : {}),
            ...(signature ? { signature } : {}),
            ...(attributed ? { attributed } : {}),
            ...(previewCase ? { caseId: previewCase } : {})
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT)_[A-Z0-9_]+$/.test(message) ? message : "CASE_PREVIEW_FAILED";
        res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
      }
    }
  );

  // Kopia orzeczenia zapisana w aplikacji (do akt sprawy); źródłem jest karta orzeczenia.
  app.post(
    "/api/case-law/copy",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const sourceUrl = typeof req.body?.sourceUrl === "string" && req.body.sourceUrl.length <= 2000 ? req.body.sourceUrl.trim() : "";
      const signature = typeof req.body?.signature === "string" && req.body.signature.length <= 200 ? req.body.signature.trim() : "";
      if (!sourceUrl) {
        res.status(400).json({ error: "CASE_PREVIEW_INVALID" });
        return;
      }
      try {
        const caseId = typeof req.body?.caseId === "string" && req.body.caseId.length <= 100 ? req.body.caseId.trim() : "";
        if (!caseAllowed(req, res, caseId, "WRITE")) return;
        res.json(await caseLawPreview.copy({ sourceUrl, ...(signature ? { signature } : {}), ...(caseId ? { caseId } : {}) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT)_[A-Z0-9_]+$/.test(message) ? message : "CASE_PREVIEW_FAILED";
        res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
      }
    }
  );

  // Orzeczenie wskazane przez użytkownika (karta, sygnatura SN, link blob: z sygnaturą):
  // pobierane z oficjalnej bazy i zapisywane w sprawie; źródłem jest karta.
  const caseVerifier = new SupremeCourtCaseVerifier(previewFetch as never);
  app.post(
    "/api/case-law/resolve",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const field = (value: unknown, max: number) => (typeof value === "string" && value.length <= max ? value.trim() : "");
      const link = field(req.body?.cardUrl, 2000);
      let signature = field(req.body?.signature, 200);
      const caseId = field(req.body?.caseId, 100);
      if (!caseAllowed(req, res, caseId, "WRITE")) return;
      try {
        const problem = link ? caseLinkProblem(link) : null;
        if (problem?.signature && !signature) signature = problem.signature;
        let cardUrl = link && !problem ? link : "";
        const cardId = cardUrl ? supremeCourtCardId(cardUrl) : null;
        if (cardId) cardUrl = `https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${encodeURIComponent(cardId)}`;
        if (!cardUrl && signature) {
          if (courtOfSignature(signature) !== "SN") {
            res.status(400).json({ error: "CASE_LAW_SIGNATURE_NOT_SN" });
            return;
          }
          const verified = await caseVerifier.verify({ claim: `sygn. ${signature}`, signature, toolCallId: `resolve-${Date.now()}` });
          if (verified.status !== "FOUND" || !verified.record?.sourceUrl) {
            res.status(404).json({ error: `CASE_LAW_${verified.status}`, reason: verified.reason });
            return;
          }
          cardUrl = verified.record.sourceUrl;
          signature = verified.judgment?.signature ?? signature;
        }
        if (!cardUrl) {
          res.status(400).json({ error: problem?.kind === "BLOB" ? "CASE_LAW_BLOB_NEEDS_SIGNATURE" : "CASE_LAW_REFERENCE_MISSING" });
          return;
        }
        res.json(await caseLawPreview.copy({ sourceUrl: cardUrl, ...(signature ? { signature } : {}), ...(caseId ? { caseId } : {}) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT|SN)_[A-Z0-9_]+$/.test(message) ? message : "CASE_LAW_RESOLVE_FAILED";
        res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
      }
    }
  );

  // Jurysdykcja (Ustawienia, domyślnie prawo polskie): pakiet kraju z JURYSDYKCJA.md — treść krajowa,
  // skille dziedzinowe, konektory MCP i dostawcy komponentów aplikacji. Brak dostawcy = brak nazwany.
  const jurisdictionView = () => {
    const root = connectors.corpusRoot;
    const active = activeJurisdictionPack();
    const providers = listJurisdictions(root);
    return {
      active,
      // The legal system the application applies: one country, the others off (jurisdiction.ts).
      country: activeCountry(),
      countries: [...ELI_COUNTRIES]
        .map((entry) => ({
          code: entry.code,
          name: entry.name,
          // Legal family (category in Settings): the method follows from it (jurisdiction.ts familyMethod).
          family: entry.family,
          familyLabel: LEGAL_FAMILY_LABELS[entry.family],
          ...(entry.familyNote ? { familyNote: entry.familyNote } : {}),
          reading: entry.text?.reading ?? "DO-ZBADANIA",
          note: entry.text?.note ?? "",
          portal: entry.portal,
          pack: providers.find((provider) => provider.country === entry.code)?.pack ?? null
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pl")),
      jurisdictions: providers.map((provider) => {
        const status = jurisdictionStatus(provider);
        return {
          pack: provider.pack,
          country: provider.country,
          name: provider.name,
          language: provider.language,
          currency: provider.currency,
          connectors: provider.connectorServers,
          missing: status.missing.map((item) => COMPONENT_LABELS[item.component])
        };
      })
    };
  };
  app.get("/api/settings/jurisdiction", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    res.json(jurisdictionView());
  });
  app.put("/api/settings/jurisdiction", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    const pack = req.body?.pack;
    const country = typeof req.body?.country === "string" ? req.body.country.trim().toUpperCase() : null;
    const knownPack = typeof pack === "string" && listJurisdictions(connectors.corpusRoot).some((provider) => provider.pack === pack);
    if (!knownPack && !(country && ELI_COUNTRIES.some((entry) => entry.code === country))) {
      res.status(400).json({ error: "JURISDICTION_UNKNOWN" });
      return;
    }
    if (process.env.LEX_JURISDICTION_PACK?.trim() || process.env.LEX_JURISDICTION_COUNTRY?.trim()) {
      res.status(409).json({ error: "JURISDICTION_FIXED_BY_DEPLOYMENT" });
      return;
    }
    if (country) setActiveCountry(connectors.corpusRoot, country);
    else setActiveJurisdictionPack(connectors.corpusRoot, pack as string);
    connectors.jurisdictionChanged();
    res.json(jurisdictionView());
  });

  // French codes without a key: the local index of DILA's LEGI dump (about 1.2 GB download,
  // built in the background once; read by read_national_legislation for legifrance.gouv.fr).
  let legiBuild: { state: "BUILDING" | "FAILED"; files: number; error?: string; started: string } | null = null;
  const legiView = async () => {
    const built = await legiFs.readFile(legiPath.join(defaultLegiIndexDir(), "built.json"), "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch(() => null);
    return { built, build: legiBuild };
  };
  app.get("/api/settings/legal-sources/legi", async (req, res) => {
    if (!requireUser(req, res, authService)) return;
    res.json(await legiView());
  });
  app.post("/api/settings/legal-sources/legi/build", async (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    if (legiBuild?.state === "BUILDING") {
      res.status(409).json({ error: "LEGI_BUILD_RUNNING" });
      return;
    }
    const build: NonNullable<typeof legiBuild> = { state: "BUILDING", files: 0, started: new Date().toISOString() };
    legiBuild = build;
    void latestLegiDump()
      .then((archive) => buildLegiIndex(archive, defaultLegiIndexDir(), { onProgress: (files) => (build.files = files) }))
      .then(() => {
        legiBuild = null;
      })
      .catch((failure: unknown) => {
        build.state = "FAILED";
        build.error = failure instanceof Error ? failure.message : String(failure);
      });
    res.status(202).json(await legiView());
  });

  // Model zapasowy routingu dziedzin (Ustawienia, domyślnie wyłączony): gdy reguły nie
  // wskazały dziedziny, krótkie zapytanie do modelu sesji albo lokalnego Bielika/Mistrala.
  app.get("/api/settings/domain-fallback", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    res.json({ choice: domainFallbackChoice(), choices: DOMAIN_FALLBACK_CHOICES });
  });
  app.put("/api/settings/domain-fallback", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    const choice = req.body?.choice;
    if (typeof choice !== "string" || !DOMAIN_FALLBACK_CHOICES.includes(choice as DomainFallbackChoice)) {
      res.status(400).json({ error: "DOMAIN_FALLBACK_INVALID" });
      return;
    }
    setDomainFallbackChoice(choice as DomainFallbackChoice);
    res.json({ choice: domainFallbackChoice() });
  });

  // Tryb offline modelu lokalnego (Ustawienia, domyślnie wyłączony): bez źródeł zewnętrznych.
  app.get("/api/settings/local-offline", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    res.json({ enabled: localOfflineMode(), forced: process.env.LEX_LOCAL_OFFLINE === "on" || process.env.LEX_LOCAL_OFFLINE === "off" });
  });
  app.put("/api/settings/local-offline", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "LOCAL_OFFLINE_INVALID" });
      return;
    }
    setLocalOfflineMode(enabled);
    res.json({ enabled: localOfflineMode() });
  });

  // Wyszukiwarka internetowa (Ustawienia): adres SearXNG, test porównawczy z tego komputera, kolejność.
  const webSearchView = () => {
    const settings = webSearchSettings();
    const provider = (process.env.LEX_WEB_SEARCH_PROVIDER ?? "auto").trim().toLowerCase();
    return {
      ...settings,
      effectiveOrder: effectiveSearchOrder(settings),
      engines: SEARCH_ENGINES,
      searxngUrlForced: searxngUrlForced(),
      firecrawlKeyForced: firecrawlKeyForced(),
      providerForced: provider !== "auto" ? provider : null
    };
  };
  app.get("/api/settings/web-search", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    res.json(webSearchView());
  });
  app.put("/api/settings/web-search", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    try {
      if (req.body && "searxngUrl" in req.body) setSearxngUrl(req.body.searxngUrl ?? "");
      if (req.body && "firecrawlApiKey" in req.body) setFirecrawlApiKey(req.body.firecrawlApiKey ?? "");
      if (req.body && "googleSession" in req.body) setGoogleSession(req.body.googleSession);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "WEB_SEARCH_SETTINGS_INVALID" });
      return;
    }
    res.json(webSearchView());
  });
  app.post("/api/settings/web-search/test", async (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    const provider = (process.env.LEX_WEB_SEARCH_PROVIDER ?? "auto").trim().toLowerCase();
    if (provider === "off" || provider === "disabled") {
      res.status(409).json({ error: "WEB_SEARCH_DISABLED" });
      return;
    }
    const search = new PublicWebSearch(process.env, fetch, 10_000, 1_500);
    const settings = webSearchSettings();
    try {
      const result = await runWebSearchBenchmark(SEARCH_ENGINES, (engine, query, max) => search.searchEngine(engine, query, max, settings));
      saveWebSearchTest(result);
      res.json(webSearchView());
    } catch (error) {
      res.status(500).json({ error: "WEB_SEARCH_TEST_FAILED", description: error instanceof Error ? error.message.slice(0, 200) : "" });
    }
  });

  // Baza orzeczeń (Ustawienia, domyślnie wyłączona): katalog pobranych orzeczeń.
  app.get("/api/case-law/library", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    const repository = caseLawRepository();
    const query = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    res.json({ enabled: repository?.libraryEnabled() ?? false, available: Boolean(repository), entries: repository?.catalog(query, 100) ?? [] });
  });
  app.put("/api/case-law/library", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    const repository = caseLawRepository();
    if (!repository || typeof req.body?.enabled !== "boolean") {
      res.status(400).json({ error: "CASE_LAW_LIBRARY_INVALID" });
      return;
    }
    repository.setLibraryEnabled(req.body.enabled);
    res.json({ enabled: repository.libraryEnabled() });
  });
  app.post("/api/case-law/library/remove", (req, res) => {
    if (!requireUser(req, res, authService)) return;
    const cardUrl = typeof req.body?.cardUrl === "string" ? req.body.cardUrl : "";
    res.json({ removed: Boolean(cardUrl) && (caseLawRepository()?.remove(cardUrl) ?? false) });
  });

  // Podgląd strony źródła w aplikacji: tylko oficjalne domeny, bez skryptów.
  app.post(
    "/api/mcp-search/source-preview",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      try {
        const preview = await fetchSourcePreview(url, previewFetch);
        res.json(
          preview.kind === "pdf"
            ? { kind: "pdf", url: preview.url, base64: preview.data.toString("base64") }
            : preview
        );
      } catch (error) {
        const code = error instanceof Error && /^SOURCE_PREVIEW_[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "SOURCE_PREVIEW_FAILED";
        res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
      }
    }
  );
}
