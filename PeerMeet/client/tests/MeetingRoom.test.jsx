import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── a fake meeting-server socket we can drive from the test ─────────────────
const sock = vi.hoisted(() => {
  const handlers = {};
  return {
    handlers,
    connected: true,
    emit: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    fire(ev, ...a) { (handlers[ev] || []).slice().forEach((f) => f(...a)); },
    reset() { Object.keys(handlers).forEach((k) => delete handlers[k]); this.emit.mockReset(); this.disconnect.mockReset(); this.connect.mockReset(); },
  };
});
vi.mock('../src/socket.js', () => ({ default: sock }));

const stream = vi.hoisted(() => ({ getVideoTracks: () => [], getAudioTracks: () => [], getTracks: () => [] }));
vi.mock('../src/hooks/useMediaDevices.js', () => ({
  useMediaDevices: () => ({
    stream, micStream: stream, isLoading: false, error: null, isAudioEnabled: true, isVideoEnabled: true,
    isScreenSharing: false, toggleAudio: vi.fn(), toggleVideo: vi.fn(), startScreenShare: vi.fn(), stopScreenShare: vi.fn(),
    setOnScreenShareEnded: vi.fn(), stopStream: vi.fn(), retry: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useWebRTC.js', () => ({
  ConnectionStatus: { IDLE: 'idle', CONNECTING: 'connecting', WAITING: 'waiting', CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error' },
  useWebRTC: () => ({ remoteStream: stream, connectionStatus: 'connected', peerError: null, replaceVideoTrack: vi.fn(), destroyPeer: vi.fn() }),
}));
vi.mock('../src/hooks/useDeepgramTranscription.js', () => ({
  useDeepgramTranscription: () => ({ interimTranscript: '', finalTranscripts: [], transcriptionError: null, isTranscribing: false, startTranscription: vi.fn(), stopTranscription: vi.fn() }),
}));
const assistant = vi.hoisted(() => ({ overrides: {}, configure: null, start: null }));
vi.mock('../src/hooks/useInterviewAssistant.js', () => ({
  useInterviewAssistant: () => ({
    role: null, config: null, phase: 0, aiAssisted: false, started: false, ended: false, isInterviewer: false, isCandidate: false,
    recommendation: null, evaluation: null, tracking: null, summary: null, deadline: null, endedReason: null, turnReport: null,
    configure: assistant.configure, start: assistant.start, switchRoles: vi.fn(), endInterview: vi.fn(), dismissTurnReport: vi.fn(),
    ...assistant.overrides,
  }),
}));
// The Ready screen has its own camera preview; the call tests do not need it.
vi.mock('../src/components/ReadyScreen.jsx', () => ({
  default: ({ state, error, onConsent, onReady, onLeave, onNoShow, isScheduled, startMs }) => (
    <div data-testid="ready-screen" data-scheduled={String(isScheduled)} data-start={String(startMs)}>
      <span data-testid="ready-phase">{state ? state.phase : 'connecting'}</span>
      {error && <span data-testid="ready-error">{error}</span>}
      <button onClick={() => onConsent(true)}>say yes</button>
      <button onClick={() => onConsent(false)}>say no</button>
      <button onClick={() => onReady({ cameraId: 'cam-1', micId: 'mic-1' })}>click ready</button>
      <button onClick={onLeave}>leave screen</button>
      <button onClick={onNoShow}>no show</button>
    </div>
  ),
}));
vi.mock('../src/components/VideoPlayer.jsx', () => ({
  default: ({ label, isAudioEnabled, isVideoEnabled }) => (
    <div data-testid={`tile-${label}`} data-audio={String(isAudioEnabled)} data-video={String(isVideoEnabled)}>{label}</div>
  ),
}));

import MeetingRoom from '../src/pages/MeetingRoom.jsx';
import { ToastProvider } from '../src/context/ToastContext.jsx';
import ToastStack from '../src/components/Toast.jsx';
import { setAuthToken } from '../src/utils/authToken.js';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

const LIVE = {
  roomId: 'room-abc123', phase: 'live', consentVersion: 'v1', deadlineAt: null,
  me: { consent: true, ready: true, host: true }, partner: { present: true, ready: true, card: { anonymous: true } },
};
const goLive = (over = {}) => act(() => sock.fire('precall:state', { ...LIVE, ...over }));

function renderRoom({ search = '?init=true', live = true } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[`/room/room-abc123${search}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/room/:roomId" element={<MeetingRoom />} />
          <Route path="/left/:roomId" element={<Where />} />
        </Routes>
        <Where />
        <ToastStack />
      </ToastProvider>
    </MemoryRouter>
  );
  if (live) goLive();
  return view;
}

const partnerArrives = () => act(() => sock.fire('ready', { initiatorId: 'sock-2', partnerDisplayName: 'Anonymous Candidate' }));

beforeEach(() => {
  sock.reset();
  sessionStorage.clear();
  assistant.overrides = {};
  assistant.configure = vi.fn();
  assistant.start = vi.fn();
  setAuthToken('token-123');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('MeetingRoom', () => {
  it('joins the room as soon as the page opens, with the sign-in token, and sends no consent claim', () => {
    renderRoom({ live: false });
    expect(sock.emit).toHaveBeenCalledWith('join-room', expect.objectContaining({ roomId: 'room-abc123', token: 'token-123' }));
    const join = sock.emit.mock.calls.find((c) => c[0] === 'join-room')[1];
    expect('transcriptionConsent' in join).toBe(false);
  });

  describe('before the call starts', () => {
    it('shows the Ready screen, not the call, until the server says the session is live', () => {
      renderRoom({ live: false });
      expect(screen.getByTestId('ready-screen')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Leave meeting' })).toBeNull();
      act(() => sock.fire('precall:state', { ...LIVE, phase: 'precall', me: { consent: null, ready: false, host: true } }));
      expect(screen.getByTestId('ready-phase').textContent).toBe('precall');
      expect(screen.queryByTestId('tile-You')).toBeNull();
    });

    it('does not say the camera is ready, and never emits media-ready, while on the Ready screen', () => {
      renderRoom({ live: false });
      act(() => sock.fire('precall:state', { ...LIVE, phase: 'precall' }));
      expect(sock.emit).not.toHaveBeenCalledWith('session:media-ready', expect.anything());
    });

    it('sends the answer, the wording version and the chosen devices to the server', async () => {
      const user = userEvent.setup();
      renderRoom({ live: false });
      act(() => sock.fire('precall:state', { ...LIVE, phase: 'precall', consentVersion: 'v7', me: { consent: null, ready: false, host: false } }));
      await user.click(screen.getByRole('button', { name: 'say yes' }));
      expect(sock.emit).toHaveBeenCalledWith('precall:consent', { roomId: 'room-abc123', answer: true, version: 'v7' });
      await user.click(screen.getByRole('button', { name: 'say no' }));
      expect(sock.emit).toHaveBeenCalledWith('precall:consent', { roomId: 'room-abc123', answer: false, version: 'v7' });
      await user.click(screen.getByRole('button', { name: 'click ready' }));
      expect(sock.emit).toHaveBeenCalledWith('precall:ready', { roomId: 'room-abc123', devicesOk: true });
      expect(JSON.parse(sessionStorage.getItem('peermeet:lobby:room-abc123'))).toMatchObject({ cameraId: 'cam-1', micId: 'mic-1' });
    });

    it('starts the call when the server says go, and announces the camera once it is on', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('precall:state', { ...LIVE, phase: 'precall' }));
      act(() => sock.fire('session:go', { roomId: 'room-abc123' }));
      expect(await screen.findByRole('button', { name: 'Leave meeting' })).toBeTruthy();
      await waitFor(() => expect(sock.emit).toHaveBeenCalledWith('session:media-ready', { roomId: 'room-abc123' }));
    });

    it('a refresh in a live session goes straight back to the call and re-announces the camera', async () => {
      renderRoom({ live: false });
      goLive();
      expect(await screen.findByRole('button', { name: 'Leave meeting' })).toBeTruthy();
      await waitFor(() => expect(sock.emit).toHaveBeenCalledWith('session:media-ready', { roomId: 'room-abc123' }));
    });

    it('shows server errors on the Ready screen', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('precall:error', { reason: 'consent-not-saved' }));
      expect((await screen.findByTestId('ready-error')).textContent).toBe('consent-not-saved');
    });

    it('a No ends it for this person with a clear screen (no reason is invented)', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('session:cancelled', { self: true }));
      expect(await screen.findByText('Session cancelled')).toBeTruthy();
      expect(screen.getByText(/You chose not to continue/)).toBeTruthy();
      expect(screen.queryByTestId('ready-screen')).toBeNull();
    });

    it('when the partner said No, the message does not say why', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('session:cancelled', {}));
      expect(await screen.findByText(/cancelled before it started/)).toBeTruthy();
      expect(screen.queryByText(/declined|refused|said no/i)).toBeNull();
    });

    it('a timeout says so and sends them back', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('session:cancelled', { reason: 'timeout' }));
      expect(await screen.findByText('Not ready in time')).toBeTruthy();
    });

    it('a cancelled room found on join also shows the cancelled screen', async () => {
      renderRoom({ live: false });
      act(() => sock.fire('precall:state', { ...LIVE, phase: 'cancelled' }));
      expect(await screen.findByText('Session cancelled')).toBeTruthy();
    });

    it('partner did not show: asks the server, then shows the no-show screen', async () => {
      const user = userEvent.setup();
      renderRoom({ live: false, search: `?init=true&until=${Date.now() + 25 * 60000}&start=${Date.now() - 11 * 60000}` });
      expect(screen.getByTestId('ready-screen').dataset.scheduled).toBe('true');
      await user.click(screen.getByRole('button', { name: 'no show' }));
      expect(sock.emit).toHaveBeenCalledWith('no-show:mark', { roomId: 'room-abc123' });
      act(() => sock.fire('no-show:marked', {}));
      expect(await screen.findByText('Marked as a no-show')).toBeTruthy();
    });

    it('an instant match is not a scheduled meeting', () => {
      renderRoom({ live: false });
      expect(screen.getByTestId('ready-screen').dataset.scheduled).toBe('false');
    });

    it('leaving the Ready screen tells the server and goes home', async () => {
      const user = userEvent.setup();
      renderRoom({ live: false });
      await user.click(screen.getByRole('button', { name: 'leave screen' }));
      expect(sock.emit).toHaveBeenCalledWith('leave-room', { roomId: 'room-abc123' });
      expect(sock.disconnect).toHaveBeenCalled();
    });
  });

  describe('roles, AI notice, onboarding and the candidate note', () => {
    it('both people see "AI assistance is active" and their own role', async () => {
      assistant.overrides = { aiAssisted: true, role: 'candidate', phase: 0 };
      const { unmount } = renderRoom();
      expect(await screen.findByText(/AI assistance is active/)).toBeTruthy();
      expect(screen.getByText(/You are the candidate/)).toBeTruthy();
      unmount();
      assistant.overrides = { aiAssisted: true, role: 'interviewer', phase: 0, isInterviewer: true };
      renderRoom();
      expect(await screen.findByText(/AI assistance is active/)).toBeTruthy();
      expect(screen.getByText(/You are the interviewer/)).toBeTruthy();
    });

    it('only the candidate sees the "answer out loud" note', async () => {
      assistant.overrides = { aiAssisted: true, role: 'candidate' };
      const { unmount } = renderRoom();
      expect(await screen.findByText(/too short to judge/)).toBeTruthy();
      unmount();
      assistant.overrides = { aiAssisted: true, role: 'interviewer', isInterviewer: true };
      renderRoom();
      await screen.findByText(/AI assistance is active/);
      expect(screen.queryByText(/too short to judge/)).toBeNull();
    });

    it('the interviewer message appears when the server sends it and only closes on an explicit click', async () => {
      const user = userEvent.setup();
      renderRoom();
      expect(screen.queryByRole('dialog', { name: /You are the interviewer/ })).toBeNull();
      act(() => sock.fire('onboarding:interviewer', {}));
      const dlg = await screen.findByRole('dialog', { name: /You are the interviewer/ });
      expect(dlg.textContent).toMatch(/guide, not a script/);
      expect(dlg.textContent).toMatch(/topic map/);
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: /You are the interviewer/ })).toBeTruthy();
      await user.click(dlg.parentElement); // the backdrop
      expect(screen.getByRole('dialog', { name: /You are the interviewer/ })).toBeTruthy();
      expect(sock.emit).not.toHaveBeenCalledWith('onboarding:interviewer-dismiss', expect.anything());
      await user.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('dialog', { name: /You are the interviewer/ })).toBeNull();
      expect(sock.emit).toHaveBeenCalledWith('onboarding:interviewer-dismiss', { roomId: 'room-abc123' });
    });

    it('the person who started the meeting sees the setup once both cameras are on, and the guest does not', async () => {
      const first = renderRoom({ live: false });
      goLive({ me: { consent: true, ready: true, host: false } });
      act(() => sock.fire('ready', { initiatorId: 'sock-2', partnerDisplayName: 'X' }));
      await screen.findByRole('button', { name: 'Leave meeting' });
      expect(screen.queryByText(/Candidate Experience/i)).toBeNull();
      first.unmount();
      renderRoom({ live: false });
      goLive();
      act(() => sock.fire('ready', { initiatorId: 'sock-2', partnerDisplayName: 'X' }));
      expect((await screen.findAllByText(/Candidate Experience/i)).length).toBeGreaterThan(0);
    });

    it('explains why a setup change was refused', async () => {
      renderRoom();
      act(() => sock.fire('interview:error', { reason: 'setup-locked' }));
      expect(await screen.findByText(/already submitted/)).toBeTruthy();
      act(() => sock.fire('interview:error', { reason: 'already-started' }));
      expect(await screen.findByText(/setup is locked/)).toBeTruthy();
      act(() => sock.fire('interview:error', { reason: 'not-host' }));
      expect(await screen.findByText(/Only the person who started/)).toBeTruthy();
    });
  });

  it('shows the partner as the large video with you in a small window, and swap flips them', async () => {
    const user = userEvent.setup();
    renderRoom();
    partnerArrives();
    expect(await screen.findByTestId('tile-Anonymous Candidate')).toBeTruthy();
    expect(screen.getByTestId('tile-You')).toBeTruthy();
    const swap = screen.getByRole('button', { name: /make your video the large one/i });
    await user.click(swap);
    expect(screen.getByRole('button', { name: /make your partner the large video/i })).toBeTruthy();
  });

  it('shows the partner’s mic and camera state when they tell us', async () => {
    renderRoom();
    partnerArrives();
    const tile = await screen.findByTestId('tile-Anonymous Candidate');
    expect(tile.dataset.audio).toBe('true');
    act(() => sock.fire('media-state', { audio: false, video: true }));
    expect(screen.getByTestId('tile-Anonymous Candidate').dataset.audio).toBe('false');
  });

  it('tells the partner our mic and camera state once they are here', async () => {
    renderRoom();
    partnerArrives();
    await waitFor(() => expect(sock.emit).toHaveBeenCalledWith('media-state', { roomId: 'room-abc123', audio: true, video: true }));
  });

  it('chat opens from the controls and sends over the socket', async () => {
    const user = userEvent.setup();
    renderRoom();
    partnerArrives();
    await user.click(await screen.findByRole('button', { name: 'Open chat' }));
    expect(screen.getByRole('tab', { name: /Chat/ }).getAttribute('aria-selected')).toBe('true');
    sock.emit.mockImplementation((ev, payload, ack) => {
      if (ev === 'chat:message') ack({ ok: true, message: { id: 'm1', text: payload.text, at: 1, mine: true } });
    });
    await user.type(screen.getByLabelText('Message'), 'hello there');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sock.emit).toHaveBeenCalledWith('chat:message', { roomId: 'room-abc123', text: 'hello there' }, expect.any(Function));
    expect(await screen.findByText('hello there')).toBeTruthy();
  });

  it('counts unread chat messages while the panel is closed', async () => {
    renderRoom();
    partnerArrives();
    act(() => sock.fire('chat:message', { id: 'x1', text: 'ping', from: 'Anonymous Candidate' }));
    act(() => sock.fire('chat:message', { id: 'x2', text: 'ping 2', from: 'Anonymous Candidate' }));
    expect(await screen.findByLabelText('2 unread messages')).toBeTruthy();
  });

  it('leaving asks first; Stay keeps you in, Leave tells the server and shows the ended screen', async () => {
    const user = userEvent.setup();
    renderRoom();
    await user.click(screen.getByRole('button', { name: 'Leave meeting' }));
    expect(screen.getByRole('alertdialog', { name: 'Leave this meeting?' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sock.emit).not.toHaveBeenCalledWith('leave-room', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Leave meeting' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(sock.emit).toHaveBeenCalledWith('leave-room', { roomId: 'room-abc123' });
    expect(sock.disconnect).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByTestId('where')[0].textContent).toBe('/left/room-abc123'));
  });

  it('the Report button appears once there is someone to report, and opens the dialog', async () => {
    const user = userEvent.setup();
    renderRoom();
    expect(screen.queryByRole('button', { name: 'Report the other person' })).toBeNull();
    partnerArrives();
    await user.click(await screen.findByRole('button', { name: 'Report the other person' }));
    expect(screen.getByRole('dialog', { name: /Report this person/ })).toBeTruthy();
  });

  it('shows a clear screen when the server refuses entry', async () => {
    renderRoom();
    act(() => sock.fire('auth-error', { reason: 'token-required' }));
    expect(await screen.findByText(/not allowed in this meeting/i)).toBeTruthy();
  });

  it('warns when the connection to the meeting server drops', async () => {
    renderRoom();
    act(() => sock.fire('disconnect', 'transport close'));
    expect(await screen.findByText(/Connection to the meeting server lost/)).toBeTruthy();
    act(() => sock.fire('connect'));
    await waitFor(() => expect(screen.queryByText(/Connection to the meeting server lost/)).toBeNull());
  });

  it('shows the time left when the meeting has a scheduled end', async () => {
    renderRoom({ search: `?init=true&until=${Date.now() + 4 * 60000}` });
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toMatch(/min left/);
  });

  it('people tab lists you and your partner', async () => {
    const user = userEvent.setup();
    renderRoom();
    partnerArrives();
    await user.click(await screen.findByRole('button', { name: 'Show who is in the meeting' }));
    expect(screen.getAllByText('Anonymous Candidate').length).toBeGreaterThan(0);
    expect(screen.getByText('(you)')).toBeTruthy();
  });
});
