import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveInvite, stashInviteAndGo, joinLeague } from "@/app/leagues/join/actions";
import { JoinButton } from "./JoinButton";

type Props = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const dto = await resolveInvite(token);

  // ── not found ─────────────────────────────────────────────────────────────
  if (dto.status === "notfound") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
        <div className="w-full max-w-[360px] rounded-card border border-border bg-surface p-6 text-center">
          <div className="mb-2 text-2xl font-extrabold tracking-tight">Invite not found</div>
          <div className="mb-5 text-sm text-muted">
            This link is invalid. Ask your captain to share a fresh one.
          </div>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-control bg-primary py-3 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  // ── revoked ───────────────────────────────────────────────────────────────
  if (dto.status === "revoked") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
        <div className="w-full max-w-[360px] rounded-card border border-border bg-surface p-6 text-center">
          <div className="mb-2 text-2xl font-extrabold tracking-tight">Link expired</div>
          <div className="mb-1 text-sm text-muted">This invite link is no longer active.</div>
          <div className="mb-5 text-sm text-muted">Ask the captain for a new link.</div>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-control bg-primary py-3 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  // ── active invite ─────────────────────────────────────────────────────────
  const { leagueId, slug, leagueName, captainName, memberCount, stakeInr } = dto;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Logged-in branches
  if (user) {
    const admin = createServiceRoleClient();

    // Captain?
    const { data: league } = await admin
      .from("leagues")
      .select("created_by")
      .eq("id", leagueId)
      .single();

    if (league?.created_by === user.id) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
          <div className="w-full max-w-[360px] rounded-card border border-border bg-surface p-6 text-center">
            <div className="mb-1 text-2xl font-extrabold tracking-tight">You manage {leagueName}</div>
            <div className="mb-5 text-sm text-muted">You created this league.</div>
            <Link
              href={`/leagues/${slug}`}
              className="inline-flex w-full items-center justify-center rounded-control bg-primary py-3 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
            >
              Open league →
            </Link>
          </div>
        </main>
      );
    }

    // Already a member? (league_members has no "id" column — its PK is the
    // composite (league_id, user_id); select a real column.)
    const { data: existing } = await admin
      .from("league_members")
      .select("user_id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
          <div className="w-full max-w-[360px] rounded-card border border-border bg-surface p-6 text-center">
            <div className="mb-1 text-2xl font-extrabold tracking-tight">
              You&apos;re already in {leagueName}
            </div>
            <div className="mb-5 text-sm text-muted">Jump back in.</div>
            <Link
              href={`/leagues/${slug}`}
              className="inline-flex w-full items-center justify-center rounded-control bg-primary py-3 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
            >
              Open league →
            </Link>
          </div>
        </main>
      );
    }

    // Not a member — show join button. Wrap joinLeague to the useActionState shape.
    async function joinAction_(_prev: { error: string | null }, _fd: FormData) {
      "use server";
      const result = await joinLeague(token);
      return result ?? { error: null };
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
        <div className="w-full max-w-[360px]">
          <div className="mb-4 rounded-card border border-border bg-surface p-5">
            <div className="mb-1 text-xl font-extrabold tracking-tight">{leagueName}</div>
            <div className="text-sm text-muted">Captain: {captainName}</div>
            <div className="mt-1 text-sm text-muted">
              {memberCount} {memberCount === 1 ? "player" : "players"} · ₹{stakeInr}/match
            </div>
          </div>
          <JoinButton action={joinAction_} stakeInr={stakeInr} />
        </div>
      </main>
    );
  }

  // ── logged out ────────────────────────────────────────────────────────────
  const stashAndSignup = stashInviteAndGo.bind(null, token, "/signup");
  const stashAndLogin = stashInviteAndGo.bind(null, token, "/login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
      <div className="w-full max-w-[360px]">
        <div className="mb-4 rounded-card border border-border bg-surface p-5">
          <div className="mb-1 text-xl font-extrabold tracking-tight">{leagueName}</div>
          <div className="text-sm text-muted">Captain: {captainName}</div>
          <div className="mt-1 text-sm text-muted">
            {memberCount} {memberCount === 1 ? "player" : "players"} · ₹{stakeInr}/match
          </div>
        </div>

        <form action={stashAndSignup} className="mb-3">
          <button
            type="submit"
            className="w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
          >
            Create account to join
          </button>
        </form>

        <form action={stashAndLogin}>
          <button
            type="submit"
            className="w-full rounded-control border border-border bg-surface py-3.5 text-[15px] font-semibold text-primary-press"
          >
            I already have an account — log in
          </button>
        </form>
      </div>
    </main>
  );
}
