import { useEffect, useState } from "react";
import { ApiError, getMyServerAccount, type MyServerAccount } from "./api.js";

/** Tryb serwerowy: plan konta, limit i zużycie w miesiącu. */
export function MyServerAccountPanel() {
  const [account, setAccount] = useState<MyServerAccount | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void getMyServerAccount()
      .then(setAccount)
      .catch((failure: unknown) => setError(failure instanceof ApiError ? failure.code : "Brak połączenia z serwerem."));
  }, []);

  if (!account) {
    return <article className="chat-card">{error ? <div className="alert alert-error">{error}</div> : <p>Wczytywanie…</p>}</article>;
  }
  const used = account.usage.inputTokens + account.usage.outputTokens;
  const limit = account.plan?.monthlyTokenLimit ?? null;

  return (
    <article className="chat-card">
      <p className="eyebrow">Konto</p>
      <h2>Plan</h2>
      <p>
        Plan: <strong>{account.plan?.name ?? "brak"}</strong> · limit: {limit !== null ? `${limit.toLocaleString("pl-PL")} tokenów / mies.` : "bez limitu"}
      </p>
      <p>
        Zużycie w {account.month}: {used.toLocaleString("pl-PL")} tokenów
      </p>
    </article>
  );
}
