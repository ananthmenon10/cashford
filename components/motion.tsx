"use client";

// Cashford motion primitives — the React port of the design handoff (cashford-motion.js).
// Pure CSS keyframes/classes live in app/globals.css; the rAF count-up maths lives in
// lib/motion-math.ts. This module wires those to React the idiomatic way (refs + a single
// shared IntersectionObserver), instead of the handoff's DOM-auto-wiring init().
//
// Principles (from the handoff): reveals fire ONCE on entry; only the live dot loops; everything
// degrades to the resting state under prefers-reduced-motion. The reveal class is added to the DOM
// node imperatively in an effect (never during render), so server and client markup match — no
// hydration mismatch, no suppressHydrationWarning needed here.

import { useEffect, useRef } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── One shared IntersectionObserver for every reveal on the page ──────────────────────────────
type Entry = { once: boolean; onEnter: () => void };
const registry = new Map<Element, Entry>();
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const h = registry.get(e.target);
          if (!h) continue;
          h.onEnter();
          if (h.once) {
            observer!.unobserve(e.target);
            registry.delete(e.target);
          }
        }
      },
      // fire a touch before the element is fully in view, so it's mid-animation by the time it lands
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
  }
  return observer;
}

function register(el: Element, entry: Entry) {
  const obs = getObserver();
  if (!obs) {
    entry.onEnter();
    return;
  }
  registry.set(el, entry);
  obs.observe(el);
}

function unregister(el: Element) {
  registry.delete(el);
  observer?.unobserve(el);
}

// Attach to an element to add `.in-view` the first time it scrolls into view (once per mount).
// Reduced motion / no IO support → revealed immediately, no animation.
//
// Tab panels mount display:none (HomeTabs/LeagueTabs toggle `hidden`), and IntersectionObserver
// does NOT reliably fire when an element flips from display:none to visible — content would stay
// stuck at opacity:0. A ResizeObserver DOES fire when the box first appears, so we only register
// with the IO once the element is actually displayed (has layout boxes). That keeps the scroll
// reveal while guaranteeing tab-switched content is never left invisible.
export function useReveal<T extends HTMLElement = HTMLDivElement>(opts?: { once?: boolean }) {
  const once = opts?.once ?? true;
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReduced() || typeof IntersectionObserver === "undefined") {
      el.classList.add("in-view");
      return;
    }
    let armed = false;
    let ro: ResizeObserver | null = null;
    const arm = () => {
      if (armed) return;
      armed = true;
      register(el, { once, onEnter: () => el.classList.add("in-view") });
    };
    const displayed = () => el.getClientRects().length > 0;
    if (displayed()) {
      arm();
    } else if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (displayed()) {
          arm();
          ro?.disconnect();
          ro = null;
        }
      });
      ro.observe(el);
    } else {
      el.classList.add("in-view"); // last-resort: never leave it hidden
    }
    return () => {
      unregister(el);
      ro?.disconnect();
    };
  }, [once]);
  return ref;
}

// Wrapper that reveals its content on scroll. `stagger` cascades the direct children in;
// otherwise the wrapper itself rises in. Animates transform/opacity/filter only (no CLS).
export function Reveal({
  className = "",
  stagger = false,
  once = true,
  style,
  children,
}: {
  className?: string;
  stagger?: boolean;
  once?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useReveal<HTMLDivElement>({ once });
  const base = stagger ? "cf-rv-stagger" : "cf-rv";
  return (
    <div ref={ref} className={className ? `${base} ${className}` : base} style={style}>
      {children}
    </div>
  );
}

// Decorative sliding indicator for an N-item tab bar (underline) or segmented control (thumb).
// Position is driven by React state (active index), so it renders correctly on the server too —
// no flash, no mismatch. The glide itself is the CSS transition on .cf-tab-ind / .cf-seg-thumb.
export function SlideTrack({
  count,
  active,
  variant = "underline",
  className = "",
}: {
  count: number;
  active: number;
  variant?: "underline" | "thumb";
  className?: string;
}) {
  if (count < 1) return null;
  const cls = variant === "thumb" ? "cf-seg-thumb" : "cf-tab-ind";
  return (
    <span
      aria-hidden
      className={className ? `${cls} ${className}` : cls}
      style={{ width: `${100 / count}%`, transform: `translateX(${active * 100}%)` }}
    />
  );
}
