import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Lobby from '../src/components/Lobby.jsx';

const track = (kind, deviceId) => ({ kind, stop: vi.fn(), getSettings: () => ({ deviceId }) });
let stream;

function installMedia({ fail } = {}) {
  stream = {
    tracks: [track('video', 'cam-A'), track('audio', 'mic-A')],
    getTracks() { return this.tracks; },
    getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); },
    getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); },
  };
  const getUserMedia = fail ? vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: fail })) : vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'videoinput', deviceId: 'cam-A', label: 'Front camera' },
        { kind: 'videoinput', deviceId: 'cam-B', label: 'External camera' },
        { kind: 'audioinput', deviceId: 'mic-A', label: 'Built-in mic' },
      ]),
    },
  });
  return getUserMedia;
}

beforeEach(() => {
  window.AudioContext = undefined; // no meter in jsdom
  window.webkitAudioContext = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('Lobby', () => {
  it('shows the rules and keeps Join off until the camera works AND the rules are accepted', async () => {
    installMedia();
    const user = userEvent.setup();
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    const join = screen.getByRole('button', { name: 'Join meeting' });
    expect(join.disabled).toBe(true);
    await screen.findByRole('option', { name: 'Front camera' });
    expect(join.disabled).toBe(true); // camera ready, rules not yet accepted
    expect(screen.getByText(/Tick the rules box to join/)).toBeTruthy();
    await user.click(screen.getByLabelText(/I have read these rules/));
    expect(join.disabled).toBe(false);
  });

  it('joins with the devices in use and releases the preview so the room can take them', async () => {
    installMedia();
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={onJoin} />);
    await screen.findByRole('option', { name: 'Front camera' });
    await user.click(screen.getByLabelText(/I have read these rules/));
    await user.click(screen.getByRole('button', { name: 'Join meeting' }));
    expect(onJoin).toHaveBeenCalledWith({ cameraId: 'cam-A', micId: 'mic-A', transcriptionConsent: false });
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('AI feedback is opt-in for anonymous visitors and pre-ticked for signed-in dashboard users', async () => {
    installMedia();
    const { unmount } = render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    expect(screen.getByLabelText(/Turn on live captions and AI feedback/).checked).toBe(false);
    unmount();
    installMedia();
    render(<Lobby isPrivate={false} hasIdentity onJoin={() => {}} />);
    expect(screen.getByLabelText(/Turn on live captions and AI feedback/).checked).toBe(true);
  });

  it('passes the transcription choice on, whichever way it was set', async () => {
    installMedia();
    const onJoin = vi.fn();
    const user = userEvent.setup();
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={onJoin} />);
    await screen.findByRole('option', { name: 'Front camera' });
    await user.click(screen.getByLabelText(/Turn on live captions and AI feedback/));
    await user.click(screen.getByLabelText(/I have read these rules/));
    await user.click(screen.getByRole('button', { name: 'Join meeting' }));
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ transcriptionConsent: true }));
  });

  it('explains how to unblock a denied camera, and offers to try again', async () => {
    const gum = installMedia({ fail: 'NotAllowedError' });
    const user = userEvent.setup();
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/blocking the camera or microphone/);
    expect(alert.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Join meeting' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
  });

  it('says plainly when there is no camera or it is busy', async () => {
    installMedia({ fail: 'NotFoundError' });
    const { unmount } = render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/No camera or microphone was found/);
    unmount();
    installMedia({ fail: 'NotReadableError' });
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/used by another app/);
  });

  it('tells a private person that their name is hidden', async () => {
    installMedia();
    render(<Lobby isPrivate hasIdentity onJoin={() => {}} />);
    expect(screen.getByText(/Anonymous Candidate/)).toBeTruthy();
  });

  it('switching camera restarts the preview on that device', async () => {
    const gum = installMedia();
    const user = userEvent.setup();
    render(<Lobby isPrivate={false} hasIdentity={false} onJoin={() => {}} />);
    await screen.findByRole('option', { name: 'External camera' });
    await user.selectOptions(screen.getByLabelText(/Camera/), 'cam-B');
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
    expect(gum.mock.calls[1][0].video.deviceId).toEqual({ ideal: 'cam-B' });
  });
});
