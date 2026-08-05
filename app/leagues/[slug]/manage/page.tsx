import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireCaptain, revokeInvite, regenerateInvite, archiveLeague } from "./actions";
import { loadManagePage } from "@/lib/manage-page-load";
import { Avatar } from "@/components/ui";
import { RemoveMemberButton } from "./RemoveMemberButton";
import { CopyButton } from "./CopyButton";
import { BackLink } from "@/components/BackLink";
import { originFromHeaders } from "@/lib/site-url";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { league, userId } = await requireCaptain(slug);

  const admin = createServiceRoleClient();
  const { invite, memberIds, nameById } = await loadManagePage(admin, league.id);

  const origin = await originFromHeaders();
  const inviteLink = invite ? `${origin}/j/${invite.token}` : null;

  // Bound server actions (closures over slug)
  async function doRevokeInvite() {
    "use server";
    await revokeInvite(slug);
  }
  async function doRegenerateInvite() {
    "use server";
    await regenerateInvite(slug);
  }
  async function doArchiveLeague() {
    "use server";
    await archiveLeague(slug);
  }

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <BackLink href={`/leagues/${slug}`} />
        <span className="text-[17px] font-extrabold">Manage · {league.name}</span>
        {league.status === "archived" && (
          <span className="ml-2 rounded-pill bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">
            Archived
          </span>
        )}
      </header>

      <div className="mx-auto max-w-[480px] space-y-6 px-4 py-5">

        {/* ── Invite link ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Invite link
          </h2>
          <div className="rounded-card border border-border bg-surface p-4">
            {invite && inviteLink ? (
              <>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Invite link
                </div>
                <div className="mb-3 break-all font-mono text-[13px] text-fg">
                  {inviteLink}
                </div>
                <CopyButton text={inviteLink} label="Copy link" />

                <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Short code
                </div>
                <div className="mb-3 font-mono text-2xl font-bold tracking-[0.15em]">
                  {invite.short_code}
                </div>
                <CopyButton text={invite.short_code} label="Copy code" variant="secondary" />

                <div className="mt-4 flex gap-2">
                  <form action={doRevokeInvite} className="flex-1">
                    <button
                      type="submit"
                      className="w-full rounded-control border border-border bg-subtle py-2 text-[13px] font-semibold text-fg"
                    >
                      Revoke
                    </button>
                  </form>
                  <form action={doRegenerateInvite} className="flex-1">
                    <button
                      type="submit"
                      className="w-full rounded-control border border-primary bg-surface py-2 text-[13px] font-semibold text-primary-press"
                    >
                      Regenerate
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-[13px] text-muted">
                  No active invite link. Generate one to let people join.
                </p>
                <form action={doRegenerateInvite}>
                  <button
                    type="submit"
                    className="w-full rounded-control bg-primary py-2.5 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
                  >
                    Generate invite link
                  </button>
                </form>
              </>
            )}
          </div>
        </section>

        {/* ── Members ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Members ({memberIds.length})
          </h2>
          <div className="flex flex-col gap-2">
            {memberIds.map((memberId: string) => {
              const name = nameById.get(memberId) ?? "?";
              const isCaptain = memberId === league.created_by;
              const isMe = memberId === userId;
              return (
                <div
                  key={memberId}
                  className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3"
                >
                  <Avatar label={name} size={28} />
                  <span className="flex-1 text-[14px] font-semibold">
                    {name}
                    {isMe && (
                      <span className="ml-1 text-[12px] font-normal text-muted">(you)</span>
                    )}
                  </span>
                  {isCaptain ? (
                    <span className="rounded-pill bg-mint px-2.5 py-0.5 text-[11px] font-bold text-primary-press">
                      Captain
                    </span>
                  ) : (
                    <RemoveMemberButton
                      slug={slug}
                      targetUserId={memberId}
                      targetName={name}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Danger zone ──────────────────────────────────────────────────── */}
        {league.status !== "archived" && (
          <section>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              Danger zone
            </h2>
            <div className="rounded-card border border-[#FCA5A5] bg-[#FEF2F2] p-4 dark:border-[#ef444444] dark:bg-[#ef44441a]">
              <div className="mb-1 text-[14px] font-bold text-loss">Archive league</div>
              <p className="mb-3 text-[12px] text-muted">
                Archived leagues are read-only. Members can still view history and dues,
                but new members cannot join via invite link.
              </p>
              <form action={doArchiveLeague}>
                <button
                  type="submit"
                  className="w-full rounded-control bg-loss py-2.5 text-[14px] font-bold text-white"
                >
                  Archive this league
                </button>
              </form>
            </div>
          </section>
        )}

        <div className="pb-6">
          <Link
            href={`/leagues/${slug}`}
            className="text-[13px] font-semibold text-primary-press"
          >
            ← Back to league
          </Link>
        </div>
      </div>
    </main>
  );
}
