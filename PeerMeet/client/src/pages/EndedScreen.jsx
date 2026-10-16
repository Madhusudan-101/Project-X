/**
 * EndedScreen.jsx — shown after someone leaves a meeting (instead of dropping them on the home page).
 * Offers feedback on the dashboard, a way back in, and says what happens next.
 */

import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import { clearLobby } from '../utils/lobbyPrefs.js';

/** Link to the dashboard's feedback dialog for this meeting, or null if no dashboard is configured. */
export function feedbackUrl(dashboardUrl, roomId) {
  if (!dashboardUrl) return null;
  try {
    const url = new URL('/candidate', dashboardUrl);
    url.searchParams.set('peer_feedback', roomId);
    return url.toString();
  } catch {
    return null;
  }
}

function EndedScreen() {
  const { roomId } = useParams();
  const dashboard = import.meta.env.VITE_DASHBOARD_URL;
  const feedback = feedbackUrl(dashboard, roomId);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center pt-16 px-4">
        <div className="glass-strong rounded-3xl p-8 md:p-10 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-white mb-2">You left the meeting</h1>
          <p className="text-slate-300 text-sm mb-6">
            Your camera and microphone are off. If an AI-assisted interview finished, your feedback report is on your
            Mirracle dashboard.
          </p>
          <div className="space-y-3">
            {feedback && (
              <a href={feedback} className="btn-primary w-full inline-block">
                Rate this session
              </a>
            )}
            <Link to={`/room/${encodeURIComponent(roomId)}?init=true`} className="btn-secondary w-full inline-block" onClick={() => clearLobby(roomId)}>
              Rejoin the meeting
            </Link>
            {dashboard ? (
              <a href={new URL('/candidate', dashboard).toString()} className="block text-sm text-slate-400 hover:text-white pt-2">
                Back to my dashboard
              </a>
            ) : (
              <Link to="/" className="block text-sm text-slate-400 hover:text-white pt-2">
                Back to the home page
              </Link>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-6">
            Something went wrong in the meeting? Report it from your dashboard under “Recent peer interviews”.
          </p>
        </div>
      </main>
    </div>
  );
}

export default EndedScreen;
