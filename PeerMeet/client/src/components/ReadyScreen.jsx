/**
 * ReadyScreen.jsx: "Get ready", shown to both people after matching and before the call.
 *
 * - who your partner is (first name and college/branch only, and only if they chose to be visible)
 * - a short reminder to be respectful
 * - the consent question (Yes or No)
 * - a camera and microphone check: your own preview, device pickers and a level meter
 * - a Ready button, enabled only once you said Yes and your devices work
 *
 * Your camera preview stays on THIS device. Nothing is sent to your partner, and no call, captions or AI
 * start, until both of you have said Yes and clicked Ready (the server decides, not this screen).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HiMicrophone, HiVideoCamera, HiShieldCheck, HiUser } from 'react-icons/hi2';
import {
  MEDIA_PROBLEM_TEXT,
  classifyMediaError,
  constraintsFor,
  detectBrowser,
  meterLevel,
  permissionHelp,
} from '../utils/lobbyPrefs.js';
import {
  CONSENT_QUESTION,
  RESPECT_POINTS,
  describePrecall,
  formatCountdown,
  noShowAvailableAt,
  precallErrorText,
} from '../utils/precall.js';

function PartnerCard({ partner, roomId }) {
  if (!partner.present) {
    return (
      <div>
        <p className="text-sm text-slate-300" role="status">
          Waiting for your partner to join…
        </p>
        {roomId && (
          <p className="text-xs text-slate-400 mt-2">
            Meeting ID: <code className="text-slate-200 break-all">{roomId}</code> (share it if you invited someone)
          </p>
        )}
      </div>
    );
  }
  const card = partner.card;
  if (!card || card.anonymous) {
    return (
      <div className="flex items-center gap-3">
        <HiUser className="text-2xl text-slate-400" aria-hidden="true" />
        <div>
          <p className="text-white font-medium">Your partner</p>
          <p className="text-xs text-slate-400">They chose to keep their details private.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <HiUser className="text-2xl text-slate-400" aria-hidden="true" />
      <div>
        <p className="text-white font-medium">{card.firstName || 'Your partner'}</p>
        {card.collegeBranch && <p className="text-xs text-slate-400">{card.collegeBranch}</p>}
      </div>
    </div>
  );
}

function ReadyScreen({
  roomId,
  state,
  error,
  online = true,
  isPrivate = false,
  isScheduled = false,
  startMs = null,
  onConsent,
  onReady,
  onLeave,
  onNoShow,
  noShowMessage = null,
}) {
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [problem, setProblem] = useState(null);
  const [devicesReady, setDevicesReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [readyClicked, setReadyClicked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const openedAt = useRef(Date.now());
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const browser = detectBrowser();

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Your own preview and microphone meter. This never leaves this device.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let ctx = null;
    setDevicesReady(false);
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
        // Working means both a camera and a microphone are really delivering.
        setDevicesReady(stream.getVideoTracks().length > 0 && stream.getAudioTracks().length > 0);

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

  // Release the camera when leaving this screen for any reason (including the call starting).
  useEffect(() => stopPreview, [stopPreview]);

  // A tick for the countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // If the server says we are not ready (we left and came back, or a refresh), allow another click.
  useEffect(() => {
    if (state && state.me && state.me.ready === false) setReadyClicked(false);
  }, [state]);

  const view = describePrecall({ state, devicesReady: devicesReady && !problem, readyClicked });

  const clickReady = () => {
    if (!view.canReady) return; // a double click does nothing
    const selectedCam = streamRef.current?.getVideoTracks()[0]?.getSettings?.().deviceId || cameraId || null;
    const selectedMic = streamRef.current?.getAudioTracks()[0]?.getSettings?.().deviceId || micId || null;
    setReadyClicked(true);
    onReady({ cameraId: selectedCam, micId: selectedMic });
  };

  const deadline = state?.deadlineAt && view.partner.present ? state.deadlineAt - now : null;
  const noShowAt = noShowAvailableAt({ isScheduled, startMs, openedAt: openedAt.current });
  const canMarkNoShow = !view.partner.present && noShowAt !== null && now >= noShowAt;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-4xl grid gap-8 md:grid-cols-2">
        {/* ── Your camera and microphone check ─────────────────────────────── */}
        <section aria-labelledby="ready-title">
          <h1 id="ready-title" className="text-xl font-bold text-white mb-1">Get ready</h1>
          <p className="text-sm text-slate-400 mb-4">
            This preview stays on your device. Your partner cannot see or hear you until you are both ready.
          </p>

          <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
            {!devicesReady && !problem && (
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
              <label className="block text-xs text-slate-400" htmlFor="ready-camera">
                <span className="flex items-center gap-1 mb-1"><HiVideoCamera aria-hidden="true" /> Camera</span>
                <select
                  id="ready-camera"
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
              <label className="block text-xs text-slate-400" htmlFor="ready-mic">
                <span className="flex items-center gap-1 mb-1"><HiMicrophone aria-hidden="true" /> Microphone</span>
                <select
                  id="ready-mic"
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
              {devicesReady && <p className="text-xs text-emerald-300" role="status">Camera and microphone are working.</p>}
            </div>
          )}
        </section>

        {/* ── Partner, reminder, consent, Ready ──────────────────────────── */}
        <section aria-labelledby="partner-title" className="flex flex-col">
          <h2 id="partner-title" className="text-lg font-semibold text-white mb-3">Your partner</h2>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4">
            {state ? <PartnerCard partner={view.partner} roomId={roomId} /> : <p className="text-sm text-slate-300" role="status">Connecting…</p>}
            {state && view.partner.present && (
              <p className="text-xs mt-2 text-slate-400" role="status">
                {view.partnerLine === 'ready' ? 'Your partner is ready.' : 'Your partner is getting ready.'}
              </p>
            )}
            {state && !view.partner.present && view.iAmReady && (
              <p className="text-xs mt-2 text-amber-200" role="status">Your partner left this screen. You can wait or leave.</p>
            )}
          </div>

          {isPrivate && (
            <p className="text-xs text-slate-400 mb-3">Your name is hidden: your partner sees “Anonymous Candidate”.</p>
          )}

          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
            <HiShieldCheck aria-hidden="true" /> Before you start
          </h2>
          <ul className="space-y-1 text-sm text-slate-300 mb-4">
            {RESPECT_POINTS.map((r) => (
              <li key={r} className="flex gap-2"><span aria-hidden="true">•</span><span>{r}</span></li>
            ))}
          </ul>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4">
            <p id="consent-question" className="text-sm text-white mb-3">{CONSENT_QUESTION}</p>
            {view.saidYes ? (
              <p className="text-sm text-emerald-300" role="status">You said Yes.</p>
            ) : (
              <div className="flex gap-3" role="group" aria-labelledby="consent-question">
                <button type="button" onClick={() => onConsent(true)} disabled={!view.canAnswer} className="btn-primary flex-1">
                  Yes, continue
                </button>
                <button type="button" onClick={() => onConsent(false)} disabled={!view.canAnswer} className="btn-secondary flex-1">
                  No, cancel the session
                </button>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
              {precallErrorText(error)}
            </p>
          )}
          {!online && (
            <p role="status" className="text-sm text-amber-200 mb-3">Connection lost. Reconnecting…</p>
          )}

          <button onClick={clickReady} disabled={!view.canReady} className="btn-primary mt-auto">
            {view.iAmReady || readyClicked ? 'Ready. Waiting for your partner…' : 'Ready'}
          </button>
          {view.blocker === 'answer' && state && <p className="text-xs text-slate-500 mt-2">Answer the question above to continue.</p>}
          {view.blocker === 'devices' && !problem && <p className="text-xs text-slate-500 mt-2">Waiting for your camera and microphone.</p>}
          {deadline !== null && !view.iAmReady && deadline > 0 && (
            <p className="text-xs text-slate-500 mt-2" role="timer">This screen closes in {formatCountdown(deadline)} if you are not both ready.</p>
          )}
          {deadline !== null && view.iAmReady && deadline > 0 && (
            <p className="text-xs text-slate-500 mt-2" role="timer">This screen closes in {formatCountdown(deadline)} if your partner is not ready.</p>
          )}

          {canMarkNoShow && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm text-amber-100 mb-2">Your partner has not joined. If they are not coming, you can say so. It will not count against you.</p>
              <button type="button" onClick={onNoShow} className="btn-secondary w-full">Partner did not show</button>
              {noShowMessage && <p role="alert" className="text-xs text-amber-200 mt-2">{noShowMessage}</p>}
            </div>
          )}

          <button type="button" onClick={onLeave} className="text-sm text-slate-400 hover:text-white mt-4 self-start">
            Leave
          </button>
        </section>
      </div>
    </div>
  );
}

export default ReadyScreen;
