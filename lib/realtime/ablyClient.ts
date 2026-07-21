import Ably from "ably";
import type { Realtime } from "ably";

// Browser-side lazy singleton. One Realtime connection per tab, keyed by
// clientId; if the clientId ever changes (e.g. localStorage cleared) the old
// connection is closed and a fresh one is created.
let client: Realtime | null = null;
let currentClientId: string | null = null;

export function getAblyClient(clientId: string): Realtime {
  if (typeof window === "undefined") {
    throw new Error(
      "getAblyClient() is browser-only and must not be called during SSR.",
    );
  }

  if (client !== null && currentClientId === clientId) {
    return client;
  }

  if (client !== null) {
    try {
      client.close();
    } catch {
      // ignore — we're replacing the connection anyway
    }
    client = null;
    currentClientId = null;
  }

  client = new Ably.Realtime({
    clientId,
    authUrl: `/api/ably-token?clientId=${encodeURIComponent(clientId)}`,
    authMethod: "GET",
    closeOnUnload: true,
  });
  currentClientId = clientId;
  return client;
}
