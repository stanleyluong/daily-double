"use client";

import { useModalA11y } from "@/lib/useModalA11y";

// Explains an "unrevealed" grid slot: a historical (J-Archive) clue that was
// never asked on the original broadcast because the round ran out of time
// before it was played. Confirmed by J-Archive's own FAQ, not a guess — see
// PublicClue.unrevealed's doc comment for the full context.
export default function UnrevealedClueModal({ value, onClose }: { value: number; onClose: () => void }) {
  const modalRef = useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unrevealed-clue-heading"
        tabIndex={-1}
        className="w-full max-w-sm bg-board rounded-lg shadow-2xl p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="unrevealed-clue-heading" className="font-display text-2xl tracking-wide text-gold mb-2">
          ${value} — never aired
        </p>
        <p className="text-blue-100/80 text-sm leading-relaxed mb-5">
          This clue is part of a real Jeopardy! episode, but the round ran out of time before contestants
          got to it — it was never asked on the original broadcast. It isn&apos;t a gap in our data; the
          board is reproducing exactly what aired.
        </p>
        <button
          onClick={onClose}
          className="font-display tracking-wider bg-gold hover:bg-gold-soft text-board-deep px-6 py-2 rounded"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
