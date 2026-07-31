export type SummaryFixture = {
  id: string;
  external_id: number;
  espn_slug: string | null;
};

const SUMMARY_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer";

export function createSummaryFetcher(opts: { signal?: AbortSignal } = {}) {
  const memo = new Map<number, Promise<unknown | null>>();
  let requests = 0;
  let hits = 0;

  return {
    get(fx: SummaryFixture): Promise<unknown | null> {
      if (
        !fx.espn_slug ||
        !Number.isInteger(fx.external_id) ||
        fx.external_id <= 0
      ) {
        return Promise.resolve(null);
      }
      const existing = memo.get(fx.external_id);
      if (existing) {
        hits++;
        return existing;
      }
      requests++;
      const pending = fetch(
        `${SUMMARY_BASE}/${encodeURIComponent(fx.espn_slug)}/summary?event=${fx.external_id}`,
        { cache: "no-store", signal: opts.signal },
      )
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      memo.set(fx.external_id, pending);
      return pending;
    },
    stats() {
      return { requests, hits };
    },
  };
}

export type SummaryFetcher = ReturnType<typeof createSummaryFetcher>;
