/**
 * WebSocket / Socket.io placeholders. Real connection wired when FastAPI + gateway are live.
 * Each channel is a thin wrapper returning a subscribe/unsubscribe pair so components can
 * mount today with no runtime dependency on socket.io-client.
 */

export type SocketChannel =
  | "interview-room"
  | "peer-matchmaking"
  | "notifications"
  | "chat"
  | "presence";

export interface SocketSubscription<T = unknown> {
  channel: SocketChannel;
  send: (payload: T) => void;
  unsubscribe: () => void;
}

export function subscribe<T = unknown>(
  channel: SocketChannel,
  onMessage: (payload: T) => void,
): SocketSubscription<T> {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.info(`[ws] mock subscribe → ${channel}`);
  }
  void onMessage;
  return {
    channel,
    send: (payload) => {
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.info(`[ws] mock send → ${channel}`, payload);
      }
    },
    unsubscribe: () => {
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.info(`[ws] mock unsubscribe → ${channel}`);
      }
    },
  };
}
