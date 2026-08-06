// Step 7B — proves item 4 (partial results must not blank Correct/Exact, only Net) and the
// AC8/AC9 recap notes render from real component behavior, not just the pure helpers underneath.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { WcFinalStandings } from "../../components/archive/WcFinalStandings";
import { WcRecap } from "../../components/archive/WcRecap";
import type { WcArchiveStanding } from "../../lib/wc-archive";
import { ARCHIVE_COPY, PHASE5_UI_COPY } from "../../lib/payment-copy";

afterEach(() => cleanup());

function row(overrides: Partial<WcArchiveStanding> = {}): WcArchiveStanding {
  return {
    userId: "u1",
    name: "Ananth",
    correct: 5,
    exact: 2,
    entriesCount: 7,
    netInr: 500,
    unavailable: false,
    finish: 1,
    ...overrides,
  };
}

describe("WcFinalStandings — item 4 (partial results scope unavailable to Net only)", () => {
  it("still shows real Correct/Exact counts when the row is marked unavailable", () => {
    render(<WcFinalStandings rows={[row({ unavailable: true, correct: 3, exact: 1 })]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // Net only
  });

  it("blanks only the Net cell, not the whole row, when unavailable", () => {
    render(<WcFinalStandings rows={[row({ unavailable: true, netInr: null })]} />);
    expect(screen.getByText(ARCHIVE_COPY.resultUnavailable)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("labels a departed member without hiding their standing", () => {
    render(<WcFinalStandings rows={[row({ isPastMember: true })]} />);
    expect(screen.getByText(PHASE5_UI_COPY.pastMember)).toBeInTheDocument();
    expect(screen.getByText("Ananth")).toBeInTheDocument();
  });

  it("renders late joiners with the not-in-this-one note, not fabricated zero rows", () => {
    render(
      <WcFinalStandings
        rows={[row()]}
        lateMembers={[{ userId: "u2", name: "Late Larry" }]}
      />,
    );
    expect(screen.getByText("Late Larry")).toBeInTheDocument();
    expect(screen.getByText(ARCHIVE_COPY.lateMember)).toBeInTheDocument();
  });
});

describe("WcRecap — AC8/AC9 notes replace a fabricated recap", () => {
  it("shows the late-member note instead of a finish line when the viewer joined late", () => {
    render(<WcRecap row={row()} mineIsLate />);
    expect(screen.getByText(ARCHIVE_COPY.lateMember)).toBeInTheDocument();
    expect(screen.queryByText(/Finish/)).not.toBeInTheDocument();
  });

  it("shows the no-entries note when the viewer never entered a World Cup match here", () => {
    render(<WcRecap row={row({ entriesCount: 0 })} />);
    expect(screen.getByText(ARCHIVE_COPY.noEntries)).toBeInTheDocument();
  });

  it("shows Net — when the row is unavailable, not a fabricated amount", () => {
    render(<WcRecap row={row({ unavailable: true, netInr: 500 })} />);
    expect(screen.getByText("Net —")).toBeInTheDocument();
  });

  it("renders nothing for a null row (no participation at all)", () => {
    const { container } = render(<WcRecap row={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
