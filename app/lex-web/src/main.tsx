import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./styles.css";
import { applyTheme, readTheme } from "./text-size.js";
import { loadLocale, preferredLocale } from "./i18n.js";

applyTheme(readTheme());

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
