import React, { useEffect, useRef, useState } from 'react';
import { HiPaperAirplane } from 'react-icons/hi2';
import { MAX_CHAT_LENGTH, canSend } from '../utils/chatState.js';

/** Messages are rendered as text only: React escapes them, nothing here uses innerHTML. */
function ChatPanel({ messages, onSend, partnerName }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSend(text) || busy) return;
    setBusy(true);
    const res = await onSend(text);
    setBusy(false);
    if (res.ok) {
      setText('');
      setError(null);
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ul role="log" aria-live="polite" aria-label="Chat messages" className="flex-1 overflow-y-auto space-y-2 p-3 min-h-0">
        {messages.length === 0 && <li className="text-sm text-slate-500">No messages yet. Say hello.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm break-words ${m.mine ? 'ml-auto bg-primary-500/20 text-white' : 'bg-white/5 text-slate-200'}`}>
            <span className="block text-[10px] text-slate-400 mb-0.5">{m.mine ? 'You' : m.from || partnerName || 'Participant'}</span>
            {m.text}
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ul>
      <form onSubmit={submit} className="border-t border-white/10 p-3">
        {error && <p role="alert" className="text-xs text-red-300 mb-2">{error}</p>}
        <div className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <input
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Message your partner"
            autoComplete="off"
            className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white"
          />
          <button type="submit" disabled={!canSend(text) || busy} aria-label="Send message" className="btn-primary !px-3">
            <HiPaperAirplane aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default ChatPanel;
