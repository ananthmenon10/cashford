// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, Avatar, chipColor, inr } from "./ui";
import type { CardState } from "@/lib/contest-state";

describe("StatusBadge", () => {
  it("labels each card state (settled variants collapse to SETTLED)", () => {
    const cases: [CardState, string][] = [
      ["open_nopick", "OPEN"], ["live", "LIVE"], ["settling", "FT"],
      ["won", "SETTLED"], ["lost", "SETTLED"], ["void", "VOID"], ["cancelled", "CANCELLED"],
    ];
    for (const [state, label] of cases) {
      const { unmount } = render(<StatusBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the LOCKED badge for an unknown state", () => {
    render(<StatusBadge state={"bogus" as CardState} />);
    expect(screen.getByText("LOCKED")).toBeInTheDocument();
  });
});

describe("chipColor", () => {
  it("is deterministic and within the palette", () => {
    expect(chipColor("BRA")).toBe(chipColor("BRA"));
    expect(chipColor("BRA")).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("Avatar", () => {
  it("derives up-to-two uppercase letter initials", () => {
    const { rerender } = render(<Avatar label="Ananth Menon" />);
    expect(screen.getByText("AN")).toBeInTheDocument();
    rerender(<Avatar label="12 #!" />);
    expect(screen.getByText("?")).toBeInTheDocument(); // no letters → placeholder
  });
});

describe("inr", () => {
  it("signs and groups rupee amounts (Indian digit grouping)", () => {
    expect(inr(0)).toBe("₹0");
    expect(inr(500)).toBe("+₹500");
    expect(inr(-1200)).toBe("−₹1,200");
    expect(inr(150000)).toBe("+₹1,50,000");
  });
});
