/**
 * ErrorBoundary.jsx
 *
 * Catches uncaught render errors anywhere in the wrapped subtree and shows a
 * recovery screen instead of a blank white page. Class component because
 * React error boundaries require componentDidCatch/getDerivedStateFromError,
 * which have no hook equivalent.
 *
 * Deliberately self-contained (no router hooks) — an error here may have
 * come from state the router itself depends on, so recovery uses a real
 * navigation/reload rather than client-side routing.
 */

import React from 'react';
import { MdError, MdRefresh, MdHome } from 'react-icons/md';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="flex flex-col items-center justify-center gap-6 text-center animate-fade-in">
          <div className="w-20 h-20 rounded-full flex items-center justify-center bg-red-500/20 border border-red-500/40">
            <MdError className="text-4xl text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2 text-red-300">Something went wrong</h3>
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              PeerMeet ran into an unexpected error. Reloading usually fixes it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="btn-secondary gap-2"
            >
              <MdRefresh className="text-lg" />
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="btn-primary gap-2"
            >
              <MdHome className="text-lg" />
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
