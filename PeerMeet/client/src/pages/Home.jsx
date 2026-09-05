/**
 * Home.jsx
 *
 * Landing page with Create Meeting and Join Meeting flows.
 *
 * Features:
 *   - Generate unique room ID (UUID)
 *   - Navigate to room as initiator (create)
 *   - Navigate to room as receiver (join with ID)
 *   - Input validation
 *   - Beautiful animated hero design
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { setAuthToken, setIdentityPrivate } from '../utils/authToken.js';
import {
  MdVideoCall,
  MdMeetingRoom,
  MdArrowForward,
} from 'react-icons/md';
import {
  HiVideoCamera,
  HiShieldCheck,
  HiLockClosed,
  HiUsers,
} from 'react-icons/hi2';
import Navbar from '../components/Navbar.jsx';
import { useToast } from '../context/ToastContext.jsx';

// ── Feature badge ──────────────────────────────────────────────────────────────
function FeatureBadge({ icon, label }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 glass rounded-xl text-sm text-slate-300">
      <span className="text-violet-400">{icon}</span>
      {label}
    </div>
  );
}

function Home() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  // Capture a dashboard-issued identity token from ?token=... into memory
  // and immediately strip it from the visible URL. Never persisted to
  // storage; PeerMeet still works fully anonymously if none is present.
  //
  // If the dashboard also passed `?room=<id>&init=1` (the auto-create
  // handoff), navigate straight into that room as the initiator instead of
  // showing the create/join tab UI. Falls back to Home otherwise, so
  // opening PeerMeet directly still works exactly as before.
  useEffect(() => {
    let autoRoom = null;
    let autoInit = false;
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      autoRoom = url.searchParams.get('room');
      autoInit = url.searchParams.get('init') === '1';
      const privateFlag = url.searchParams.get('private') === '1';
      let touched = false;
      if (token) {
        setAuthToken(token);
        url.searchParams.delete('token');
        touched = true;
      }
      if (autoRoom) {
        url.searchParams.delete('room');
        touched = true;
      }
      if (autoInit) {
        url.searchParams.delete('init');
        touched = true;
      }
      if (url.searchParams.has('private')) {
        setIdentityPrivate(privateFlag);
        url.searchParams.delete('private');
        touched = true;
      }
      if (touched) {
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch {
      // window.location may throw in unusual embeds — safe to ignore; PeerMeet
      // simply proceeds anonymously and stays on Home.
    }
    if (autoRoom) {
      // Reuse MeetingRoom's existing initiator flow (?init=true): it first
      // tries join-room, and on room-not-found falls back to create-room —
      // so this same navigate handles both "you're first" (auto-create) and
      // "you're joining a peer" (auto-join) cases with no server changes.
      navigate(`/room/${autoRoom}${autoInit ? '?init=true' : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'join'

  // ─── Create a new meeting ──────────────────────────────────────────────────
  const handleCreateMeeting = useCallback(async () => {
    setIsCreating(true);
    // Generate a short, readable room ID
    const roomId = uuidv4().replace(/-/g, '').slice(0, 12);
    // Small delay for visual feedback
    await new Promise((r) => setTimeout(r, 400));
    navigate(`/room/${roomId}?init=true`);
  }, [navigate]);

  // ─── Join an existing meeting ──────────────────────────────────────────────
  const handleJoinMeeting = useCallback(() => {
    const trimmed = joinRoomId.trim();

    if (!trimmed) {
      setJoinError('Please enter a meeting ID.');
      return;
    }

    if (trimmed.length < 8) {
      setJoinError('Meeting ID is too short. Please check and try again.');
      return;
    }

    setJoinError('');
    navigate(`/room/${trimmed}`);
  }, [joinRoomId, navigate]);

  const handleJoinKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') handleJoinMeeting();
    },
    [handleJoinMeeting]
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* ── Hero section ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center pt-20 pb-12 px-4">
        {/* Decorative orbs */}
        <div
          className="orb w-96 h-96 bg-violet-600/20 -top-20 -left-20"
          aria-hidden="true"
        />
        <div
          className="orb w-80 h-80 bg-cyan-500/10 top-1/3 -right-20"
          aria-hidden="true"
        />

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-violet-500/30 text-sm text-violet-300 font-medium mb-6 animate-slide-up">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Secure peer-to-peer connection
        </div>

        {/* Headline */}
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold text-center text-white leading-tight mb-4 animate-slide-up">
          Video Calls,{' '}
          <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Reimagined
          </span>
        </h1>

        <p className="text-slate-400 text-center max-w-md text-lg mb-10 animate-slide-up">
          Crystal-clear, peer-to-peer video conferencing for two. No accounts,
          no recording. Just you and your peer.
        </p>

        {/* ── Meeting Card ─────────────────────────────────────────────── */}
        <div className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-md animate-fade-in shadow-glass">
          {/* Tab switcher */}
          <div className="flex rounded-xl glass p-1 mb-6 gap-1">
            <button
              id="tab-create"
              onClick={() => setActiveTab('create')}
              className={`
                flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold
                transition-all duration-200
                ${activeTab === 'create'
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-glow'
                  : 'text-slate-400 hover:text-white'
                }
              `}
            >
              <MdVideoCall className="text-base" />
              Create Meeting
            </button>
            <button
              id="tab-join"
              onClick={() => setActiveTab('join')}
              className={`
                flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold
                transition-all duration-200
                ${activeTab === 'join'
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-glow'
                  : 'text-slate-400 hover:text-white'
                }
              `}
            >
              <MdMeetingRoom className="text-base" />
              Join Meeting
            </button>
          </div>

          {/* ── Create tab ──────────────────────────────────────────────── */}
          {activeTab === 'create' && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="glass rounded-2xl p-4 flex flex-col gap-2">
                <div className="flex items-center gap-3 text-slate-300 text-sm">
                  <HiVideoCamera className="text-violet-400 text-xl flex-shrink-0" />
                  <span>Instantly creates a private room and gives you a link to share</span>
                </div>
                <div className="flex items-center gap-3 text-slate-300 text-sm">
                  <HiUsers className="text-violet-400 text-xl flex-shrink-0" />
                  <span>Maximum 2 participants for crystal-clear quality</span>
                </div>
                <div className="flex items-center gap-3 text-slate-300 text-sm">
                  <HiLockClosed className="text-violet-400 text-xl flex-shrink-0" />
                  <span>End-to-end encrypted via WebRTC DTLS-SRTP</span>
                </div>
              </div>

              <button
                id="btn-create-meeting"
                onClick={handleCreateMeeting}
                disabled={isCreating}
                className="btn-primary w-full py-4 text-base disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <span className="spinner spinner-sm" />
                    Creating room...
                  </>
                ) : (
                  <>
                    <MdVideoCall className="text-xl" />
                    New Meeting
                    <MdArrowForward className="text-base ml-auto" />
                  </>
                )}
              </button>
            </div>
          )}

          {/* ── Join tab ─────────────────────────────────────────────────── */}
          {activeTab === 'join' && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div>
                <label
                  htmlFor="join-room-input"
                  className="block text-sm font-medium text-slate-300 mb-2"
                >
                  Enter Meeting ID
                </label>
                <input
                  id="join-room-input"
                  type="text"
                  value={joinRoomId}
                  onChange={(e) => {
                    setJoinRoomId(e.target.value);
                    setJoinError('');
                  }}
                  onKeyDown={handleJoinKeyDown}
                  placeholder="e.g. a1b2c3d4e5f6"
                  className={`
                    input-glass text-base tracking-wide
                    ${joinError ? 'ring-2 ring-red-500/50 border-red-500/50' : ''}
                  `}
                  aria-describedby={joinError ? 'join-error' : undefined}
                  spellCheck={false}
                  autoComplete="off"
                />
                {joinError && (
                  <p
                    id="join-error"
                    role="alert"
                    className="text-red-400 text-xs mt-1.5 flex items-center gap-1"
                  >
                    <span>⚠</span> {joinError}
                  </p>
                )}
              </div>

              <button
                id="btn-join-meeting"
                onClick={handleJoinMeeting}
                className="btn-primary w-full py-4 text-base"
              >
                <MdMeetingRoom className="text-xl" />
                Join Meeting
                <MdArrowForward className="text-base ml-auto" />
              </button>
            </div>
          )}
        </div>

        {/* ── Feature badges ────────────────────────────────────────────── */}
        <div className="flex flex-wrap justify-center gap-2 mt-8 animate-fade-in">
          <FeatureBadge icon={<HiShieldCheck />} label="End-to-End Encrypted" />
          <FeatureBadge icon={<HiVideoCamera />} label="HD Video" />
          <FeatureBadge icon={<HiUsers />} label="2-Participant Focus" />
          <FeatureBadge icon={<HiLockClosed />} label="No Account Needed" />
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-slate-600 text-xs">
        Built with WebRTC · No media passes through our servers
      </footer>
    </div>
  );
}

export default Home;
