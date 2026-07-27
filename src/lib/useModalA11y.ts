"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Basic modal accessibility, applied once to every overlay in the app instead
// of writing it four times: traps Tab/Shift+Tab within the container so
// keyboard focus can't escape to the page behind the backdrop, focuses the
// first focusable element on open, and restores focus to whatever triggered
// the modal once it closes. `onClose` is optional — pass it to also close on
// Escape; omit it for an overlay whose only exit is a real in-page action
// (e.g. the live-game pause overlay, where Escape shouldn't silently resume
// the game) or one that already has its own Escape handling elsewhere.
//
// Returns a ref callback — attach it to the overlay's container element via
// `ref={modalRef}`. A callback ref (rather than accepting a caller-owned
// RefObject) is what lets this hook notice the container appearing on a
// *later* render than the component's own mount — the exact shape every
// caller here has, since each conditionally renders its dialog markup only
// once some state (`mounted`, `open`, `showX`) flips true after the initial
// render. A plain RefObject's identity never changes, so an effect keyed on
// it would only ever run once, at the initial mount when `.current` is still
// null — before the DOM node the caller actually cares about exists.
export function useModalA11y(onClose?: () => void) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  // Keep the latest onClose available to the keydown handler without making
  // it an effect dependency — an inline onClose's identity can change on
  // every render of a frequently-updating parent (e.g. LiveGameView), and
  // re-running the setup effect for that would re-steal focus mid-interaction.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );

    const first = focusables()[0];
    (first ?? container).focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [container]);

  return useCallback((node: HTMLElement | null) => setContainer(node), []);
}
