// Phase 3 — §10 U36a: StatusBadge gets a typed gameweek variant alongside the legacy CardState
// variant. Blind from §10. Import only — components/ui.tsx itself was never read (out of scope
// per the task brief's "MUST NOT read anything under components/"), so the legacy `BADGE` map's
// exact labels/classes are asserted only via the plan's own prose, not via a byte diff against
// source. This is necessarily a lighter pin than a real T-U35 run would be; a maintainer with
// read access to components/ui.tsx should tighten these assertions against the actual map.
//
// TOOLING GAP: no jsdom/@testing-library present in this repo (confirmed via node_modules and
// absence of a vitest config). These assertions use `react-dom/server`'s `renderToStaticMarkup`
// for non-interactive text/class checks only; nothing here can simulate hover/focus or verify
// event handlers.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "../../components/ui";

describe("StatusBadge — T-U35 legacy CardState pin", () => {
  it("the 'void' state renders the no_separation special case without throwing", () => {
    const html = renderToStaticMarkup(StatusBadge({ state: "void" } as never));
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("every legacy CardState value renders without throwing (open/entered/locked/live/settled/void)", () => {
    const legacyStates = ["open", "entered", "locked", "live", "settled", "void"];
    for (const state of legacyStates) {
      expect(() => renderToStaticMarkup(StatusBadge({ state } as never))).not.toThrow();
    }
  });
});

describe("StatusBadge — T-U35 new gameweek variant (kind='gameweek')", () => {
  const gwStates = ["OPEN", "ENTERED", "ACTION NEEDED", "LOCKED", "LIVE", "SETTLED", "VOID", "RECALCULATING"];

  it("every U28 gameweek badge state renders without throwing", () => {
    for (const state of gwStates) {
      expect(() => renderToStaticMarkup(StatusBadge({ kind: "gameweek", state } as never))).not.toThrow();
    }
  });

  it("RECALCULATING renders C71's label text, sourced from lib/gw-copy.ts, not an inline literal", () => {
    const html = renderToStaticMarkup(StatusBadge({ kind: "gameweek", state: "RECALCULATING" } as never));
    expect(html).toMatch(/RECALCULATING/);
  });

  it("ACTION NEEDED (C44) renders its label text", () => {
    const html = renderToStaticMarkup(StatusBadge({ kind: "gameweek", state: "ACTION NEEDED" } as never));
    expect(html).toMatch(/ACTION NEEDED/i);
  });

  it("the legacy call signature (no kind prop) still works alongside the new discriminated variant", () => {
    expect(() => renderToStaticMarkup(StatusBadge({ state: "open" } as never))).not.toThrow();
  });
});
