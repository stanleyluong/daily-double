import { authAdmin } from "@/lib/firebaseAdmin";

// Verifies the Firebase ID token on an API request and returns the uid, or
// null if missing/invalid. Live-game and judge routes are all sign-in-gated,
// so this is the single choke point they share.
export async function uidFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;
  try {
    return (await authAdmin().verifyIdToken(idToken)).uid;
  } catch {
    return null;
  }
}
