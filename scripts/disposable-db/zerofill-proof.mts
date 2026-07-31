// Runs the real Cashford settlement worker for the population seeded by zerofill-test.sql.
// The SQL file invokes this script after the deadline/maintenance assertions, then checks the
// persisted points and transfer trail.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[cm]?[jt]s$/.test(spec)) {
      const url = new URL(spec + ".ts", ctx.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const { settleGameweekContest } = await import("../../lib/gameweek-db.ts");

const client = new pg.Client({
  host: "localhost",
  port: 55432,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await client.connect();

const admin: any = {
  from: (table: string) => ({
    insert: async (row: Record<string, unknown>) => {
      const keys = Object.keys(row);
      try {
        await client.query(
          `insert into cashford.${table} (${keys.join(",")})
           values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
          keys.map((key) =>
            typeof row[key] === "object" && row[key] !== null
              ? JSON.stringify(row[key])
              : row[key],
          ),
        );
        return { data: null, error: null };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  }),
  async rpc(name: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    try {
      const result = await client.query(
        `select cashford.${name}(
          ${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}
        ) as value`,
        keys.map((key) => {
          const value = args[key];
          return typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : value;
        }),
      );
      return { data: result.rows[0].value, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
};

try {
  const pot = await client.query("select v from zf_ids where k = 'pot'");
  if (pot.rowCount !== 1) throw new Error("zerofill proof seed has no pot");

  const result = await settleGameweekContest(admin, pot.rows[0].v);
  if (result.outcome !== "settled") {
    throw new Error(`real worker returned ${result.outcome}: ${result.reason ?? "no reason"}`);
  }
  console.log("PASS  real TypeScript scoring worker claims, computes and finalizes the contest");
} finally {
  await client.end();
}
