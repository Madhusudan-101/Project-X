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
vi.mock('../src/hooks/useInterviewAssistant.js', () => ({
  useInterviewAssistant: () => ({
    role: null, config: null, phase: 0, aiAssisted: false, started: false, ended: false, isInterviewer: false, isCandidate: false,
    recommendation: null, evaluation: null, tracking: null, summary: null, deadline: null, endedReason: null, turnReport: null,
    configure: vi.fn(), start: vi.fn(), switchRoles: vi.fn(), endInterview: vi.fn(), dismissTurnReport: vi.fn(),
  }),
}));
vi.mock('../src/components/VideoPlayer.jsx', () => ({
  default: ({ label, isAudioEnabled, isVideoEnabled }) => (
    <div data-testid={`tile-${label}`} data-audio={String(isAudioEnabled)} data-video={String(isVideoEnabled)}>{label}</div>
  ),
}));

import MeetingRoom from '../src/pages/MeetingRoom.jsx';
import { ToastProvider } from '../src/context/ToastContext.jsx';
import { setAuthToken } from '../src/utils/authToken.js';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderRoom({ lobby = { cameraId: 'c', micId: 'm', transcriptionConsent: true }, search = '?init=true' } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/room/room-abc123${search}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/room/:roomId" element={<MeetingRoom lobby={lobby} />} />
          <Route path="/left/:roomId" element={<Where />} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>
  );
}

const partnerArrives = () => act(() => sock.fire('ready', { initiatorId: 'sock-2', partnerDisplayName: 'Anonymous Candidate' }));

beforeEach(() => {
  sock.reset();
  setAuthToken('token-123');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('MeetingRoom', () => {
  it('registers with the server using the lobby choices and the sign-in token', () => {
    renderRoom();
    expect(sock.emit).toHaveBeenCalledWith('join-room', expect.objectContaining({
      roomId: 'room-abc123', token: 'token-123', transcriptionConsent: true,
    }));
  });

  it('does not claim transcription consent that was not given', () => {
    renderRoom({ lobby: { cameraId: 'c', micId: 'm', transcriptionConsent: false } });
    expect(sock.emit).toHaveBeenCalledWith('join-room', expect.objectContaining({ transcriptionConsent: false }));
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
