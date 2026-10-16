import { describe, expect, it } from "vitest";
import { SUGGEST_SCHEDULE_AFTER_SECONDS, formatWait, waitingNote } from "@/lib/peerWait";

describe("formatWait", () => {
  it("shows seconds, then minutes and padded seconds", () => {
    expect(formatWait(0)).toBe("0s");
    expect(formatWait(59)).toBe("59s");
    expect(formatWait(60)).toBe("1m 00s");
    expect(formatWait(125)).toBe("2m 05s");
  });
});

describe("waitingNote", () => {
  it("never claims a queue position it does not know", () => {
    for (const s of [0, 10, 30, 120, 600])
      expect(waitingNote(s).text).not.toMatch(/position|queue/i);
  });
  it("reassures first, and only suggests scheduling after a long wait", () => {
    expect(waitingNote(5)).toEqual({ text: "Looking for a partner…", suggestSchedule: false });
    expect(waitingNote(45).suggestSchedule).toBe(false);
    expect(waitingNote(SUGGEST_SCHEDULE_AFTER_SECONDS - 1).suggestSchedule).toBe(false);
    expect(waitingNote(SUGGEST_SCHEDULE_AFTER_SECONDS).suggestSchedule).toBe(true);
    expect(waitingNote(900).text).toMatch(/pick a time/);
  });
});
