"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useFriends } from "@/components/FriendsProvider";
import { clearInvite } from "@/lib/friendsClient";

// Shows incoming game invites anywhere in the app (driven by the shared
// friends poll). Join takes you straight into the lobby.
export default function InviteBanner() {
  const { user } = useAuth();
  const { data, refresh } = useFriends();
  const router = useRouter();
  const invite = data?.invites?.[0];
  if (!invite || !user) return null;

  const dismiss = () => {
    clearInvite(user, invite.fromUid)
      .then(refresh)
      .catch(() => {});
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm bg-board-deep border border-gold/50 rounded-xl shadow-2xl p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-blue-100">
          <span className="text-gold font-semibold">{invite.fromName}</span> invited you to a game
        </p>
        <p className="text-xs text-blue-200/50 font-mono tracking-widest">{invite.gameCode}</p>
      </div>
      <button
        onClick={() => {
          const code = invite.gameCode;
          dismiss();
          router.push(`/live/${code}`);
        }}
        className="font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-4 py-2 rounded"
      >
        Join
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="text-blue-200/50 hover:text-blue-100 text-lg leading-none">
        ×
      </button>
    </div>
  );
}
