import { request } from "@/services/api/client";

export interface PeerSessionToken {
  token: string;
  expires_in: number;
}

export const peerService = {
  /** Mint a short-lived token for the separately-deployed PeerMeet app. */
  createSessionToken(): Promise<PeerSessionToken> {
    return request<PeerSessionToken>("/candidate/peer-session-token", { method: "POST" });
  },
};
