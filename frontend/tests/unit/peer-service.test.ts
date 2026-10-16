import { beforeEach, describe, expect, it, vi } from "vitest";
import { peerService } from "@/services/api/candidate/peer";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/client", () => ({ request: requestMock }));

describe("peerService contract with the backend", () => {
  beforeEach(() => requestMock.mockReset().mockResolvedValue({}));

  it("asks for a token for one specific room", async () => {
    await peerService.createSessionToken("abc123def456");
    expect(requestMock).toHaveBeenCalledWith("/candidate/peer-session-token", {
      method: "POST",
      body: { room_id: "abc123def456" },
    });
  });

  it("ends a match on the server so the next one can start", async () => {
    await peerService.endMatch();
    expect(requestMock).toHaveBeenCalledWith("/candidate/peer-matchmaking/end", { method: "POST" });
  });

  it("leaving the queue and ending a match are different calls", async () => {
    await peerService.cancelMatch();
    await peerService.endMatch();
    expect(requestMock.mock.calls.map((c) => c[0])).toEqual([
      "/candidate/peer-matchmaking/cancel",
      "/candidate/peer-matchmaking/end",
    ]);
  });
});

describe("untilParam (the meeting's scheduled end handed to PeerMeet)", () => {
  it("is milliseconds since the epoch, or nothing when unusable", async () => {
    const { untilParam } = await import("@/lib/peerMeetTab");
    expect(untilParam("2030-01-01T12:30:00Z")).toBe(String(Date.UTC(2030, 0, 1, 12, 30)));
    expect(untilParam("not a date")).toBeNull();
    expect(untilParam(null)).toBeNull();
    expect(untilParam(undefined)).toBeNull();
    expect(untilParam("")).toBeNull();
  });
});

describe("matching topic", () => {
  it("sends the chosen topic, or null for 'any topic'", async () => {
    await peerService.requestMatch(true, "data");
    expect(requestMock).toHaveBeenLastCalledWith("/candidate/peer-matchmaking/request", {
      method: "POST",
      body: { keep_private: true, topic: "data" },
    });
    await peerService.requestMatch(false);
    expect(requestMock).toHaveBeenLastCalledWith("/candidate/peer-matchmaking/request", {
      method: "POST",
      body: { keep_private: false, topic: null },
    });
  });

  it("offers exactly the topics the backend accepts", async () => {
    const { MATCH_TOPICS } = await import("@/services/api/candidate/peer");
    expect(MATCH_TOPICS.map((t) => t.id).sort()).toEqual([
      "any",
      "business",
      "data",
      "design",
      "product",
      "software",
    ]);
  });
});
