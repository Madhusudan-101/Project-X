/**
 * Controls.jsx
 *
 * Meeting control bar with all action buttons.
 *
 * Buttons:
 *   - Mute/Unmute
 *   - Camera On/Off
 *   - Screen Share / Stop Share
 *   - Leave Meeting
 */

import React from 'react';
import {
  HiMicrophone,
  HiSpeakerXMark,
} from 'react-icons/hi2';
import {
  MdVideocam,
  MdVideocamOff,
  MdScreenShare,
  MdStopScreenShare,
  MdCallEnd,
} from 'react-icons/md';

function ControlButton({ onClick, isActive, activeClass, icon, label, title, id }) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      className={`btn-control ${isActive ? activeClass : ''}`}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-[10px] font-medium hidden sm:block leading-tight">{label}</span>
    </button>
  );
}

function Controls({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeave,
}) {
  return (
    <div className="controls-bar flex items-center justify-center gap-3 md:gap-4 py-4 px-4">
      {/* ── Microphone ─────────────────────────────────────────────────────── */}
      <ControlButton
        id="btn-toggle-mic"
        onClick={onToggleAudio}
        isActive={!isAudioEnabled}
        activeClass="btn-control-active"
        icon={
          isAudioEnabled ? (
            <HiMicrophone />
          ) : (
            <HiSpeakerXMark />
          )
        }
        label={isAudioEnabled ? 'Mute' : 'Unmute'}
        title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
      />

      {/* ── Camera ─────────────────────────────────────────────────────────── */}
      <ControlButton
        id="btn-toggle-camera"
        onClick={onToggleVideo}
        isActive={!isVideoEnabled}
        activeClass="btn-control-active"
        icon={
          isVideoEnabled ? (
            <MdVideocam />
          ) : (
            <MdVideocamOff />
          )
        }
        label={isVideoEnabled ? 'Stop Video' : 'Start Video'}
        title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
      />

      {/* ── Screen Share ────────────────────────────────────────────────────── */}
      <ControlButton
        id="btn-screen-share"
        onClick={onToggleScreenShare}
        isActive={isScreenSharing}
        activeClass="!bg-cyan-500/20 !text-cyan-400 hover:!bg-cyan-500/30 !border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.2)]"
        icon={
          isScreenSharing ? (
            <MdStopScreenShare />
          ) : (
            <MdScreenShare />
          )
        }
        label={isScreenSharing ? 'Stop Share' : 'Share Screen'}
        title={isScreenSharing ? 'Stop screen sharing' : 'Share your screen'}
      />

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="w-px h-10 bg-white/10 mx-1" role="separator" />

      {/* ── Leave ───────────────────────────────────────────────────────────── */}
      <button
        id="btn-leave-meeting"
        onClick={onLeave}
        title="Leave meeting"
        aria-label="Leave meeting"
        className="
          relative inline-flex flex-col items-center justify-center gap-1 p-3 rounded-2xl
          bg-red-500/20 text-red-400 border border-red-500/30
          hover:bg-red-500 hover:text-white hover:border-red-500
          hover:shadow-[0_0_25px_rgba(239,68,68,0.5)]
          active:scale-95
          transition-all duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400
        "
      >
        <MdCallEnd className="text-xl" />
        <span className="text-[10px] font-medium hidden sm:block">Leave</span>
      </button>
    </div>
  );
}

export default Controls;
