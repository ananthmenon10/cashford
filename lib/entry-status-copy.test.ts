import { describe, expect, it } from "vitest";
import { ENTRY_STATUS_COPY } from "./gw-copy";

describe("ENTRY_STATUS_COPY", () => {
  it("contains all eight reference states with their exact copy", () => {
    expect(ENTRY_STATUS_COPY).toEqual({
      notEnteredOpen: "Not entered · Open until Sat 2:18pm",
      enteredOpen: "Entered · Editable until Sat 2:18pm",
      submittedLocked: "Submitted · Locked at 2:18pm",
      live: "Live · 3rd of 12",
      won: "Won · 1st of 12 · +₹480",
      lost: "Lost · 9th of 12 · −₹100",
      void: "Void · Gameweek called off · Stake returned",
      syncIssue: "Sync issue · We’ll retry shortly",
    });
    expect(Object.keys(ENTRY_STATUS_COPY)).toHaveLength(8);
    expect(Object.values(ENTRY_STATUS_COPY)).toHaveLength(8);
  });
});
