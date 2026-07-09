import { OAuth2Client } from "google-auth-library";

function getClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_LOGIN_CLIENT_ID, GOOGLE_LOGIN_CLIENT_SECRET, and GOOGLE_LOGIN_REDIRECT_URI must be set",
    );
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function getAllowedDomains(): string[] {
  return (process.env.ALLOWED_GOOGLE_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function getLoginUrl(): string {
  return getClient().generateAuthUrl({
    access_type: "online", // identity only — no API calls later, so no refresh token needed
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
  hd: string | null;
}

export async function handleLoginCallback(code: string): Promise<GoogleIdentity> {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token");
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_LOGIN_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("Google account has no verified email");
  }
  return { email: payload.email, name: payload.name ?? null, hd: payload.hd ?? null };
}

/**
 * Restricts sign-in to the church's Workspace domains. Checks both the
 * email suffix and the ID token's `hd` claim (when present) — the hd
 * claim is Google's own assertion that the account belongs to that
 * managed Workspace domain, guarding against relying on the email
 * string alone.
 */
export function isDomainAllowed(identity: GoogleIdentity): boolean {
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return false; // fail closed if misconfigured

  const emailDomain = identity.email.split("@")[1]?.toLowerCase();
  if (!emailDomain || !allowed.includes(emailDomain)) return false;
  if (identity.hd && identity.hd.toLowerCase() !== emailDomain) return false;
  return true;
}
