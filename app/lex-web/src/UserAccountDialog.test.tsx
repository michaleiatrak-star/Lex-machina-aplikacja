import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAccountDialog } from "./UserAccountDialog.js";
import type { AuthenticatedUser } from "./api.js";

const jan: AuthenticatedUser = { userId: "user_" + "a".repeat(32), loginName: "jan", displayName: "Jan", appRole: "USER", accountKind: "PROFESSIONAL", status: "ACTIVE", createdAt: "2026-11-08T10:00:00Z" };
const render = (user: AuthenticatedUser, currentUserId: string, serverMode: boolean) =>
  renderToStaticMarkup(<UserAccountDialog user={user} currentUserId={currentUserId} serverMode={serverMode} onClose={() => undefined} onChanged={() => undefined} />);

describe("account dialog", () => {
  it("has data, kind, rights, password, block and removal for another account", () => {
    const html = render(jan, "user_" + "b".repeat(32), true);
    for (const text of ["Ustawienia konta", "E-mail", "Typ konta", "Uprawnienia", "Ustaw hasło jednorazowe", "Wyślij link resetu na e-mail", "Zablokuj konto", "Usuń konto"]) expect(html).toContain(text);
    expect(html).toContain('role="dialog"');
  });

  it("outside the server mode explains why the administrator cannot set a password", () => {
    const html = render(jan, "user_" + "b".repeat(32), false);
    expect(html).not.toContain("Ustaw hasło jednorazowe");
    expect(html).toContain("kodem odzyskiwania");
  });

  it("own account: no own rights change, block or removal", () => {
    const html = render({ ...jan, appRole: "ADMIN" }, jan.userId, true);
    expect(html).toContain("Własne uprawnienia zmienia inny administrator.");
    expect(html).not.toContain("Zablokuj konto");
    expect(html).not.toContain("Ustaw hasło jednorazowe");
  });
});
