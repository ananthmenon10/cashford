export function EmptyState({ copy }: { copy: string }) {
  return (
    <div className="rounded-cs2-lg border border-dashed border-cs2-line bg-cs2-paper px-5 py-10 text-center text-[14px] font-semibold text-cs2-ink-2">
      {copy}
    </div>
  );
}
