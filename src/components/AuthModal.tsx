"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

interface AuthModalProps {
  onClose: () => void;
  message?: string;
}

export default function AuthModal({ onClose, message }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Render through a portal to <body>: this modal is often mounted inside the
  // nav header, whose backdrop-blur makes it the containing block for fixed
  // descendants — which would otherwise clip the overlay to the header box.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Firebase:\s*/, "") : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/70"
      onClick={onClose}
    >
      {/* min-h-full wrapper: short content centers, tall content scrolls (so a
          modal taller than a small mobile viewport never clips the top). */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-sm bg-board rounded-lg shadow-2xl p-6 my-6"
          onClick={(e) => e.stopPropagation()}
        >
        <p className="font-display text-2xl tracking-wider text-gold mb-1">
          {mode === "signin" ? "Sign in" : "Create account"}
        </p>
        {message && <p className="text-sm text-blue-200/70 mb-4">{message}</p>}
        {!message && <div className="mb-4" />}

        <button
          type="button"
          onClick={withGoogle}
          disabled={busy}
          className="w-full mb-4 rounded bg-white text-black font-semibold py-2 disabled:opacity-50 flex items-center justify-center gap-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.166 6.656 3.58 9 3.58z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="text-center text-xs text-blue-200/50 mb-4">or</div>

        <form onSubmit={submitEmail} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-3 py-2"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="rounded bg-board-deep border border-blue-300/30 focus:border-gold outline-none px-3 py-2"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="font-display text-lg tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-4 py-2 rounded disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-3 text-sm text-blue-200/60 hover:text-blue-100 underline block mx-auto"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 text-xs text-blue-200/40 hover:text-blue-100 block mx-auto"
        >
          Close
        </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
