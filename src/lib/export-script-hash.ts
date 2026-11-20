/** Bind a self-contained export script to its exact UTF-8 text. */
export async function exportScriptHash(script: string) {
  if (!globalThis.crypto?.subtle) throw new Error('Interactive export needs a secure browser context. Open Meridian over HTTPS or localhost.');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)));
  return btoa(String.fromCharCode(...bytes));
}
