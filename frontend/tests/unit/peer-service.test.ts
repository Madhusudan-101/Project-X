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
