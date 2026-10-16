import { useCallback, useEffect, useReducer } from 'react';
import { canSend, chatReducer, describeChatError, initialChat } from '../utils/chatState.js';

/** In-call text chat over the meeting socket. `panelOpen` decides whether new messages count as unread. */
export function useChat(socket, roomId, panelOpen) {
  const [state, dispatch] = useReducer(chatReducer, initialChat);

  useEffect(() => {
    const onHistory = ({ messages } = {}) => dispatch({ type: 'history', messages });
    const onMessage = (message) => dispatch({ type: 'received', message, panelOpen });
    socket.on('chat:history', onHistory);
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:history', onHistory);
      socket.off('chat:message', onMessage);
    };
  }, [socket, panelOpen]);

  useEffect(() => {
    if (panelOpen) dispatch({ type: 'read' });
  }, [panelOpen]);

  /** @returns {Promise<{ok: true} | {ok: false, message: string}>} */
  const send = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!canSend(text)) return resolve({ ok: false, message: describeChatError('empty') });
        socket.emit('chat:message', { roomId, text }, (res) => {
          if (res?.ok) {
            dispatch({ type: 'sent', message: res.message });
            return resolve({ ok: true });
          }
          resolve({ ok: false, message: describeChatError(res?.error) });
        });
      }),
    [socket, roomId]
  );

  return { messages: state.messages, unread: state.unread, send };
}
