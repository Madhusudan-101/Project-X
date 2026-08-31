/**
 * Loader.jsx
 *
 * Full-page loading spinner with optional message.
 */

import React from 'react';

function Loader({ message = 'Initializing media devices...' }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 animate-fade-in"
      role="status"
      aria-label={message}
    >
      {/* Nested spinner for depth effect */}
      <div className="relative">
        <div className="spinner" />
        <div
          className="spinner absolute inset-0 m-2"
          style={{
            width: 28,
            height: 28,
            borderColor: 'rgba(6, 182, 212, 0.15)',
            borderTopColor: '#06b6d4',
            animationDirection: 'reverse',
            animationDuration: '0.6s',
          }}
        />
      </div>

      {/* Message */}
      <div className="text-center">
        <p className="text-slate-300 text-sm font-medium">{message}</p>
        <p className="text-slate-500 text-xs mt-1">This may take a moment</p>
      </div>
    </div>
  );
}

export default Loader;
