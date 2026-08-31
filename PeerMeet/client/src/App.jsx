/**
 * App.jsx
 *
 * Root application component.
 * Sets up React Router, Toast context, and global layout.
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import MeetingRoom from './pages/MeetingRoom.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Toast from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        {/* Mesh gradient background layer */}
        <div className="mesh-bg" aria-hidden="true" />

        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<MeetingRoom />} />
            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>

        {/* Global toast notifications */}
        <Toast />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
