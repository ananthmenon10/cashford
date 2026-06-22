// A tiny fake of the supabase-js / PostgREST query builder for unit tests.
//
// The real client is chainable and thenable:
//   admin.from("t").select("id").eq("status", "open").lte("lock_at", now)   // → { data }
//   admin.from("t").select("*", { count: "exact", head: true }).eq(...)      // → { count }
//   admin.from("t").update({...}).eq(...).eq(...).select("...")              // → { data }
//   admin.from("t").insert([...])                                            // awaited
//   admin.from("t").select(...).single()                                     // → { data }
//
// We accumulate each chain into a `QuerySpec`, record it in `calls`, and hand it
// to a `resolve(spec)` callback the test supplies to return the canned response.
// Mutations (insert/update/delete/upsert) carry their payload so tests can assert
// what was written.

export type Op = "select" | "insert" | "update" | "delete" | "upsert";
export type Filter = [op: string, ...args: unknown[]];

export interface QuerySpec {
  table: string;
  op: Op;
  payload?: unknown; // insert/update/upsert body
  upsertOpts?: unknown;
  selectArgs?: unknown[]; // includes the { count, head } options object when present
  filters: Filter[];
  single: boolean;
}

export interface FakeResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

export type Resolver = (spec: QuerySpec) => FakeResult | undefined;

export interface FakeClient {
  from: (table: string) => any;
  /** Every finalized query, in order. */
  calls: QuerySpec[];
  /** Convenience: all mutation specs (insert/update/delete/upsert). */
  mutations: () => QuerySpec[];
}

export function makeClient(resolve: Resolver = () => ({})): FakeClient {
  const calls: QuerySpec[] = [];

  const from = (table: string) => {
    const spec: QuerySpec = { table, op: "select", filters: [], single: false };
    let finalized: Promise<FakeResult> | null = null;

    const finalize = (): Promise<FakeResult> => {
      if (!finalized) {
        calls.push(spec);
        const r = resolve(spec) ?? {};
        finalized = Promise.resolve({ error: null, ...r });
      }
      return finalized;
    };

    const b: any = {
      select: (...args: unknown[]) => {
        // First call after from() sets the op; update().select() keeps op="update".
        if (spec.op === "select") spec.op = "select";
        spec.selectArgs = args;
        return b;
      },
      insert: (payload: unknown) => ((spec.op = "insert"), (spec.payload = payload), b),
      update: (payload: unknown) => ((spec.op = "update"), (spec.payload = payload), b),
      upsert: (payload: unknown, opts?: unknown) => ((spec.op = "upsert"), (spec.payload = payload), (spec.upsertOpts = opts), b),
      delete: () => ((spec.op = "delete"), b),
      single: () => {
        spec.single = true;
        return finalize();
      },
      maybeSingle: () => {
        spec.single = true;
        return finalize();
      },
      then: (onF: any, onR: any) => finalize().then(onF, onR),
    };

    // Chainable filter/modifier methods that just record and return the builder.
    for (const m of ["eq", "neq", "lt", "lte", "gt", "gte", "in", "is", "or", "order", "limit", "range", "filter", "not", "match", "contains"]) {
      b[m] = (...args: unknown[]) => {
        spec.filters.push([m, ...args]);
        return b;
      };
    }
    return b;
  };

  return {
    from,
    calls,
    mutations: () => calls.filter((c) => c.op !== "select"),
  };
}

/** Look up a filter value by column, e.g. eqValue(spec, "id"). */
export function eqValue(spec: QuerySpec, column: string): unknown {
  const f = spec.filters.find((x) => x[0] === "eq" && x[1] === column);
  return f ? f[2] : undefined;
}
