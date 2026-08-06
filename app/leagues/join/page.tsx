import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  C69,
  C70,
  GW_ACTION_COPY,
  GW_JOIN_COPY,
  GW_UI_COPY,
  anteSummaryCopy,
  captainCopy,
  competitionSummaryCopy,
  joinAnteCopy,
  memberCountCopy,
} from "@/lib/gw-copy";
import { beforeTimeCopy, firstDeadlinePrefix } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";
import {
  joinLeague,
  resolveInvite,
  stashInviteAndGo,
  submitCode,
} from "./actions";

function CodeForm({ error }: { error: string | null }) {
  return (
    <form action={submitCode} className="flex flex-col">
      <label className="mb-1.5 text-xs font-semibold text-cs2-ink-2" htmlFor="code">
        {GW_JOIN_COPY.inviteCode}
      </label>
      <input
        id="code"
        name="code"
        required
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        maxLength={8}
        placeholder={GW_JOIN_COPY.codePlaceholder}
        className={`w-full rounded-cs2-md border bg-cs2-paper px-3.5 py-3 text-center font-mono text-[22px] font-bold uppercase tracking-[0.15em] outline-none ${
          error ? "border-cs2-red" : "border-cs2-line focus:border-cs2-green"
        }`}
      />
      {error ? (
        <p className="mt-2 text-xs font-semibold text-cs2-red">{error}</p>
      ) : null}
      <button
        type="submit"
        className="mt-[18px] w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white"
      >
        {GW_JOIN_COPY.findLeague}
      </button>
    </form>
  );
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{
    invalid?: string;
    token?: string;
    joinError?: string;
  }>;
}) {
  const query = await searchParams;
  const dto = query.token ? await resolveInvite(query.token) : null;
  const invalid =
    query.invalid === "1" ||
    dto?.status === "notfound" ||
    dto?.status === "revoked";

  if (!dto || dto.status !== "active") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cs2-canvas px-7">
        <div className="w-full max-w-[360px]">
          <Link
            href="/"
            className="mb-5 inline-flex text-sm font-semibold text-cs2-ink-3"
          >
            ← {GW_UI_COPY.back}
          </Link>
          <h1 className="text-2xl font-extrabold">{GW_JOIN_COPY.title}</h1>
          <p className="mb-6 mt-1 text-sm text-cs2-ink-3">
            {GW_JOIN_COPY.subtitle}
          </p>
          <CodeForm error={invalid ? GW_ACTION_COPY.codeNotFound : null} />
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const participationOpen =
    dto.leagueStatus !== "archived" && dto.participation !== "archived";
  const joinLabel =
    dto.participation === "active"
      ? joinAnteCopy(dto.stakeInr)
      : GW_JOIN_COPY.join;
  const inviteToken = dto.token;
  async function joinAction() {
    "use server";
    const result = await joinLeague(inviteToken);
    if (result) {
      redirect(
        `/leagues/join?token=${encodeURIComponent(inviteToken)}&joinError=1`,
      );
    }
  }
  const stashAndSignup = stashInviteAndGo.bind(null, inviteToken, "/signup");
  const stashAndLogin = stashInviteAndGo.bind(null, inviteToken, "/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-cs2-canvas px-7">
      <div className="w-full max-w-[360px]">
        <Link
          href="/leagues/join"
          className="mb-5 inline-flex text-sm font-semibold text-cs2-ink-3"
        >
          ← {GW_UI_COPY.back}
        </Link>
        <div className="mb-4 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-5">
          <h1 className="text-xl font-extrabold">{dto.leagueName}</h1>
          <p className="mt-1 text-sm text-cs2-ink-3">
            {captainCopy(dto.captainName)}
          </p>
          <p className="mt-1 text-sm text-cs2-ink-3">
            {memberCountCopy(dto.memberCount)}
          </p>
          {dto.participation === "none" ? (
            <p className="mt-3 rounded-cs2-md bg-cs2-amber-soft p-3 text-sm font-semibold text-cs2-amber">
              {C70}
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm font-bold">
                {competitionSummaryCopy(
                  dto.competitionName,
                  dto.competitionFormat,
                )}
              </p>
              {dto.participation === "active" ? (
                <p className="mt-1 text-sm text-cs2-ink-3">
                  {anteSummaryCopy(dto.anteInr)}
                </p>
              ) : (
                <p className="mt-2 text-sm font-semibold text-cs2-amber">
                  {C69}
                </p>
              )}
            </>
          )}
          {dto.participation === "active" && dto.nextGameweekNumber && dto.nextDeadlineAt ? <p className="mt-2 text-[12px] font-semibold text-cs2-ink-2">{firstDeadlinePrefix(dto.nextGameweekNumber)}{" "}<LocalTime iso={dto.nextDeadlineAt} /></p> : null}
          {dto.participation === "active" && dto.eligibleFromGameweekNumber && dto.eligibleFromGameweekNumber > 1 ? <p className="mt-1 text-[12px] text-cs2-ink-3">{beforeTimeCopy(dto.eligibleFromGameweekNumber)}</p> : null}
        </div>

        {query.joinError === "1" ? (
          <p className="mb-3 text-xs font-semibold text-cs2-red">
            {GW_ACTION_COPY.inactiveInvite}
          </p>
        ) : null}
        {!participationOpen ? (
          <p className="rounded-cs2-md border border-cs2-amber-line bg-cs2-amber-soft p-3 text-sm font-semibold text-cs2-amber">
            {C69}
          </p>
        ) : user ? (
          <form action={joinAction}>
            <button
              type="submit"
              className="w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white"
            >
              {joinLabel}
            </button>
          </form>
        ) : (
          <>
            <form action={stashAndSignup} className="mb-3">
              <button
                type="submit"
                className="w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white"
              >
                {GW_JOIN_COPY.createAccount}
              </button>
            </form>
            <form action={stashAndLogin}>
              <button
                type="submit"
                className="w-full rounded-cs2-md border border-cs2-line bg-cs2-paper py-3.5 text-[15px] font-semibold text-cs2-green"
              >
                {GW_JOIN_COPY.existingAccount}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
