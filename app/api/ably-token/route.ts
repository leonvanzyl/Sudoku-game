import Ably from "ably";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ably-token?clientId=<id>
 *
 * Issues an Ably TokenRequest for the given clientId. The browser-side
 * Realtime client points its `authUrl` here so the ABLY_API_KEY never
 * leaves the server.
 */
export async function GET(request: Request) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ABLY_API_KEY is not configured on the server. Set it in your environment (see .env.example).",
      },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "Missing required query parameter: clientId" },
      { status: 400 },
    );
  }

  try {
    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({ clientId });
    return NextResponse.json(tokenRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to create Ably token request: ${message}` },
      { status: 500 },
    );
  }
}
