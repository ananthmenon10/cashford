import { MATCH_COPY } from "./match-copy";

export function verdictCopy(verdict: "exact" | "result" | "miss") {
  return verdict === "exact"
    ? MATCH_COPY.exact
    : verdict === "result"
      ? MATCH_COPY.result
      : MATCH_COPY.miss;
}
