/**
 * ErrorMessage.jsx
 *
 * Displays a user-friendly error with appropriate action buttons.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MdError, MdRefresh, MdHome } from 'react-icons/md';
import { HiExclamationTriangle } from 'react-icons/hi2';

function ErrorMessage({ message, onRetry, type = 'error' }) {
  const navigate = useNavigate();

  const isWarning = type === 'warning';

  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center px-4 animate-fade-in">
      {/* Icon */}
      <div
        className={`
          w-20 h-20 rounded-full flex items-center justify-center
          ${isWarning
            ? 'bg-amber-500/20 border border-amber-500/40'
            : 'bg-red-500/20 border border-red-500/40'}
        `}
      >
        {isWarning ? (
          <HiExclamationTriangle className="text-4xl text-amber-400" />
        ) : (
          <MdError className="text-4xl text-red-400" />
        )}
      </div>

      {/* Message */}
      <div>
        <h3
          className={`text-lg font-semibold mb-2 ${
            isWarning ? 'text-amber-300' : 'text-red-300'
          }`}
        >
          {isWarning ? 'Something went wrong' : 'Unable to Connect'}
        </h3>
        <p className="text-sm text-slate-400 max-w-sm leading-relaxed">{message}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 justify-center">
        {onRetry && (
          <button
            id="btn-retry"
            onClick={onRetry}
            className="btn-secondary gap-2"
          >
            <MdRefresh className="text-lg" />
            Try Again
          </button>
        )}
        <button
          id="btn-go-home"
          onClick={() => navigate('/')}
          className="btn-primary gap-2"
        >
          <MdHome className="text-lg" />
          Go Home
        </button>
      </div>
    </div>
  );
}

export default ErrorMessage;
