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

import { useCallback, useEffect, useRef, useState } from "react";
import { inr } from "@/components/ui";
import { countUpFrame } from "@/lib/motion-math";

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

// Run `onVisible` the first time `el` is genuinely visible (displayed AND scrolled into view).
// Returns a cleanup. Reduced motion / no IO → fire immediately.
//
// Tab panels mount display:none (HomeTabs/LeagueTabs toggle `hidden`), and IntersectionObserver
// does NOT reliably fire when an element flips from display:none to visible — content would stay
// stuck. A ResizeObserver DOES fire when the box first appears, so we only register with the IO
// once the element is actually displayed (has layout boxes). Shared by useReveal and <CountUp/>.
function observeVisible(el: Element, once: boolean, onVisible: () => void): () => void {
  if (prefersReduced() || typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }
  let armed = false;
  let cleaned = false;
  let ro: ResizeObserver | null = null;
  const arm = () => {
    if (armed || cleaned) return;
    armed = true;
    register(el, { once, onEnter: onVisible });
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
    onVisible(); // last-resort: never leave it hidden
  }
  return () => {
    cleaned = true;
    unregister(el);
    ro?.disconnect();
  };
}

// Attach to an element to add `.in-view` the first time it scrolls into view (once per mount).
export function useReveal<T extends Element = HTMLDivElement>(opts?: { once?: boolean }) {
  const once = opts?.once ?? true;
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeVisible(el, once, () => el.classList.add("in-view"));
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

// ── Count-up number ─────────────────────────────────────────────────────────────────────────
function formatNum(n: number, kind: "inr" | "pct" | "int"): string {
  const r = Math.round(n);
  if (kind === "pct") return `${r}%`;
  if (kind === "inr") return inr(r);
  return String(r);
}

// Rolls 0 → value (eased) the first time it's visible; re-rolls when `value` changes; pops on
// settle. SSR/first render shows the final value (correct + no-JS friendly), then the client takes
// over after mount (suppressHydrationWarning). Reduced motion → final value, no roll. `kind` is a
// string (not a formatter fn) so a Server Component can render <CountUp/> across the RSC boundary.
export function CountUp({
  value,
  kind = "int",
  className = "",
}: {
  value: number;
  kind?: "inr" | "pct" | "int";
  className?: string;
}) {
  const [display, setDisplay] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const raf = useRef<number | null>(null);
  const last = useRef(value); // last target rolled to
  const valueRef = useRef(value); // latest prop, for the first-visible start
  const started = useRef(false);
  valueRef.current = value;

  const animateTo = useCallback((from: number, to: number) => {
    if (prefersReduced() || typeof requestAnimationFrame === "undefined" || typeof performance === "undefined") {
      setDisplay(to);
      return;
    }
    if (raf.current != null) cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      setDisplay(countUpFrame(from, to, p));
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        raf.current = null;
        setDisplay(to);
        const el = ref.current;
        if (el) { el.classList.remove("cf-pop"); void el.offsetWidth; el.classList.add("cf-pop"); }
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return observeVisible(el, true, () => {
      started.current = true;
      last.current = valueRef.current;
      animateTo(0, valueRef.current);
    });
  }, [animateTo]);

  useEffect(() => {
    if (!started.current || value === last.current) return;
    const from = last.current;
    last.current = value;
    animateTo(from, value);
  }, [value, animateTo]);

  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  return (
    <span ref={ref} className={`inline-block tabular ${className}`} suppressHydrationWarning>
      {formatNum(display ?? value, kind)}
    </span>
  );
}

// ── Accuracy ring (SVG) ───────────────────────────────────────────────────────────────────────
// r=26 → C≈163.36 (matches the cf-ringFill keyframe). `pct` is 0..1 or null. The arc sweeps to its
// target when the surrounding stagger reveals; the centre % counts up in sync.
export function AccuracyRing({ pct, size = 78 }: { pct: number | null; size?: number }) {
  const C = 163.36;
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  const offset = C * (1 - frac);
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 92 92" width={size} height={size} className="-rotate-90">
        <circle cx="46" cy="46" r="26" fill="none" stroke="var(--color-subtle)" strokeWidth="8" />
        <circle
          className="cf-ring-prog"
          cx="46" cy="46" r="26" fill="none"
          stroke="var(--color-primary)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute font-mono text-[17px] font-bold tabular">
        {pct == null ? "—" : <CountUp value={frac * 100} kind="pct" />}
      </span>
    </span>
  );
}

// ── Live goal flash ─────────────────────────────────────────────────────────────────────────
// Renders a score; replays the flash when the value ACTUALLY changes (never on a timer).
export function ScoreFlash({ value, className = "" }: { value: number | string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    const el = ref.current;
    if (!el || prefersReduced()) return;
    el.classList.remove("cf-flash");
    void el.offsetWidth;
    el.classList.add("cf-flash");
  }, [value]);
  return <span ref={ref} className={`cf-score ${className}`}>{value}</span>;
}
