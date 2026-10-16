import React, { useRef } from 'react';
import { HiXMark } from 'react-icons/hi2';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'people', label: 'People' },
  { id: 'captions', label: 'Captions' },
];

/** Tabbed side panel. Arrow keys move between tabs; Escape-free so it never fights the dialogs. */
function SidePanel({ tab, onTab, onClose, unreadChat = 0, children }) {
  const refs = useRef({});
  const onKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    if (next) {
      e.preventDefault();
      onTab(next.id);
      refs.current[next.id]?.focus();
    }
  };

  return (
    <aside aria-label="Meeting side panel" className="glass-dark rounded-2xl flex flex-col w-full lg:w-80 h-80 lg:h-[28rem] min-h-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 pr-2">
        <div role="tablist" aria-label="Panel" className="flex" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => (refs.current[t.id] = el)}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => onTab(t.id)}
              className={`px-3 py-3 text-sm ${tab === t.id ? 'text-white border-b-2 border-primary-400' : 'text-slate-400 hover:text-white'}`}
            >
              {t.label}
              {t.id === 'chat' && unreadChat > 0 && (
                <span className="ml-1 rounded-full bg-primary-500 px-1.5 text-[10px] text-white" aria-label={`${unreadChat} unread`}>
                  {unreadChat}
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={onClose} aria-label="Close panel" className="text-slate-400 hover:text-white">
          <HiXMark className="text-lg" aria-hidden="true" />
        </button>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}

export default SidePanel;
