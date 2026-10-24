import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json";

// Wersja aplikacji (runtime, interfejs i desktop mają wspólny numer): okno aktualizacji przy
// starcie porównuje z nią wykrytą wersję bez pytania GitHub.
const appVersion = packageJson.version;

export default defineConfig({
  plugins: [react()],
  define: {
    __LEX_APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  },
  preview: {
    host: "127.0.0.1"
  }
});
