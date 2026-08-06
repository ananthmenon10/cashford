// Phase 3 — §6 Entry sheet: T-U12-T-U17 (stepper clamp 0-9, completeness, atomic first-save via
// exactly one POST /api/gw/enter, edit-save via /api/gw/picks, error mapping U21, sessionStorage
// cleared on save), plus U22's mirror prompt. Blind from §6, reconciled against the real
// components/gw/EntrySheet.tsx and components/gw/MirrorPrompt.tsx during the fix round.
//
// Canonical per the fix round: this repo DOES have jsdom + @testing-library/react (vitest.config.ts
// scopes jsdom to this file via environmentMatchGlobs). The tooling gap flagged by the original
// blind author no longer applies — these are real render/interaction tests, not skipped
// placeholders.
//
// Four cases below are explicit regressions caught in Sol's fix round (not blind guesses):
//   B4 — the deadline-passed / gameweek-closed mapping to C55 is keyed on the response body's
//        MESSAGE TEXT (a case-insensitive regex match), not an HTTP status code. A server that
//        returns 400 with that message must still read-only the sheet.
//   M7 — any other 4xx message not matched by a specific rule surfaces verbatim as `error`, and
//        `reloadRequired` is set only when the message itself says "reload" (not a general retry).
//   M8 — MirrorPrompt's 409 handler produces ONE error string PER TARGET LEAGUE, not one shared
//        error — a stake-mismatch error for league A must not also appear against league B.
//   M9 — MirrorPrompt's "Not now" button is gated only on `pending`, not on `chosen.length` — a
//        user who has unchecked every league can still decline.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { EntrySheet } from "../../components/gw/EntrySheet";
import { MirrorPrompt } from "../../components/gw/MirrorPrompt";
import { PotSummary } from "../../components/gw/PotSummary";
import type { GameweekViewDTO, MirrorTarget } from "../../lib/gw-view";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function fixture(id: string, overrides: Partial<GameweekViewDTO["fixtures"][number]> = {}) {
  return {
    fixtureId: id,
    membershipId: `m-${id}`,
    state: "active" as const,
    voidReason: null,
    kickoffAt: "2026-02-03T10:30:00.000Z",
    status: "scheduled",
    minute: null,
    homeScore: null,
    awayScore: null,
    homeName: `Home ${id}`,
    awayName: `Away ${id}`,
    homeShort: "HOM",
    awayShort: "AWY",
    ...overrides,
  };
}

function view(overrides: Partial<GameweekViewDTO> = {}): GameweekViewDTO {
  return {
    league: { id: "l1", name: "KK Bois", slug: "kk-bois", createdBy: "u1", status: "active" },
    participation: { format: "gameweek" } as GameweekViewDTO["participation"],
    competition: { id: "c1", name: "Premier League", format: "league" },
    gameweek: { id: "gw24", number: 24, name: "Gameweek 24", status: "open", deadlineAt: "2026-02-03T10:30:00.000Z" },
    hasSettledHistory: false,
    adjacentGameweeks: [],
    contest: { id: "contest1", status: "open", stakeInr: 100, deadlineAt: "2026-02-03T10:30:00.000Z", inputVersion: 1 },
    lifecycle: "CL2" as GameweekViewDTO["lifecycle"],
    viewerParticipation: "VP1" as GameweekViewDTO["viewerParticipation"],
    render: {} as GameweekViewDTO["render"],
    fixtures: [fixture("f1"), fixture("f2")],
    viewerEntry: null,
    viewerPicks: [],
    revealedPicks: [],
    standings: [],
    result: null,
    enteredCount: 0,
    eligibleCount: 6,
    potInr: 0,
    isDoubleGameweek: false,
    viewerEligibleFromGameweekNumber: 1,
    nudge: null,
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
  push.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function setScore(container: HTMLElement, side: "home" | "away", label: "increase" | "decrease", times = 1) {
  const name = side === "home"
    ? (label === "increase" ? "Increase home score" : "Decrease home score")
    : (label === "increase" ? "Increase away score" : "Decrease away score");
  const buttons = within(container).getAllByLabelText(name);
  for (let i = 0; i < times; i++) fireEvent.click(buttons[0]);
}

describe("zero-active-fixtures guard — Save is disabled rather than posting picks: []", () => {
  it("with no active fixtures, Save is disabled and never issues a request", () => {
    render(<EntrySheet viewerId="test-viewer" view={view({ fixtures: [] })} mirrorTargets={[]} />);
    const saveButton = screen.getByRole("button", { name: /Enter for/ });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("T-U12 — ScoreStepper clamps 0-9", () => {
  it("clamps at 0: the decrease button is disabled at the untouched 0-0 default", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const homeButtons = within(container).getAllByLabelText("Decrease home score");
    // Every pick now defaults to 0-0 (not null), so the decrease button is already disabled at
    // its floor on first render — no setup click needed to reach 0.
    expect(homeButtons[0]).toBeDisabled();
  });

  it("clamps at 9: incrementing above 9 has no effect (the button disables itself at 9)", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    // The default is already 0, so 9 clicks land exactly on 9.
    setScore(container, "home", "increase", 9);
    const homeButtons = within(container).getAllByLabelText("Increase home score");
    expect(homeButtons[0]).toBeDisabled();
    const display = within(container).getAllByText("9");
    expect(display.length).toBeGreaterThan(0);
  });
});

describe("T-U19 — progress line (ENTRY_SHEET_COPY.chosenProgress) counts touched fixtures", () => {
  it("shows '0/2 chosen' with no interaction, '1/2 chosen' once one fixture has been touched", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    expect(screen.getByText("0/2 chosen")).toBeTruthy();
    const fixtures = container.querySelectorAll(".divide-y > div");
    // Touching either side of a fixture marks the whole pick "touched" — the guard cares about
    // decisions made, not individual score cells filled in.
    setScore(fixtures[0] as HTMLElement, "home", "increase", 1);
    expect(screen.getByText("1/2 chosen")).toBeTruthy();
  });
});

describe("T-U13/T-U20 — the 0-0 confirm guard arms on save instead of blocking it", () => {
  it("with every fixture still at the untouched default, save is never disabled but the first tap arms the guard instead of posting", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const saveButton = screen.getByRole("button", { name: /Enter for/ });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("2 picks left at 0-0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tap again to save 2 picks at 0-0" })).toBeTruthy();
  });

  it("a second tap after arming saves through even though picks are still untouched, posting predHome/predAway 0 for every fixture", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tap again to save 2 picks at 0-0" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.picks).toHaveLength(2);
    for (const pick of body.picks) {
      expect(pick.predHome).toBe(0);
      expect(pick.predAway).toBe(0);
    }
  });

  it("double-tapping the Save button alone (without ever tapping the confirm bar's button) never submits", () => {
    render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const saveButton = screen.getByRole("button", { name: /Enter for/ });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();
    // the guard stays armed, showing the same distinct confirm control rather than having
    // submitted through repeated taps on the original button.
    expect(screen.getByRole("button", { name: "Tap again to save 2 picks at 0-0" })).toBeTruthy();
  });

  it("once every fixture has been touched, the guard never arms — a single tap saves immediately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe("untouched -> touched pick transitions clear the muted 0-0 default styling", () => {
  it("clicking a stepper on an untouched fixture marks it touched and drops its 'DEFAULT 0–0' tag", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    expect(screen.getAllByText("DEFAULT 0–0")).toHaveLength(2);
    const fixtures = container.querySelectorAll(".divide-y > div");
    setScore(fixtures[0] as HTMLElement, "home", "increase", 1);
    expect(screen.getAllByText("DEFAULT 0–0")).toHaveLength(1);
  });

  it("clicking a quick-score chip also marks the fixture touched, same as using the stepper", () => {
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    const chip = within(fixtures[0] as HTMLElement).getByRole("button", { name: "1-1" });
    fireEvent.click(chip);
    expect(screen.getAllByText("DEFAULT 0–0")).toHaveLength(1);
    // the chip itself now reflects the fixture's actual pick.
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("an already-entered fixture (existing viewer pick) starts touched even if its saved pick is 0-0 — the muted default is about an undecided pick, not the literal score", () => {
    render(
      <EntrySheet
        viewerId="test-viewer"
        view={view({
          viewerEntry: { id: "e1", status: "entered" },
          viewerPicks: [
            { fixtureId: "f1", predHome: 0, predAway: 0 },
            { fixtureId: "f2", predHome: 2, predAway: 1 },
          ],
        })}
        mirrorTargets={[]}
      />,
    );
    expect(screen.queryByText("DEFAULT 0–0")).toBeNull();
    expect(screen.getByText("2/2 chosen")).toBeTruthy();
  });
});

describe("T-U14 — first save vs. edit save hit different endpoints, exactly once", () => {
  async function completeAndSave(container: HTMLElement) {
    // The default is already 0, so 1 click per side lands on a real non-zero value (1), letting
    // the payload assertion below tell "picked" apart from the untouched 0-0 default.
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    const saveButton = screen.getByRole("button", { name: /Save picks|Enter for/ });
    fireEvent.click(saveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  }

  it("no existing entry: EXACTLY ONE POST to /api/gw/enter with the full pick payload, never /api/gw/picks", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    await completeAndSave(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/gw/enter");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.picks).toHaveLength(2);
    expect(body.picks.every((p: { predHome: number; predAway: number }) => p.predHome === 1 && p.predAway === 1)).toBe(true);
  });

  it("with an existing entry: POST goes to /api/gw/picks, not /api/gw/enter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(
      <EntrySheet viewerId="test-viewer" view={view({ viewerEntry: { id: "e1", status: "entered" } })} mirrorTargets={[]} />,
    );
    await completeAndSave(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/gw/picks");
  });
});

describe("B4/F8 regression — deadline-passed mapping is keyed on message text, not status code, and branches on first-save vs. edit (R-4/C55b)", () => {
  it("first save (no existing entry): a 400 'deadline has passed' body maps to C55b — never staked, not C55's 'last saved picks stand'", async () => {
    // N6 (F8 micro-slice): a first-save deadline failure isn't taken at face value — EntrySheet
    // sends a second GET to /api/gw/contest to confirm there's truly no entry before it commits to
    // C55b, because the mirror path can create an entry after this component's initial page-load
    // snapshot (the whole reason firstSave alone was unsafe). Queue that second response.
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, { myEntry: null }));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("The deadline passed. Your last saved picks stand.")).toBeNull();
    // confirms the verification round-trip actually happened, not a coincidental default.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/gw/contest?league=l1&gw=gw24");
    // read-only: the stepper buttons are now disabled even though 1/1 is a legal value.
    const homeIncrease = within(container).getAllByLabelText("Increase home score")[0];
    expect(homeIncrease).toBeDisabled();
  });

  it("first save, mirror-race case: the verification GET finds an existing entry after all, so the deadline failure maps to C55 — the mirror-created entry's picks stand, not C55b's never-staked wording", async () => {
    // This is the exact race N6 was written for: the page loaded with viewerEntry === null, but by
    // the time the deadline-passed rejection comes back, a mirror-copy from another league has
    // already created a real entry server-side. The verification GET is the source of truth, not
    // the page-load snapshot — it must win.
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, { myEntry: { id: "e9", status: "entered" } }));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("The deadline passed. Your last saved picks stand.")).toBeTruthy());
    expect(
      screen.queryByText(
        "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
      ),
    ).toBeNull();
  });

  it("R4-7: a verified entry with status 'invalid' maps to C55b, same as myEntry: null — an invalid entry staked nothing", async () => {
    // The verification GET can come back with a real entry row whose status is "invalid" (e.g.
    // voided by an admin) rather than no row at all. R4-7: that must read the same as no entry —
    // C55b's "you have no stake in the pot" — not C55's "your last saved picks stand", which
    // would be wrong for a stake that was never actually placed.
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, { myEntry: { id: "e9", status: "invalid" } }));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("The deadline passed. Your last saved picks stand.")).toBeNull();
  });

  it("first save, verification GET fails: falls back to the neutral C55 wording, not C55b, when entry state can't be confirmed", async () => {
    // An unknown entry state must never claim "you have no stake" — that's the one wording that's
    // actively wrong if an entry does exist. A failed/non-OK verification check is the unsafe case,
    // so it must fall back to C55, not default to the stronger, riskier C55b claim.
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 500, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("The deadline passed. Your last saved picks stand.")).toBeTruthy());
    expect(
      screen.queryByText(
        "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
      ),
    ).toBeNull();
  });

  it("edit save (existing entry): the same server message maps to C55 — the entrant's last saved picks stand", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    const { container } = render(
      <EntrySheet viewerId="test-viewer" view={view({ viewerEntry: { id: "e1", status: "entered" } })} mirrorTargets={[]} />,
    );
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Save picks/ }));
    await waitFor(() => expect(screen.getByText("The deadline passed. Your last saved picks stand.")).toBeTruthy());
    expect(
      screen.queryByText(
        "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
      ),
    ).toBeNull();
    const homeIncrease = within(container).getAllByLabelText("Increase home score")[0];
    expect(homeIncrease).toBeDisabled();
  });
});

describe("M7/F5 regression — raw server prose never renders; every message maps through the C-ID table (C56 fallback), reload keyed on the mapped rule", () => {
  it("a message unmatched by any entry rule shows the C56 fallback copy, never the raw server string, but still flags the referenced fixture invalid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "picks.0: score must be between 0 and 9" }));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
    expect(screen.queryByText("picks.0: score must be between 0 and 9")).toBeNull();
    expect(screen.queryByText("Reload gameweek")).toBeNull();
    // the first fixture is still flagged invalid via aria-invalid — that match runs on the raw
    // message text before it's mapped to copy, so it's unaffected by the C56 fallback.
    expect(fixtures[0]).toHaveAttribute("aria-invalid", "true");
  });

  it("a 'prediction is missing' message shows the reload-gameweek retry button (C74, reload: true)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 400, { error: "prediction is missing for 1 of 2 fixtures — please reload" }),
    );
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("Reload gameweek")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("This gameweek changed. Reload the page and try again.")).toBeTruthy());
  });

  it("a message that only SAYS 'reload' but doesn't match a reload-flagged rule does NOT show the reload button — proving reload comes from the mapped rule, not a 'reload' substring", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "please reload" }));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
    expect(screen.queryByText("Reload gameweek")).toBeNull();
  });
});

describe("T-U21 — network/5xx failure maps to C56, with a retry that re-posts the identical payload", () => {
  it("a 500 response shows C56; clicking save again re-issues the same payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 500, {}));
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    const saveButton = screen.getByRole("button", { name: /Enter for/ });
    fireEvent.click(saveButton);
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
    fireEvent.click(saveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [firstBody] = [JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)];
    const [secondBody] = [JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)];
    expect(secondBody).toEqual(firstBody);
  });

  it("a thrown network error (fetch rejects) also maps to C56", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
  });
});

describe("T-U16/T-U17 — sessionStorage draft key is cleared on a successful save, never shown as a label", () => {
  it("cf-gw-draft:<contestId> is written while editing and removed after a successful save", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    setScore(fixtures[0] as HTMLElement, "home", "increase", 1);
    await waitFor(() => expect(window.sessionStorage.getItem("cf-gw-draft:contest1:test-viewer")).not.toBeNull());
    // never rendered anywhere as a "draft" label.
    expect(screen.queryByText(/draft/i)).toBeNull();
    setScore(fixtures[0] as HTMLElement, "away", "increase", 1);
    setScore(fixtures[1] as HTMLElement, "home", "increase", 1);
    setScore(fixtures[1] as HTMLElement, "away", "increase", 1);
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(window.sessionStorage.getItem("cf-gw-draft:contest1:test-viewer")).toBeNull());
  });
});

describe("stale sessionStorage draft regression — a deployed null-score draft format never restores a blank, wrongly-touched pick", () => {
  it("a cached draft in the old {home: number|null, away: number|null} shape (no `touched`) is dropped, leaving the fixture at its untouched 0-0 default rather than a null score", async () => {
    window.sessionStorage.setItem(
      "cf-gw-draft:contest1:test-viewer",
      JSON.stringify({ f1: { home: null, away: null }, f2: { home: 2, away: 1 } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view()} mirrorTargets={[]} />);
    // f1's stale null draft was dropped, so it stays untouched (default tag shown) while f2's
    // valid draft restored as touched.
    await waitFor(() => expect(screen.getAllByText("DEFAULT 0–0")).toHaveLength(1));
    const homeDecrease = within(container.querySelectorAll(".divide-y > div")[0] as HTMLElement).getByLabelText(
      "Decrease home score",
    );
    expect(homeDecrease).toBeDisabled();
    // Saving must never POST a null score for f1 — the guard arms (1 pick still untouched) rather
    // than silently sending predHome: null.
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap again to save 1 pick at 0-0" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const f1 = body.picks.find((p: { fixtureId: string }) => p.fixtureId === "f1");
    expect(f1.predHome).toBe(0);
    expect(f1.predAway).toBe(0);
  });
});

describe("U22 — the mirror prompt gates on having at least one target league", () => {
  it("with zero mirror targets, a successful first save navigates away instead of showing MirrorPrompt", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/leagues/kk-bois?gw=24"));
    expect(screen.queryByText("Use these picks in your other leagues?")).toBeNull();
  });

  it("with a mirror target and a first save, MirrorPrompt renders instead of navigating immediately", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true, 200, {}));
    const targets: MirrorTarget[] = [{ leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 }];
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={targets} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("Use these picks in your other leagues?")).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });
});

describe("M8 regression — MirrorPrompt's 409 response produces one error string per target league, each mapped through mirrorTargetErrorCopy", () => {
  const targets: MirrorTarget[] = [
    { leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 },
    { leagueId: "l3", leagueName: "Solid Yenne Boys", acceptedStakeInr: 200 },
  ];

  it("a stake-mismatch error for one league does not attach to the other league's line", async () => {
    // N8: the route always emits a top-level `error` alongside `targets` (never targets-only) —
    // mock the real shape, not the old client's accidental hasTargets/!error fallback guess.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 409, {
        error: "nothing was copied",
        targets: [{ leagueId: "l2", error: "stake mismatch: league expects ₹200" }],
      }),
    );
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    // FLAKE fix: MirrorPrompt's submit() is async (it awaits fetch before calling any setState),
    // so a bare fireEvent.click can leave a state update pending outside of React's act() batch
    // when this test's microtask timing races another test's. Wrapping the click itself in
    // act(async () => ...) — on top of the waitFor below, which already act-wraps its polling —
    // closes that gap.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() =>
      expect(screen.getByText("The ante in PES Bois changed. Open that league to enter.")).toBeTruthy(),
    );
    // exactly one error line rendered, and it does not mention Solid Yenne Boys (that league's
    // *checkbox label* still legitimately says "Solid Yenne Boys", so scope the assertion to the
    // error list itself, not the whole document).
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).queryByText(/Solid Yenne Boys/)).toBeNull();
  });

  it("a fan-out of 4 distinct target errors (C80-C83) each render only against their own league, in order", async () => {
    const fanoutTargets: MirrorTarget[] = [
      { leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 },
      { leagueId: "l3", leagueName: "Solid Yenne Boys", acceptedStakeInr: 200 },
      { leagueId: "l4", leagueName: "Curve Kickers", acceptedStakeInr: 150 },
      { leagueId: "l5", leagueName: "Late Login FC", acceptedStakeInr: 100 },
    ];
    // N8: real route shape — top-level `error` always present alongside `targets`.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 409, {
        error: "nothing was copied",
        targets: [
          { leagueId: "l2", error: "no pot for this league in this gameweek" }, // C80
          { leagueId: "l3", error: "the deadline has passed" }, // C81
          { leagueId: "l4", error: "you are not a member of this league" }, // C82
          { leagueId: "l5", error: "your predictions are out of date" }, // C83
        ],
      }),
    );
    const onDone = vi.fn();
    render(
      <MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={fanoutTargets} onDone={onDone} />,
    );
    // FLAKE fix: MirrorPrompt's submit() is async (it awaits fetch before calling any setState),
    // so a bare fireEvent.click can leave a state update pending outside of React's act() batch
    // when this test's microtask timing races another test's. Wrapping the click itself in
    // act(async () => ...) — on top of the waitFor below, which already act-wraps its polling —
    // closes that gap.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("PES Bois has no pot for this gameweek.")).toBeTruthy();
    expect(within(items[1]).getByText("Solid Yenne Boys is closed for this gameweek.")).toBeTruthy();
    expect(within(items[2]).getByText("You can’t enter this gameweek in Curve Kickers.")).toBeTruthy();
    expect(
      within(items[3]).getByText(
        "Your saved picks can’t be copied to Late Login FC. Reload this gameweek first.",
      ),
    ).toBeTruthy();
    // cross-contamination check: none of the 4 lines mentions a league it doesn't belong to.
    for (const [index, target] of fanoutTargets.entries()) {
      for (const [otherIndex, other] of fanoutTargets.entries()) {
        if (otherIndex === index) continue;
        expect(within(items[index]).queryByText(new RegExp(other.leagueName))).toBeNull();
      }
    }
  });
});

describe("F11/F12 mirror regression — top-level error branches on `targets` presence; wholesale rejection banner renders above the per-target list; 401 disables retry", () => {
  const targets: MirrorTarget[] = [
    { leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 },
    { leagueId: "l3", leagueName: "Solid Yenne Boys", acceptedStakeInr: 200 },
  ];

  it("no `targets` array in the response body: only the top-level banner renders, no per-target list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "invalid JSON body" }));
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    // FLAKE fix: MirrorPrompt's submit() is async (it awaits fetch before calling any setState),
    // so a bare fireEvent.click can leave a state update pending outside of React's act() batch
    // when this test's microtask timing races another test's. Wrapping the click itself in
    // act(async () => ...) — on top of the waitFor below, which already act-wraps its polling —
    // closes that gap.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("N8: a wholesale rejection posts the route's real shape (top-level `error: \"nothing was copied\"` alongside `targets`) — the C79 banner renders above the per-target list, both visible together", async () => {
    // N8 fix: the route always emits `error` — it never relies on the client inferring "nothing
    // was copied" from targets-without-error. Mock the real contract, not the retired guess.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 409, {
        error: "nothing was copied",
        targets: [
          { leagueId: "l2", error: "no pot for this league in this gameweek" },
          { leagueId: "l3", error: "the deadline has passed" },
        ],
      }),
    );
    const onDone = vi.fn();
    const { container } = render(
      <MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />,
    );
    // FLAKE fix: MirrorPrompt's submit() is async (it awaits fetch before calling any setState),
    // so a bare fireEvent.click can leave a state update pending outside of React's act() batch
    // when this test's microtask timing races another test's. Wrapping the click itself in
    // act(async () => ...) — on top of the waitFor below, which already act-wraps its polling —
    // closes that gap.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Nothing was copied to your other leagues.")).toBeTruthy());
    const list = screen.getByRole("list");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // the banner sits above the list in document order (rendered before it in the JSX tree).
    const banner = screen.getByText("Nothing was copied to your other leagues.");
    expect(
      banner.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("proof of teeth (N8): dropping the route's top-level `error` from a targets-only 409 body no longer produces the C79 banner — the client maps payload.error directly and has no hasTargets/!error fallback left to catch it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 409, {
        targets: [{ leagueId: "l2", error: "no pot for this league in this gameweek" }],
      }),
    );
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Couldn’t save your picks. Try again.")).toBeTruthy());
    expect(screen.queryByText("Nothing was copied to your other leagues.")).toBeNull();
  });

  it("a 401 shows the sign-in link with the return path, and disables the retry button", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 401, {}));
    const onDone = vi.fn();
    render(
      <MirrorPrompt
        sourceLeagueId="l1"
        gameweekId="gw24"
        targets={targets}
        onDone={onDone}
        returnPath="/leagues/kk-bois/enter?gw=24"
      />,
    );
    // FLAKE fix: MirrorPrompt's submit() is async (it awaits fetch before calling any setState),
    // so a bare fireEvent.click can leave a state update pending outside of React's act() batch
    // when this test's microtask timing races another test's. Wrapping the click itself in
    // act(async () => ...) — on top of the waitFor below, which already act-wraps its polling —
    // closes that gap.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Your session expired. Sign in again.")).toBeTruthy());
    const signIn = screen.getByRole("link", { name: "Sign in again" });
    expect(signIn).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent("/leagues/kk-bois/enter?gw=24")}`,
    );
    expect(screen.getByRole("button", { name: /Enter in \d+ more leagues/ })).toBeDisabled();
  });
});

describe("M9 regression — MirrorPrompt's 'Not now' is gated only on pending, not on chosen.length", () => {
  it("unchecking every target league still leaves 'Not now' clickable and it calls onDone", () => {
    const targets: MirrorTarget[] = [{ leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 }];
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    // FLAKE fix: keep every MirrorPrompt click flow inside act(), even this synchronous one,
    // so no test in this file relies on fireEvent's implicit (and easy-to-outrun) act batching.
    act(() => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    const notNow = screen.getByRole("button", { name: "Not now" });
    expect(notNow).not.toBeDisabled();
    act(() => {
      fireEvent.click(notNow);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("HANG-PROOF (R4-5) — a verification GET that never settles must not strand the sheet without feedback", () => {
  it("the C55 error and disabled steppers appear immediately after the first-save rejection, without waiting on the verification GET", async () => {
    // R4-5's ordering fix: EntrySheet sets the C55 error and readOnly state BEFORE the
    // verification GET is even sent, then upgrades to C55b only once that GET confirms
    // myEntry:null. Simulate the GET hanging forever (never resolving) — the reviewer's original
    // failure mode was the sheet staying stuck in its pre-error state (still editable, no
    // feedback) for as long as the request was in flight. With the fix, the user sees C55 and a
    // disabled sheet right away regardless of whether the GET ever comes back.
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "The deadline has passed for this gameweek" }));
    fetchMock.mockReturnValueOnce(new Promise(() => {})); // the verification GET: never settles
    const { container } = render(<EntrySheet viewerId="test-viewer" view={view({ viewerEntry: null })} mirrorTargets={[]} />);
    const fixtures = container.querySelectorAll(".divide-y > div");
    for (const el of Array.from(fixtures)) {
      setScore(el as HTMLElement, "home", "increase", 1);
      setScore(el as HTMLElement, "away", "increase", 1);
    }
    fireEvent.click(screen.getByRole("button", { name: /Enter for/ }));
    await waitFor(() => expect(screen.getByText("The deadline passed. Your last saved picks stand.")).toBeTruthy());
    const homeIncrease = within(container).getAllByLabelText("Increase home score")[0];
    expect(homeIncrease).toBeDisabled();
    // still C55, not C55b — the hung GET never confirmed noEntryAtSave, so the safer wording
    // stands indefinitely rather than the sheet showing nothing at all.
    expect(
      screen.queryByText(
        "The deadline passed. You aren’t entered in this gameweek, so you have no stake in the pot.",
      ),
    ).toBeNull();
  });
});

describe("R4-10 — MirrorPrompt shows its own reload control when the mapped error rule says reload: true", () => {
  it("an 'unknown gameweek' mirror error (C74) renders the reload-gameweek button", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 400, { error: "unknown gameweek" }));
    const targets: MirrorTarget[] = [{ leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 }];
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("This gameweek changed. Reload the page and try again.")).toBeTruthy());
    expect(screen.getByText("Reload gameweek")).toBeTruthy();
  });

  it("a top-level mirror error with no reload rule (C79 'nothing was copied') does NOT render the reload button by itself", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 409, { error: "nothing was copied" }));
    const targets: MirrorTarget[] = [{ leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 }];
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Nothing was copied to your other leagues.")).toBeTruthy());
    expect(screen.queryByText("Reload gameweek")).toBeNull();
  });

  it("MINOR-3: a per-target stake-mismatch error (C54) carries reload: true and surfaces the reload button even though the top-level error alone would not", async () => {
    // Before MINOR-3, the mirror stake-mismatch branch didn't set reload: true even though its
    // own copy tells the user to reload and try again. MirrorPrompt ORs reload across the
    // top-level mapping and every per-target mapping (`mapped.reload || targetMappings.some(...)`),
    // so this is the one path that proves the per-target reload flag actually reaches the button.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(false, 409, {
        error: "nothing was copied",
        targets: [{ leagueId: "l2", error: "stake mismatch: league expects ₹200" }],
      }),
    );
    const targets: MirrorTarget[] = [{ leagueId: "l2", leagueName: "PES Bois", acceptedStakeInr: 100 }];
    const onDone = vi.fn();
    render(<MirrorPrompt sourceLeagueId="l1" gameweekId="gw24" targets={targets} onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter in \d+ more leagues/ }));
    });
    await waitFor(() => expect(screen.getByText("Reload gameweek")).toBeTruthy());
    expect(screen.getByText("The ante in PES Bois changed. Open that league to enter.")).toBeTruthy();
  });
});

describe("R4-6/R4-10 — PotSummary suppresses rendering during the open-and-past-deadline cron-lag window, and pins C5/C5b otherwise", () => {
  const DEADLINE = "2026-02-03T10:30:00.000Z";
  const BEFORE_DEADLINE = new Date("2026-02-03T09:00:00.000Z").getTime();
  const AT_OR_AFTER_DEADLINE = new Date(DEADLINE).getTime();

  it("open contest, before the deadline: renders C5 (the live, pre-lock numerator)", () => {
    render(
      <PotSummary
        stakeInr={100}
        potInr={500}
        entered={5}
        eligible={8}
        contestStatus="open"
        deadlineAt={DEADLINE}
        now={BEFORE_DEADLINE}
      />,
    );
    expect(screen.getByText("Pot ₹500 · 5 entered of 8")).toBeTruthy();
  });

  it("R4-6: open contest, at/after the deadline (cron-lag window): renders nothing — a displayed pot must never exceed what settles", () => {
    const { container } = render(
      <PotSummary
        stakeInr={100}
        potInr={500}
        entered={5}
        eligible={8}
        contestStatus="open"
        deadlineAt={DEADLINE}
        now={AT_OR_AFTER_DEADLINE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("locked contest (status !== 'open'): renders C5b even past the deadline — the numerator switch to the locked_in count still applies", () => {
    render(
      <PotSummary
        stakeInr={100}
        potInr={500}
        entered={5}
        eligible={8}
        contestStatus="locked"
        deadlineAt={DEADLINE}
        now={AT_OR_AFTER_DEADLINE}
      />,
    );
    expect(screen.getByText("Pot ₹500 · 5 locked in of 8")).toBeTruthy();
  });

  it("proof of teeth: a locked contest whose deadline is also in the past does NOT get suppressed — the suppression window only applies while status is still 'open'", () => {
    render(
      <PotSummary
        stakeInr={100}
        potInr={500}
        entered={5}
        eligible={8}
        contestStatus="settled"
        deadlineAt={DEADLINE}
        now={AT_OR_AFTER_DEADLINE}
      />,
    );
    expect(screen.getByText("Pot ₹500 · 5 locked in of 8")).toBeTruthy();
  });
});
