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

// The site owner's login email — Firestore enforces unique emails per project,
// so only the owner's account matches. Override with ADMIN_EMAIL if the owner
// account ever changes.
const OWNER_EMAIL = (process.env.ADMIN_EMAIL ?? "xstanz@gmail.com").toLowerCase();

// True only for a request authenticated as the site owner — gates admin-only
// routes (e.g. flagged-clue review).
export async function isOwnerRequest(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return false;
  try {
    const decoded = await authAdmin().verifyIdToken(idToken);
    return typeof decoded.email === "string" && decoded.email.toLowerCase() === OWNER_EMAIL;
  } catch {
    return false;
  }
}
