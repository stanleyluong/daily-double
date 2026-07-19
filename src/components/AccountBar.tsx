"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/components/AuthProvider";
import AuthModal from "@/components/AuthModal";

export default function AccountBar() {
  const { user, loading } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  // Reserve the same footprint while auth state resolves, so nothing jumps.
  if (loading) return <div className="fixed top-3 right-3 z-40 h-8 w-20" aria-hidden />;

  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-3 text-sm">
      {user ? (
        <>
          <Link
            href="/me"
            className="text-blue-200/80 hover:text-gold underline-offset-2 hover:underline truncate max-w-[10rem]"
          >
            {user.displayName || user.email}
          </Link>
          <button
            onClick={() => signOut(auth)}
            className="text-blue-200/50 hover:text-blue-100"
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-full border border-gold/50 text-gold px-3 py-1 hover:bg-board transition-colors"
        >
          Sign in
        </button>
      )}
      {modalOpen && <AuthModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
