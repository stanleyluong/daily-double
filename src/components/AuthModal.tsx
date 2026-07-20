"use client";

import { useState, type FormEvent } from "react";
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-board rounded-lg shadow-2xl p-6"
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
          className="w-full mb-4 rounded bg-white text-black font-semibold py-2 disabled:opacity-50"
        >
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
  );
}
