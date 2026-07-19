import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | null = null;
let firestore: Firestore | null = null;
let authInstance: Auth | null = null;

// Lazily initialized so importing this module (e.g. during `next build`)
// doesn't require credentials — only actually touching Firestore/Auth does.
// Credentials: FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of the service-account
// JSON — used on Amplify) or GOOGLE_APPLICATION_CREDENTIALS (path to the
// JSON file — used locally).
function resolveApp(): App {
  if (cachedApp) return cachedApp;

  // Dev (Turbopack/Webpack HMR) can load this module more than once, each
  // getting its own module-local `cachedApp`, while the underlying Firebase
  // app is a true singleton (getApps() sees it globally) — reuse it rather
  // than calling initializeApp() again.
  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  cachedApp = initializeApp({
    credential: b64
      ? cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8")))
      : applicationDefault(),
  });
  return cachedApp;
}

export function db(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(resolveApp());
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // .settings() is callable only once per Firestore instance. Whether it
    // already happened depends on call order across module instances and
    // across db()/authAdmin() — rather than track that precisely, just
    // attempt it and ignore the "already configured" failure.
  }
  return firestore;
}

export function authAdmin(): Auth {
  if (authInstance) return authInstance;
  authInstance = getAuth(resolveApp());
  return authInstance;
}
