import type { Realtime } from "ably";

// Browser-side lazy singleton. One Realtime connection per tab, keyed by
// clientId; if the clientId ever changes (e.g. localStorage cleared) the old
// connection is closed and a fresh one is created.
//
// The Ably SDK is the single largest chunk of the /game route (~72 KB gz),
// so it is loaded with a dynamic import on first use instead of being
// statically bundled: the lobby/board paint before the SDK arrives, and solo
// practice (which never connects) never downloads it at all.
let client: Realtime | null = null;
let currentClientId: string | null = null;
let pending: Promise<Realtime> | null = null;
let pendingClientId: string | null = null;

export function getAblyClient(clientId: string): Promise<Realtime> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("getAblyClient() is browser-only and must not be called during SSR."),
    );
  }

  if (client !== null && currentClientId === clientId) {
    return Promise.resolve(client);
  }
  // Coalesce concurrent calls for the same clientId into one creation.
  if (pending !== null && pendingClientId === clientId) {
    return pending;
  }

  pendingClientId = clientId;
  pending = (async () => {
    const { Realtime: AblyRealtime } = await import("ably");
    if (client !== null && currentClientId === clientId) return client;

    if (client !== null) {
      try {
        client.close();
      } catch {
        // ignore — we're replacing the connection anyway
      }
      client = null;
      currentClientId = null;
    }

    client = new AblyRealtime({
      clientId,
      authUrl: `/api/ably-token?clientId=${encodeURIComponent(clientId)}`,
      authMethod: "GET",
      closeOnUnload: true,
    });
    currentClientId = clientId;
    return client;
  })();
  pending
    .finally(() => {
      if (pendingClientId === clientId) {
        pending = null;
        pendingClientId = null;
      }
    })
    // Callers observe rejections on the returned promise; this derived
    // bookkeeping promise must not surface them a second time.
    .catch(() => {});
  return pending;
}
