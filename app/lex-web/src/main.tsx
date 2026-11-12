import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./styles.css";
import { applyTheme, readTheme } from "./text-size.js";
import { loadLocale, preferredLocale } from "./i18n.js";

applyTheme(readTheme());

// In the desktop application a link meant for a new tab (court pages, sources) opens in the
// system browser: the application's window does not open other windows itself.
document.addEventListener(
  "click",
  (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const link = (event.target as Element | null)?.closest?.("a[target=_blank]") as HTMLAnchorElement | null;
    const invoke = (window as Window & { __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> } })
      .__TAURI_INTERNALS__?.invoke;
    if (!link || !invoke || !/^https:\/\//iu.test(link.href)) return;
    event.preventDefault();
    void invoke("open_external_url", { url: link.href }).catch(() => undefined);
  },
  true
);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root application mount.");

// The interface language's catalog is loaded before the interface modules are imported, so texts
// defined at module level (t() in constants) are already in that language; a missing catalog
// leaves Polish. Changing the language reloads the window.
void loadLocale(preferredLocale())
  .catch(() => undefined)
  .then(() => Promise.all([import("./AuthApp.js"), import("./ComponentSetup.js")]))
  .then(([{ default: App }, { ComponentSetup }]) => {
    createRoot(root).render(
      <StrictMode>
        <ComponentSetup><App /></ComponentSetup>
      </StrictMode>
    );
  });
