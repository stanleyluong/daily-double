import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let firestore: Firestore | null = null;

// Lazily initialized so importing this module (e.g. during `next build`)
// doesn't require credentials — only actually touching Firestore does.
// Credentials: FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of the service-account
// JSON — used on Amplify) or GOOGLE_APPLICATION_CREDENTIALS (path to the
// JSON file — used locally).
export function db(): Firestore {
  if (firestore) return firestore;

  // Dev (Turbopack/Webpack HMR) can load this module more than once, each
  // getting its own `firestore` module-local variable, while the underlying
  // Firebase app is a true singleton (getApps() sees it globally). Reusing
  // that app via getFirestore() returns the *same* Firestore instance across
  // module copies, so .settings() — callable only once per instance — must
  // only run on the branch that actually created the app.
  const apps = getApps();
  if (apps.length > 0) {
    firestore = getFirestore(apps[0]);
    return firestore;
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const app: App = initializeApp({
    credential: b64
      ? cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8")))
      : applicationDefault(),
  });

  firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}
