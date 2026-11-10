import { currentLocale, t } from "./i18n";
import { useEffect, useState } from "react";
import { ApiError, getMyServerAccount, type MyServerAccount } from "./api.js";

/** Tryb serwerowy: plan konta, limit i zużycie w miesiącu. */
export function MyServerAccountPanel() {
  const [account, setAccount] = useState<MyServerAccount | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getMyServerAccount()
      .then(setAccount)
      .catch((failure: unknown) => setError(failure instanceof ApiError ? failure.code : t("Brak połączenia z serwerem.")));
  }, []);

  if (!account) {
    return <article className="chat-card">{error ? <div className="alert alert-error">{error}</div> : <p>{t("Wczytywanie…")}</p>}</article>;
  }
  const used = account.usage.inputTokens + account.usage.outputTokens;
  const limit = account.plan?.monthlyTokenLimit ?? null;

  return (
    <article className="chat-card">
      <p className="eyebrow">{t("Konto")}</p>
      <h2>{t("Plan")}</h2>
      <p>
        {t("Plan:")} <strong>{account.plan?.name ?? "brak"}</strong> {t("· limit:")} {limit !== null ? t("{value} tokenów / mies.", { value: limit.toLocaleString(currentLocale()) }) : "bez limitu"}
      </p>
      <p>
        {t("Zużycie w")} {account.month}: {used.toLocaleString(currentLocale())} {t("tokenów")}
      </p>
    </article>
  );
}
