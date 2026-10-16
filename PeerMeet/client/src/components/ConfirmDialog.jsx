import React, { useEffect, useRef } from 'react';

/** Small accessible confirmation: labelled, Escape cancels, focus starts on the safe choice. */
function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Stay', danger = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" className="glass-strong rounded-3xl p-6 w-full max-w-sm">
        <h2 id="confirm-title" className="text-lg font-bold text-white mb-2">{title}</h2>
        <div id="confirm-body" className="text-sm text-slate-300 mb-5">{children}</div>
        <div className="flex gap-3">
          <button ref={cancelRef} onClick={onCancel} className="btn-secondary flex-1">{cancelLabel}</button>
          <button onClick={onConfirm} className={`flex-1 ${danger ? 'btn-primary !bg-red-500 hover:!bg-red-600' : 'btn-primary'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
