/**
 * Lobby.jsx — "Get ready" screen shown before anyone enters a meeting.
 *
 * - live camera preview and a microphone level meter, with pickers for both
 * - clear help when the browser blocks the camera or microphone, specific to the browser
 * - the rules in short, and what happens to your audio, with the consent the person actually gives
 *
 * Nothing is sent to the meeting server from here. The preview is released before joining so the
 * meeting room can take the devices cleanly.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HiMicrophone, HiVideoCamera, HiShieldCheck } from 'react-icons/hi2';
import {
  MEDIA_PROBLEM_TEXT,
  classifyMediaError,
  constraintsFor,
  detectBrowser,
  meterLevel,
  permissionHelp,
} from '../utils/lobbyPrefs.js';

const RULES = [
  'Be respectful. Harassment, abuse or inappropriate content are not allowed.',
  'This is practice. Do not share real interview questions from any company or ask your partner to.',
  'Do not record the call or share what your partner says outside this meeting.',
  'You can report or block your partner at any time from the controls. Reports are reviewed by people.',
];

function Lobby({ isPrivate, hasIdentity, onJoin }) {
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [problem, setProblem] = useState(null); // classifyMediaError result
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [rules, setRules] = useState(false);
  // Dashboard users already agreed to AI feedback there; others start unchecked (opt in).
  const [transcription, setTranscription] = useState(Boolean(hasIdentity));
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const browser = detectBrowser();

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let ctx = null;
    setReady(false);
    setProblem(null);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          constraintsFor({ cameraId: cameraId || null, micId: micId || null })
        );
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stopPreview();
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(all.filter((d) => d.kind === 'videoinput'));
        setMics(all.filter((d) => d.kind === 'audioinput'));
        setReady(true);

        // microphone level meter
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx && stream.getAudioTracks().length) {
          ctx = new AudioCtx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            setLevel(meterLevel(data));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch (err) {
        if (!cancelled) setProblem(classifyMediaError(err));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ctx?.close?.().catch(() => {});
    };
  }, [cameraId, micId, attempt, stopPreview]);

  // Release the camera when leaving the lobby for any reason.
  useEffect(() => stopPreview, [stopPreview]);

  const join = () => {
    const selectedCam = streamRef.current?.getVideoTracks()[0]?.getSettings?.().deviceId || cameraId || null;
    const selectedMic = streamRef.current?.getAudioTracks()[0]?.getSettings?.().deviceId || micId || null;
    stopPreview();
    onJoin({ cameraId: selectedCam, micId: selectedMic, transcriptionConsent: transcription });
  };

  const canJoin = ready && rules;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-4xl grid gap-8 md:grid-cols-2">
        {/* ── Preview ─────────────────────────────────────────────────────── */}
        <section aria-labelledby="lobby-title">
          <h1 id="lobby-title" className="text-xl font-bold text-white mb-1">Get ready to join</h1>
          <p className="text-sm text-slate-400 mb-4">Check that you look and sound right before your partner sees you.</p>

          <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
            {!ready && !problem && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm" role="status">
                Starting your camera…
              </div>
            )}
          </div>

          {problem ? (
            <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <p className="font-medium mb-2">{MEDIA_PROBLEM_TEXT[problem]}</p>
              {problem === 'denied' && (
                <ol className="list-decimal pl-5 space-y-1 text-red-100/90">
                  {permissionHelp(browser).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <button onClick={() => setAttempt((n) => n + 1)} className="btn-secondary mt-3">Try again</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-slate-400" htmlFor="lobby-camera">
                <span className="flex items-center gap-1 mb-1"><HiVideoCamera aria-hidden="true" /> Camera</span>
                <select
                  id="lobby-camera"
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 p-2 text-sm text-white"
                >
                  <option value="">Default camera</option>
                  {cameras.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-400" htmlFor="lobby-mic">
                <span className="flex items-center gap-1 mb-1"><HiMicrophone aria-hidden="true" /> Microphone</span>
                <select
                  id="lobby-mic"
                  value={micId}
                  onChange={(e) => setMicId(e.target.value)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 p-2 text-sm text-white"
                >
                  <option value="">Default microphone</option>
                  {mics.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                  ))}
                </select>
              </label>
              <div>
                <div className="text-xs text-slate-400 mb-1">Say something: the bar should move.</div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                  <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Rules + consent ─────────────────────────────────────────────── */}
        <section aria-labelledby="rules-title" className="flex flex-col">
          <h2 id="rules-title" className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <HiShieldCheck aria-hidden="true" /> Before you join
          </h2>
          <ul className="space-y-2 text-sm text-slate-300 mb-4">
            {RULES.map((r) => (
              <li key={r} className="flex gap-2"><span aria-hidden="true">•</span><span>{r}</span></li>
            ))}
          </ul>
          {isPrivate && (
            <p className="text-xs text-slate-400 mb-3">Your name is hidden: your partner will see “Anonymous Candidate”.</p>
          )}

          <label className="flex items-start gap-2 text-sm text-slate-200 mb-3">
            <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} className="mt-1" />
            <span>I have read these rules and I will follow them.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-200 mb-2">
            <input type="checkbox" checked={transcription} onChange={(e) => setTranscription(e.target.checked)} className="mt-1" />
            <span>
              Turn on live captions and AI feedback. My speech is converted to text by Deepgram and analysed by
              Google Gemini. Audio is not stored. Leave this off to take the call without them.
            </span>
          </label>
          <p className="text-xs text-slate-500 mb-5">
            Your camera and microphone go directly to your partner and are never recorded by Mirracle.
          </p>

          <button onClick={join} disabled={!canJoin} className="btn-primary mt-auto">
            Join meeting
          </button>
          {!rules && ready && <p className="text-xs text-slate-500 mt-2">Tick the rules box to join.</p>}
        </section>
      </div>
    </div>
  );
}

export default Lobby;
