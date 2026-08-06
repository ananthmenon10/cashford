// Step 8 — proves the section/filter behavior (structure A / cross-comp B / my-form A) renders
// from real component behavior, not just the pure helpers underneath. Style mirrors
// tests/phase5/wc-archive-components.test.tsx.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { AnalyticsFeed } from "../../components/AnalyticsFeed";
import type { AnalyticsFeedView } from "../../lib/analytics-feed-load";
import { ANALYTICS_COPY } from "../../lib/analytics-copy";

afterEach(() => cleanup());

function feed(overrides: Partial<AnalyticsFeedView> = {}): AnalyticsFeedView {
  return {
    leagueOptions: [
      { id: "l1", slug: "kk-bois", name: "KK Bois" },
      { id: "l2", slug: "pes-bois", name: "PES Bois" },
    ],
    sections: [
      {
        competitionId: "pl2627",
        competitionName: "Premier League 2026-27",
        kind: "live",
        throughGameweek: 6,
        leagueLines: [{ leagueId: "l1", leagueName: "KK Bois", net: 860 }],
      },
      {
        competitionId: "wc26",
        competitionName: "World Cup 2026",
        kind: "archive",
        throughGameweek: null,
        leagueLines: [{ leagueId: "l2", leagueName: "PES Bois", net: 2860 }],
      },
    ],
    myFormByLeague: {
      l1: {
        leagueId: "l1",
        leagueName: "KK Bois",
        competitionName: "Premier League 2026-27",
        kind: "live",
        net: 860,
        record: null,
        entered: 6,
        sampleNote: ANALYTICS_COPY.gameweekNote(6),
      },
      l2: null,
    },
    allTimeStrip: null,
    ...overrides,
  };
}

describe("AnalyticsFeed — all-time strip (cross-comp B's anchor line)", () => {
  it("renders the strip line when the feed has real all-time data", () => {
    const withStrip = feed({
      allTimeStrip: { net: 3720, leagueCount: 3, competitionCount: 2, settledRounds: 36 },
    });
    render(<AnalyticsFeed feed={withStrip} />);
    expect(screen.getByText(ANALYTICS_COPY.allTimeNet)).toBeInTheDocument();
    expect(screen.getByText(ANALYTICS_COPY.allTimeStrip(3, 2, 36))).toBeInTheDocument();
  });

  it("shows the no-history note instead of a fabricated strip when nothing is settled anywhere", () => {
    render(<AnalyticsFeed feed={feed({ allTimeStrip: null })} />);
    expect(screen.getByText(ANALYTICS_COPY.allTimeNoHistory)).toBeInTheDocument();
  });
});

describe("AnalyticsFeed — structure A (one feed, no sub-tabs) + cross-comp B (per-season sections)", () => {
  it("renders the live section before the archive section, both in the same feed", () => {
    render(<AnalyticsFeed feed={feed()} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Premier League 2026-27")).toBeLessThan(headings.indexOf("World Cup 2026"));
  });

  it("labels the archive section as archived, not blended with the live one", () => {
    render(<AnalyticsFeed feed={feed()} />);
    expect(screen.getByText(ANALYTICS_COPY.archiveKicker)).toBeInTheDocument();
    expect(screen.getAllByText(ANALYTICS_COPY.liveKicker).length).toBeGreaterThan(0);
  });

  it("shows the noSections note instead of a fabricated section when there is none", () => {
    render(<AnalyticsFeed feed={feed({ sections: [] })} />);
    expect(screen.getByText(ANALYTICS_COPY.noSections)).toBeInTheDocument();
  });

  it("shows the noLeagues note when the viewer has no leagues at all", () => {
    render(<AnalyticsFeed feed={feed({ leagueOptions: [] })} />);
    expect(screen.getByText(ANALYTICS_COPY.noLeagues)).toBeInTheDocument();
  });
});

describe("AnalyticsFeed — my-form A (scoped to one league, driven by the filter row)", () => {
  it("defaults my-form to the first league option and shows its own net, not a blend", () => {
    render(<AnalyticsFeed feed={feed()} />);
    expect(screen.getByText(ANALYTICS_COPY.myFormSub("KK Bois", "Premier League 2026-27"))).toBeInTheDocument();
  });

  it("shows the no-history note for a league with no settled form, instead of a fabricated card", () => {
    const withL2First = feed({
      leagueOptions: [
        { id: "l2", slug: "pes-bois", name: "PES Bois" },
        { id: "l1", slug: "kk-bois", name: "KK Bois" },
      ],
    });
    render(<AnalyticsFeed feed={withL2First} />);
    expect(screen.getByText(ANALYTICS_COPY.noFormHistory)).toBeInTheDocument();
  });

  it("the filter row offers every viewer league, never an invented all-leagues option", () => {
    render(<AnalyticsFeed feed={feed()} />);
    const select = screen.getByLabelText(ANALYTICS_COPY.filterLabel) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["KK Bois", "PES Bois"]);
  });

  it("switching the league filter swaps the my-form sub-line to the newly selected league, never a blend", () => {
    const withBothForms = feed({
      myFormByLeague: {
        l1: {
          leagueId: "l1",
          leagueName: "KK Bois",
          competitionName: "Premier League 2026-27",
          kind: "live",
          net: 860,
          record: null,
          entered: 6,
          sampleNote: ANALYTICS_COPY.gameweekNote(6),
        },
        l2: {
          leagueId: "l2",
          leagueName: "PES Bois",
          competitionName: "World Cup 2026",
          kind: "archive",
          net: 2860,
          record: "1–1–0",
          entered: 2,
          sampleNote: ANALYTICS_COPY.sampleNote(2),
        },
      },
    });
    render(<AnalyticsFeed feed={withBothForms} />);
    expect(screen.getByText(ANALYTICS_COPY.myFormSub("KK Bois", "Premier League 2026-27"))).toBeInTheDocument();

    const select = screen.getByLabelText(ANALYTICS_COPY.filterLabel) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "l2" } });

    expect(screen.getByText(ANALYTICS_COPY.myFormSub("PES Bois", "World Cup 2026"))).toBeInTheDocument();
    expect(screen.queryByText(ANALYTICS_COPY.myFormSub("KK Bois", "Premier League 2026-27"))).not.toBeInTheDocument();
  });
});
