// K3 seam — the only surface the mint handler, the room, and V03's fallback depend on.
// nonce and ttlSeconds are owned by the handler; the driver embeds them in the provider session.
export interface VoiceSession {
  mint(
    interviewId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<{
    token: string;     // short-lived signed provider session token — never the API key
    wssOrigin: string; // the WSS origin the CSP connect-src must allow (§7.4)
  }>;
}
