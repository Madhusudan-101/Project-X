/**
 * ToastContext.jsx
 *
 * Lightweight context-based toast notification system.
 * No external library — just React state.
 */

import React, { createContext, useContext, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  /**
   * Add a toast.
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} duration - ms before auto-dismiss (default 4000)
   */
  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = uuidv4();
    setToasts((prev) => [...prev, { id, message, type, duration, exiting: false }]);

    // Schedule removal
    setTimeout(() => {
      // Mark as exiting (triggers CSS animation)
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      );
      // Actually remove after animation
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, duration);

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
