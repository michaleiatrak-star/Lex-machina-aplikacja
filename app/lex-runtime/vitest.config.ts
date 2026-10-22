import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node's crypto.argon2 (auth) needs Node >= 24.7: on an older Node ~85 tests fail with an
    // Argon2 error that looks like a regression. Stop once with the reason instead.
    globalSetup: ["./tests/node-version.global-setup.ts"],
    // Testy z tokenem desktop nie zajmują portu strony (4317); testy strony ustawiają go same.
    env: { LEX_BROWSER_PORT: "0" }
  }
});
