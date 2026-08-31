/**
 * Toast.jsx
 *
 * Renders the toast stack in the top-right corner.
 * Driven by ToastContext — no props needed.
 */

import React from 'react';
import { useToast } from '../context/ToastContext.jsx';
import {
  MdCheckCircle,
  MdError,
  MdInfo,
  MdWarning,
  MdClose,
} from 'react-icons/md';

const ICONS = {
  success: <MdCheckCircle className="text-emerald-400 text-xl flex-shrink-0" />,
  error: <MdError className="text-red-400 text-xl flex-shrink-0" />,
  info: <MdInfo className="text-blue-400 text-xl flex-shrink-0" />,
  warning: <MdWarning className="text-amber-400 text-xl flex-shrink-0" />,
};

const BORDER_COLORS = {
  success: 'border-emerald-500/30',
  error: 'border-red-500/30',
  info: 'border-blue-500/30',
  warning: 'border-amber-500/30',
};

function ToastItem({ id, message, type, exiting }) {
  const { removeToast } = useToast();

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3 p-4 rounded-xl
        glass-strong border ${BORDER_COLORS[type] || BORDER_COLORS.info}
        min-w-[280px] max-w-[360px] pointer-events-auto
        ${exiting ? 'toast-exit' : 'toast-enter'}
      `}
    >
      {/* Icon */}
      {ICONS[type] || ICONS.info}

      {/* Message */}
      <p className="flex-1 text-sm text-slate-200 leading-snug pt-0.5">
        {message}
      </p>

      {/* Close button */}
      <button
        onClick={() => removeToast(id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 text-slate-400 hover:text-white transition-colors duration-150 mt-0.5"
      >
        <MdClose className="text-base" />
      </button>
    </div>
  );
}

function Toast() {
  const { toasts } = useToast();

  return (
    <div
      className="fixed top-20 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>
  );
}

export default Toast;
