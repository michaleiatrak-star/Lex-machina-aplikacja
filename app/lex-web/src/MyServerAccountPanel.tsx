import { useEffect, useState } from "react";
import { ApiError, clearMyApiKey, getMyServerAccount, setMyApiKey, type MyServerAccount, type ProviderId } from "./api.js";

const PROVIDERS: Array<[ProviderId, string]> = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["xai", "xAI"],
  ["google", "Google Gemini"]
];

function failureText(failure: unknown): string {
  if (!(failure instanceof ApiError)) return "Brak połączenia z serwerem.";
  if (failure.code === "BYOK_NOT_ALLOWED") return "Plan konta nie pozwala na własny klucz API.";
  if (failure.code === "INVALID_PROVIDER_API_KEY") return "Nieprawidłowy klucz API.";
  return failure.code;
}

/** Tryb serwerowy: plan konta, zużycie w miesiącu i własne klucze API (BYOK). */
export function MyServerAccountPanel() {
  const [account, setAccount] = useState<MyServerAccount | null>(null);
  const [inputs, setInputs] = useState<Partial<Record<ProviderId, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    setAccount(await getMyServerAccount());
  }

  useEffect(() => {
    void refresh().catch((failure: unknown) => setError(failureText(failure)));
  }, []);

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!account) {
    return <article className="chat-card">{error ? <div className="alert alert-error">{error}</div> : <p>Wczytywanie…</p>}</article>;
  }
  const used = account.usage.inputTokens + account.usage.outputTokens;
  const limit = account.plan?.monthlyTokenLimit ?? null;

  return (
    <article className="chat-card">
      <p className="eyebrow">Konto</p>
      <h2>Plan i klucze API</h2>
      <p>
        Plan: <strong>{account.plan?.name ?? "brak"}</strong> · zużycie w {account.month}: {used.toLocaleString("pl-PL")}
        {limit !== null ? ` z ${limit.toLocaleString("pl-PL")}` : ""} tokenów
      </p>
      {account.plan?.byokAllowed ? (
        <>
          <p className="field-help">
            Własny klucz API ma pierwszeństwo przed kluczem kancelarii. Jest szyfrowany kluczem Twojego konta i nigdy nie wraca do przeglądarki.
          </p>
          {PROVIDERS.map(([id, label]) => {
            const stored = account.byok.find((item) => item.provider === id);
            return (
              <div key={id} className="chat-form-row compact">
                <span>
                  {label}: {stored ? "klucz zapisany" : "brak klucza"}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Wklej klucz API"
                  value={inputs[id] ?? ""}
                  onChange={(event) => setInputs({ ...inputs, [id]: event.target.value })}
                />
                <button
                  type="button"
                  className="chat-primary-action"
                  disabled={busy || !(inputs[id] ?? "").trim()}
                  onClick={() =>
                    void run(async () => {
                      await setMyApiKey(id, (inputs[id] ?? "").trim());
                      setInputs({ ...inputs, [id]: "" });
                    })
                  }
                >
                  Zapisz
                </button>
                {stored && (
                  <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void run(() => clearMyApiKey(id))}>
                    Usuń
                  </button>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <p className="field-help">Konto korzysta z kluczy API kancelarii.</p>
      )}
      {error && <div className="alert alert-error">{error}</div>}
    </article>
  );
}
