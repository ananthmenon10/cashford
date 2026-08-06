"use client";

// Shared focus-trap/scroll-lock/Escape-close behavior for a bottom sheet, extracted from
// components/gw/GameweekStrip.tsx's original inline implementation (step 6A round 2, item 6) so
// HomeHub's new jump-to-any-gameweek sheet can reuse the same accessible behavior instead of a
// second hand-rolled copy.
import { useCallback, useEffect, useRef, useState } from "react";

export function useBottomSheet() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      : [];
    const initialFocus = dialog?.querySelector<HTMLElement>("button") ?? focusable[0];
    const frame = window.requestAnimationFrame(() => (initialFocus ?? dialog)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousActive && document.contains(previousActive)) previousActive.focus();
      else triggerRef.current?.focus();
    };
  }, [close, open]);

  return { open, setOpen, close, dialogRef, triggerRef };
}
