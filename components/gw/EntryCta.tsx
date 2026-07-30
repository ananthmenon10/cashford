import Link from "next/link";
import { C3, C7, C47 } from "@/lib/gw-copy";
import type { ViewerParticipation } from "@/lib/gw-state";

export function EntryCta({
  slug,
  gameweekNumber,
  stakeInr,
  participation,
}: {
  slug: string;
  gameweekNumber: number;
  stakeInr: number;
  participation: ViewerParticipation;
}) {
  const copy =
    participation === "VP1" ? C3(stakeInr) : participation === "VP2" ? C7 : C47;
  return (
    <Link
      href={`/leagues/${slug}/enter?gw=${gameweekNumber}`}
      className="mt-5 flex w-full items-center justify-center rounded-cs2-md bg-cs2-green px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(18,128,92,.22)]"
    >
      {copy}
    </Link>
  );
}
