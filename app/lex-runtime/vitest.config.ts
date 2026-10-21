import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node's crypto.argon2 (auth) needs Node >= 24.7: on an older Node ~85 tests fail with an
    // Argon2 error that looks like a regression. Stop once with the reason instead.
    globalSetup: ["./tests/node-version.global-setup.ts"]
  }
});
