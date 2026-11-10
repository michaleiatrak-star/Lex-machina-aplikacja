import { ComponentSetup } from "./ComponentSetup.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./AuthApp.js";
import "./theme.css";
import "./styles.css";
import { applyTheme, readTheme } from "./text-size.js";
import { loadLocale, preferredLocale } from "./i18n.js";

applyTheme(readTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root application mount.");

// The interface language's catalog before the first render (a missing one leaves Polish).
void loadLocale(preferredLocale())
  .catch(() => undefined)
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <ComponentSetup><App /></ComponentSetup>
      </StrictMode>
    );
  });
