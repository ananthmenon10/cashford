"use client";

import { useEffect, useState } from "react";

// Sun/moon toggle for the home top bar. Flips the `.dark` class on <html> (the root-layout
// inline script applies it before paint everywhere) and remembers the choice in localStorage.
// Renders a neutral placeholder until mounted so the server never guesses the wrong icon
// (same no-mismatch pattern as components/LocalTime.tsx).
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("cf-theme", next ? "dark" : "light");
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next ? "#0B0F14" : "#15A66A");
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      aria-pressed={dark ?? false}
      title={dark ? "Switch to light" : "Switch to dark"}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-muted transition-transform active:scale-90"
    >
      {dark === null ? (
        <span className="block h-[18px] w-[18px]" />
      ) : dark ? (
        <SunIcon />
      ) : (
        <MoonIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
