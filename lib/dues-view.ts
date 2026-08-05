import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDuesActivity, type DuesActivityItem } from "./dues-activity";
import { buildDuesLedger, type DuesGameMovement, type DuesPayment, type DuesTransfer, type DuesGameweekVersion } from "./dues-ledger";
import { derivePaymentStatus, requiredConfirmers, type ConfirmationEvent, type PaymentStatus } from "./payment-state";
import { financialParticipantIds } from "./financial-participants";
import { loadLeagueIdentity, type LeagueIdentity } from "./gw-view";

type Client = SupabaseClient<any, "cashford", any>;
export type DuesPerson = { id: string; name: string; netInr: number; isViewer: boolean; departed: boolean };
export type DuesPendingPayment = {
  id: string;
  payerUserId: string;
  receiverUserId: string;
  amountInr: number;
  status: PaymentStatus;
  loggedBy: string;
  requiredActors: string[];
  waitingFor: string[];
  viewerMustAnswer: boolean;
};
export type DuesView = {
  league: LeagueIdentity["league"];
  ledger: ReturnType<typeof buildDuesLedger>;
  people: DuesPerson[];
  activity: DuesActivityItem[];
  pending: DuesPendingPayment[];
  viewerId: string;
  viewerName: string;
};

function one<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function fail(error: { message?: string } | null, context: string) { if (error) throw new Error(`${context}: ${error.message ?? "query-failed"}`); }

export async function loadDuesView(
  supabase: Client,
  admin: Client,
  identity: LeagueIdentity,
  viewerId: string,
): Promise<DuesView> {
  const leagueId = identity.league.id;
  const [membersQ, memberCompetitionsQ, contestResultsQ, entriesQ, entryResultsQ, versionsQ, transfersQ, paymentsQ] = await Promise.all([
    admin.from("league_members").select("user_id, left_at").eq("league_id", leagueId),
    admin.from("member_competitions").select("user_id").eq("league_id", leagueId),
    admin.from("contest_results").select("user_id, net_inr, contests!inner(id, league_id, fixtures!inner(competition_id))").eq("contests.league_id", leagueId),
    admin.from("gameweek_entries").select("user_id, gameweek_contest_id").eq("league_id", leagueId),
    admin.from("gameweek_entry_results").select("entry_id, gameweek_contest_id, net_inr, gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(user_id, league_id)").eq("gameweek_entries.league_id", leagueId),
    admin.from("gameweek_contests").select("id, input_version, gameweek_results(settled_version)").eq("league_id", leagueId),
    admin.from("transfers").select("id, from_user_id, to_user_id, amount_inr, reversed, contest_id, gameweek_contest_id, created_at").eq("league_id", leagueId),
    admin.from("payments").select("id, kind, payer_user_id, receiver_user_id, amount_inr, paid_on, note, logged_by, logged_at, status, required_payer_confirmation, required_receiver_confirmation, reverses_payment_id").eq("league_id", leagueId),
  ]);
  for (const [query, context] of [[membersQ, "dues-members"], [memberCompetitionsQ, "dues-member-competitions"], [contestResultsQ, "dues-contest-results"], [entriesQ, "dues-entries"], [entryResultsQ, "dues-entry-results"], [versionsQ, "dues-versions"], [transfersQ, "dues-transfers"], [paymentsQ, "dues-payments"]] as const) fail(query.error, context);

  const members = membersQ.data ?? [];
  const participantIds = financialParticipantIds({
    membershipUserIds: members.map((row: any) => row.user_id),
    memberCompetitionUserIds: (memberCompetitionsQ.data ?? []).map((row: any) => row.user_id),
    contestResultUserIds: (contestResultsQ.data ?? []).map((row: any) => row.user_id),
    gameweekEntryUserIds: (entriesQ.data ?? []).map((row: any) => row.user_id),
    paymentPartyUserIds: (paymentsQ.data ?? []).flatMap((row: any) => [row.payer_user_id, row.receiver_user_id]),
  });
  const resultMovements: DuesGameMovement[] = [
    ...(contestResultsQ.data ?? []).map((row: any) => ({ userId: row.user_id, netInr: Number(row.net_inr ?? 0) })),
    ...(entryResultsQ.data ?? []).map((row: any) => ({ userId: one<any>(row.gameweek_entries)?.user_id, netInr: Number(row.net_inr ?? 0) })),
  ].filter((row) => !!row.userId);
  const transferMovements: DuesTransfer[] = (transfersQ.data ?? []).map((row: any) => ({
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountInr: Number(row.amount_inr),
    reversed: row.reversed,
  }));
  const payments: DuesPayment[] = (paymentsQ.data ?? []).map((row: any) => ({
    kind: row.kind,
    payerUserId: row.payer_user_id,
    receiverUserId: row.receiver_user_id,
    amountInr: Number(row.amount_inr),
    status: row.status,
  }));
  const versions: DuesGameweekVersion[] = (versionsQ.data ?? []).map((row: any) => {
    const result = one<any>(row.gameweek_results);
    return { inputVersion: Number(row.input_version ?? 0), settledVersion: result?.settled_version == null ? null : Number(result.settled_version) };
  });
  const ledger = buildDuesLedger({ participantIds, gameweekVersions: versions, resultMovements, transferMovements, payments });

  const paymentIds = (paymentsQ.data ?? []).map((row: any) => row.id);
  const confirmationsQ = paymentIds.length
    ? await admin.from("payment_confirmations").select("payment_id, actor_user_id, action, created_at").in("payment_id", paymentIds).order("created_at", { ascending: true })
    : { data: [], error: null };
  fail(confirmationsQ.error, "dues-confirmations");
  const confirmations = new Map<string, ConfirmationEvent[]>();
  for (const row of confirmationsQ.data ?? []) {
    const list = confirmations.get(row.payment_id) ?? [];
    list.push({ actorUserId: row.actor_user_id, action: row.action, createdAt: row.created_at });
    confirmations.set(row.payment_id, list);
  }
  const rawPayments = paymentsQ.data ?? [];
  const pending = rawPayments.filter((row: any) => row.status === "pending" || row.status === "disputed").map((row: any) => {
    const facts = { payerUserId: row.payer_user_id, receiverUserId: row.receiver_user_id, amountInr: Number(row.amount_inr), loggedBy: row.logged_by, requiredPayerConfirmation: row.required_payer_confirmation, requiredReceiverConfirmation: row.required_receiver_confirmation };
    const requiredActors = requiredConfirmers(facts);
    const latest = new Map<string, string>();
    for (const event of confirmations.get(row.id) ?? []) latest.set(event.actorUserId, event.action);
    const waitingFor = requiredActors.filter((actor) => latest.get(actor) !== "confirm");
    return { id: row.id, payerUserId: row.payer_user_id, receiverUserId: row.receiver_user_id, amountInr: Number(row.amount_inr), status: row.status, loggedBy: row.logged_by, requiredActors, waitingFor, viewerMustAnswer: requiredActors.includes(viewerId) && latest.get(viewerId) !== "confirm" };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const profileIds = participantIds;
  const profilesQ = profileIds.length ? await admin.from("profiles").select("id, display_name, username").in("id", profileIds) : { data: [], error: null };
  fail(profilesQ.error, "dues-profiles");
  const names = new Map((profilesQ.data ?? []).map((row: any) => [row.id, row.display_name ?? row.username]));
  const departed = new Set(members.filter((row: any) => row.left_at).map((row: any) => row.user_id));
  const netByUser = ledger.status === "clean" ? ledger.netByUser : Object.fromEntries(participantIds.map((id) => [id, 0]));
  const people = participantIds.map((id) => ({ id, name: names.get(id) ?? "player", netInr: netByUser[id] ?? 0, isViewer: id === viewerId, departed: departed.has(id) })).sort((a, b) => b.netInr - a.netInr || a.id.localeCompare(b.id));
  const activity: DuesActivityItem[] = buildDuesActivity([
    ...(transfersQ.data ?? []).map((row: any) => ({ id: row.id, kind: row.gameweek_contest_id ? "pl_transfer" as const : "wc_transfer" as const, loggedAt: row.created_at, payerUserId: row.from_user_id, receiverUserId: row.to_user_id, amountInr: Number(row.amount_inr) })),
    ...rawPayments.map((row: any) => ({ id: row.id, kind: row.kind as "payment" | "reversal", loggedAt: row.logged_at, payerUserId: row.payer_user_id, receiverUserId: row.receiver_user_id, amountInr: Number(row.amount_inr), status: row.status as PaymentStatus, note: row.note, loggedBy: row.logged_by, reversesPaymentId: row.reverses_payment_id })),
  ]);
  return { league: identity.league, ledger, people, activity, pending, viewerId, viewerName: names.get(viewerId) ?? "you" };
}

