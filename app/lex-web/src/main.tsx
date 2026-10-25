import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./AuthApp.js";
import "./theme.css";
import "./styles.css";
import { applyTheme, readTheme } from "./text-size.js";

applyTheme(readTheme());

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root application mount.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
