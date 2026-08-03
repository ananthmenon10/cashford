import { C34, GW_UI_COPY } from "@/lib/gw-copy";

export type CompetitionOption = {
  slug: string;
  name: string;
  format: string;
};

export function CompetitionPicker({
  competitions,
  value,
  onChange,
  unavailable = false,
}: {
  competitions: readonly CompetitionOption[] | null;
  value: string;
  onChange: (value: string) => void;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <div
        role="status"
        className="rounded-cs2-md border border-cs2-red-line bg-cs2-red-soft px-4 py-3 text-[13px] font-semibold text-cs2-red"
      >
        {GW_UI_COPY.competitionsUnavailable}
      </div>
    );
  }
  if (competitions === null) {
    return (
      <div
        role="status"
        className="rounded-cs2-md border border-cs2-line bg-cs2-paper px-4 py-3 text-[13px] text-cs2-ink-3"
      >
        {GW_UI_COPY.loading}
      </div>
    );
  }

  if (competitions.length === 0) {
    return (
      <div
        role="status"
        className="rounded-cs2-md border border-cs2-amber/30 bg-cs2-amber-soft px-4 py-3 text-[13px] font-semibold text-cs2-amber"
      >
        {GW_UI_COPY.noActiveCompetitions}
      </div>
    );
  }

  if (competitions.length === 1) {
    const competition = competitions[0];
    return <div><div className="mb-1.5 block text-xs font-semibold text-cs2-ink-2">{C34}</div><input type="hidden" name="competition" value={competition.slug} /><div className="rounded-cs2-md border border-cs2-line bg-cs2-paper px-3.5 py-3 text-[15px] font-semibold">{competition.name}</div></div>;
  }

  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-semibold text-cs2-ink-2"
        htmlFor="competition"
      >
        {C34}
      </label>
      <select
        id="competition"
        name="competition"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-cs2-md border border-cs2-line bg-cs2-paper px-3.5 py-3 text-[15px] outline-none focus:border-cs2-green"
      >
        {competitions.map((competition) => (
          <option key={competition.slug} value={competition.slug}>
            {competition.name}
          </option>
        ))}
      </select>
    </div>
  );
}
