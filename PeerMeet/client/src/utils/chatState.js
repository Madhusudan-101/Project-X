/**
 * Pure state for the in-call chat, so it can be tested without a browser.
 * Messages are plain text: render them as text, never as HTML.
 */

export const MAX_CHAT_LENGTH = 500;
export const initialChat = { messages: [], unread: 0 };

/** Remember what we have seen, never twice, and keep the list bounded. */
function addUnique(messages, incoming) {
  const seen = new Set(messages.map((m) => m.id));
  const fresh = [];
  for (const m of incoming) {
    if (!m || !m.id || seen.has(m.id)) continue;
    seen.add(m.id); // also dedupes within the incoming batch itself
    fresh.push(m);
  }
  return [...messages, ...fresh].slice(-200);
}

export function chatReducer(state, action) {
  switch (action.type) {
    case 'history': // the full log after joining or reconnecting
      return { ...state, messages: addUnique([], action.messages || []) };
    case 'received': {
      const messages = addUnique(state.messages, [{ ...action.message, mine: false }]);
      const added = messages.length > state.messages.length;
      return { messages, unread: state.unread + (added && !action.panelOpen ? 1 : 0) };
    }
    case 'sent':
      return { ...state, messages: addUnique(state.messages, [{ ...action.message, mine: true }]) };
    case 'read':
      return { ...state, unread: 0 };
    case 'reset':
      return initialChat;
    default:
      return state;
  }
}

/** Why a message could not be sent, in words a person can act on. */
export function describeChatError(error) {
  switch (error) {
    case 'slow-down':
      return 'You are sending messages too fast. Wait a moment.';
    case 'not-in-room':
      return 'You are not in this meeting any more.';
    case 'empty':
      return 'Type a message first.';
    default:
      return 'The message could not be sent. Try again.';
  }
}

export function canSend(text) {
  const t = String(text ?? '').trim();
  return t.length > 0 && t.length <= MAX_CHAT_LENGTH;
}
