// Preload for the benchmark server: Gemini API calls go to the local stand-in; nothing else changes.
const target = process.env.STANDIN_URL;
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.hostname === "generativelanguage.googleapis.com") {
    const local = new URL(url.pathname + url.search, target);
    return input instanceof Request ? original(new Request(local, input), init) : original(local, init);
  }
  return original(input, init);
};
