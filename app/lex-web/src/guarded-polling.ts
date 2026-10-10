/**
 * Odpytywanie co `intervalMs` bez nakładania zapytań; po stop() spóźniona odpowiedź
 * nie trafia już do `onData` (clearInterval nie anuluje wysłanego zapytania).
 */
export function startGuardedPolling<T>(
  fetchOnce: () => Promise<T>,
  onData: (value: T) => void,
  intervalMs: number
): () => void {
  let stopped = false;
  let inFlight = false;
  const id = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    fetchOnce()
      .then((value) => {
        if (!stopped) onData(value);
      })
      .catch(() => {
        // Błędy widoczne dla użytkownika zgłasza właściciel odpytywania.
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
