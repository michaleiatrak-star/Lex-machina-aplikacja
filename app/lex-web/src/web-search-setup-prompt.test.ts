import { describe, expect, it } from "vitest";
import { localSearxngRecommended, onWebSearchSetupRequest, requestWebSearchSetup, shouldPromptWebSearch, takeWebSearchSetupRequest } from "./web-search-setup-prompt.js";
import { modelAvailable } from "./model-availability.js";

const none = { searxngUrl: "", searxngUrlForced: false, providerForced: null };

describe("po wybraniu modelu: wyszukiwarki z zaleceniem lokalnego SearXNG", () => {
  it("raz, administratorowi, gdy model jest i SearXNG nie ma", () => {
    const base = { admin: true, serverMode: false, modelAvailable: true, alreadyShown: false, settings: none };
    expect(shouldPromptWebSearch(base)).toBe(true);
    expect(shouldPromptWebSearch({ ...base, alreadyShown: true })).toBe(false);
    expect(shouldPromptWebSearch({ ...base, admin: false })).toBe(false);
    expect(shouldPromptWebSearch({ ...base, serverMode: true })).toBe(false);
    expect(shouldPromptWebSearch({ ...base, modelAvailable: false })).toBe(false);
    expect(shouldPromptWebSearch({ ...base, settings: { ...none, searxngUrl: "http://127.0.0.1:8888" } })).toBe(false);
    expect(shouldPromptWebSearch({ ...base, settings: null })).toBe(false);
  });

  it("zalecenie w sekcji tylko bez SearXNG i bez adresu narzuconego w konfiguracji", () => {
    expect(localSearxngRecommended(true, none)).toBe(true);
    expect(localSearxngRecommended(false, none)).toBe(false);
    expect(localSearxngRecommended(true, { ...none, searxngUrlForced: true })).toBe(false);
  });

  it("prośba przed pokazaniem sekcji jest odebrana raz; po pokazaniu przychodzi zdarzeniem", () => {
    requestWebSearchSetup();
    expect(takeWebSearchSetupRequest()).toBe(true);
    expect(takeWebSearchSetupRequest()).toBe(false);
    let opened = 0;
    const off = onWebSearchSetupRequest(() => (opened += 1));
    requestWebSearchSetup();
    off();
    expect(opened).toBe(1);
    expect(takeWebSearchSetupRequest()).toBe(false);
  });

  it("model dostępny: klucz, konto albo model lokalny", () => {
    expect(modelAvailable({ anthropic: true }, {}, false)).toBe(true);
    expect(modelAvailable({ anthropic: false }, { anthropic: { authenticated: true } as never }, false)).toBe(true);
    expect(modelAvailable({ anthropic: false }, {}, true)).toBe(true);
    expect(modelAvailable({ anthropic: false }, {}, false)).toBe(false);
    expect(modelAvailable({ anthropic: undefined }, {}, undefined)).toBe(false);
  });
});
