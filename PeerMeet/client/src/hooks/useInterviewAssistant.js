/**
 * useInterviewAssistant.js
 *
 * Client-side hook for the disclosed AI-assisted interview layer.
 *
 * Responsibilities:
 *   - Track this participant's current role ('interviewer' | 'candidate').
 *   - Receive AI assistant updates (interviewer only — the server only emits
 *     `interview:assistant-update` to the active interviewer socket).
 *   - Receive this participant's own turn report after being interviewed.
 *   - Expose actions: configure, start, switchRoles, endInterview.
 *
 * DISCLOSURE: `aiAssisted` is surfaced to BOTH roles so the UI can show a
 * persistent banner. Nothing here is concealed from the candidate; the panel
 * data simply isn't sent to them by the server.
 */

import { useCallback, useEffect, useState } from 'react';
import socket from '../socket.js';

export function useInterviewAssistant({ roomId }) {
  const [role, setRole] = useState(null); // 'interviewer' | 'candidate' | null
  const [config, setConfig] = useState(null);
  const [phase, setPhase] = useState(0);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);

  // Interviewer-only live data:
  const [recommendation, setRecommendation] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [tracking, setTracking] = useState(null);
  // Interview Copilot's continuously-updated summary (coverage, strategy,
  // accumulated strengths/weaknesses, latest scores) — aggregated
  // server-side from the same data as recommendation/evaluation above.
  const [summary, setSummary] = useState(null);

  // Duration enforcement:
  const [deadline, setDeadline] = useState(null); // absolute ms timestamp
  const [endedReason, setEndedReason] = useState(null);

  // This participant's own report (shown after their turn as candidate):
  const [turnReport, setTurnReport] = useState(null);

  useEffect(() => {
    const handleRole = (payload) => {
      setRole(payload.role);
      setConfig(payload.config || null);
      setPhase(payload.phase ?? 0);
      setAiAssisted(Boolean(payload.aiAssisted));
      // Clear interviewer-only data when switching to candidate.
      if (payload.role !== 'interviewer') {
        setRecommendation(null);
        setEvaluation(null);
        setSummary(null);
      }
    };

    const handleStarted = ({ phase: p }) => {
      setStarted(true);
      setPhase(p ?? 0);
    };

    const handleAssistantUpdate = (payload) => {
      // Only interviewers ever receive this event from the server.
      if (payload.recommendation) setRecommendation(payload.recommendation);
      if (payload.evaluation) setEvaluation(payload.evaluation);
      if (payload.tracking) setTracking(payload.tracking);
      if (payload.summary) setSummary(payload.summary);
    };

    const handleTurnReport = (payload) => {
      setTurnReport(payload.report ? { ...payload.report, __final: Boolean(payload.final) } : null);
    };

    const handleRolesSwitched = ({ phase: p }) => {
      setPhase(p ?? 0);
      // Fresh phase — clear stale interviewer data.
      setRecommendation(null);
      setEvaluation(null);
      setTracking(null);
      setSummary(null);
    };

    const handleDeadline = ({ deadline: d }) => {
      setDeadline(typeof d === 'number' ? d : null);
    };

    const handleEnded = (payload = {}) => {
      setEnded(true);
      setStarted(false);
      setEndedReason(payload.reason || 'manual');
      setDeadline(null);
    };

    socket.on('interview:role', handleRole);
    socket.on('interview:started', handleStarted);
    socket.on('interview:assistant-update', handleAssistantUpdate);
    socket.on('interview:turn-report', handleTurnReport);
    socket.on('interview:roles-switched', handleRolesSwitched);
    socket.on('interview:deadline', handleDeadline);
    socket.on('interview:ended', handleEnded);

    return () => {
      socket.off('interview:role', handleRole);
      socket.off('interview:started', handleStarted);
      socket.off('interview:assistant-update', handleAssistantUpdate);
      socket.off('interview:turn-report', handleTurnReport);
      socket.off('interview:roles-switched', handleRolesSwitched);
      socket.off('interview:deadline', handleDeadline);
      socket.off('interview:ended', handleEnded);
    };
  }, []);

  const configure = useCallback(
    (interviewConfig) => {
      if (!roomId) return;
      socket.emit('interview:configure', { roomId, config: interviewConfig });
    },
    [roomId]
  );

  const start = useCallback(() => {
    if (!roomId) return;
    socket.emit('interview:start', { roomId });
  }, [roomId]);

  const switchRoles = useCallback(() => {
    if (!roomId) return;
    socket.emit('interview:switch-roles', { roomId });
  }, [roomId]);

  const endInterview = useCallback(() => {
    if (!roomId) return;
    socket.emit('interview:end', { roomId });
  }, [roomId]);

  const dismissTurnReport = useCallback(() => setTurnReport(null), []);

  return {
    role,
    config,
    phase,
    aiAssisted,
    started,
    ended,
    isInterviewer: role === 'interviewer',
    isCandidate: role === 'candidate',
    recommendation,
    evaluation,
    tracking,
    summary,
    deadline,
    endedReason,
    turnReport,
    // actions
    configure,
    start,
    switchRoles,
    endInterview,
    dismissTurnReport,
  };
}
