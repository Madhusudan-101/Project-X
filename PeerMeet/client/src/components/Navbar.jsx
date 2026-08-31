/**
 * Navbar.jsx
 *
 * Top navigation bar with logo and optional meeting timer.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { HiVideoCamera } from 'react-icons/hi2';
import { MdTimer } from 'react-icons/md';

function Navbar({ timerFormatted, showTimer }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 glass-dark border-b border-white/5">
      <div className="max-w-screen-xl mx-auto h-full flex items-center justify-between px-4 md:px-8">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2.5 group"
          aria-label="PeerMeet Home"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-glow group-hover:shadow-[0_0_20px_rgba(124,58,237,0.6)] transition-shadow duration-300">
            <HiVideoCamera className="text-white text-xl" />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">
            Peer<span className="text-violet-400">Meet</span>
          </span>
        </Link>

        {/* Meeting Timer (shown only in meeting room) */}
        {showTimer && timerFormatted && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl glass">
            <MdTimer className="text-violet-400 text-lg" />
            <span className="timer-badge text-sm font-mono font-semibold text-white">
              {timerFormatted}
            </span>
          </div>
        )}

        {/* Status dot */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-green animate-pulse-slow" />
          <span className="text-xs text-slate-400 hidden sm:block">Secure P2P</span>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
