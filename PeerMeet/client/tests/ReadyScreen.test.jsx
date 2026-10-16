import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadyScreen from '../src/components/ReadyScreen.jsx';
import { CONSENT_QUESTION } from '../src/utils/precall.js';

const track = (kind, deviceId) => ({ kind, stop: vi.fn(), getSettings: () => ({ deviceId }) });
let stream;

function installMedia({ fail, noAudio = false } = {}) {
  stream = {
    tracks: [track('video', 'cam-A'), ...(noAudio ? [] : [track('audio', 'mic-A')])],
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

const state = (over = {}) => ({
  phase: 'precall',
  roomId: 'r1',
  consentVersion: 'v1',
  deadlineAt: null,
  me: { consent: null, ready: false, host: true },
  partner: { present: true, ready: false, card: { anonymous: false, firstName: 'Ann', collegeBranch: 'Alpha College, CSE' } },
  ...over,
});

const setup = (props = {}) => {
  const handlers = { onConsent: vi.fn(), onReady: vi.fn(), onLeave: vi.fn(), onNoShow: vi.fn() };
  const view = render(<ReadyScreen state={state()} {...handlers} {...props} />);
  return { ...handlers, ...view };
};
const readyButton = () => screen.getByRole('button', { name: /^Ready/ });

beforeEach(() => {
  window.AudioContext = undefined; // no meter in jsdom
  window.webkitAudioContext = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('ReadyScreen: waiting for the partner', () => {
  it('says so while nobody is there, and still lets you answer and check your devices', async () => {
    installMedia();
    setup({ state: state({ partner: { present: false, ready: false, card: null } }) });
    expect(screen.getByText(/Waiting for your partner to join/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, continue' }).disabled).toBe(false);
    await screen.findByText(/Camera and microphone are working/);
  });

  it('shows the meeting ID while alone, so an invited person can be told it', () => {
    installMedia();
    setup({ roomId: 'abc123def', state: state({ partner: { present: false, ready: false, card: null } }) });
    expect(screen.getByText('abc123def')).toBeTruthy();
  });

  it('shows "Connecting" before the server has said anything, and nothing can be clicked', () => {
    installMedia();
    setup({ state: null });
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, continue' }).disabled).toBe(true);
    expect(readyButton().disabled).toBe(true);
  });

  it('tells you when your partner left this screen after you were ready', async () => {
    installMedia();
    setup({ state: state({ me: { consent: true, ready: true, host: true }, partner: { present: false, ready: false, card: null } }) });
    expect(screen.getByText(/Your partner left this screen/)).toBeTruthy();
  });

  it('shows a live "closes in" countdown once both are here, and a different line once you are ready', async () => {
    installMedia();
    const { rerender, ...h } = setup({ state: state({ deadlineAt: Date.now() + 125000 }) });
    expect(screen.getByRole('timer').textContent).toMatch(/closes in 2:0\d if you are not both ready/);
    rerender(<ReadyScreen state={state({ deadlineAt: Date.now() + 125000, me: { consent: true, ready: true, host: true } })} {...h} />);
    expect(screen.getByRole('timer').textContent).toMatch(/if your partner is not ready/);
  });
});

describe('ReadyScreen: the partner card', () => {
  it('shows first name and college/branch and nothing else', () => {
    installMedia();
    const { container } = setup();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Alpha College, CSE')).toBeTruthy();
    expect(container.textContent).not.toMatch(/@|linkedin|\bphone\b|resume|email/i);
  });

  it('a private partner shows no name or college', () => {
    installMedia();
    setup({ state: state({ partner: { present: true, ready: false, card: { anonymous: true } } }) });
    expect(screen.getByText(/They chose to keep their details private/)).toBeTruthy();
    expect(screen.queryByText('Ann')).toBeNull();
  });

  it('shows whether the partner is ready', () => {
    installMedia();
    const { rerender, ...h } = setup();
    expect(screen.getByText('Your partner is getting ready.')).toBeTruthy();
    rerender(<ReadyScreen state={state({ partner: { present: true, ready: true, card: { anonymous: true } } })} {...h} />);
    expect(screen.getByText('Your partner is ready.')).toBeTruthy();
  });

  it('reminds both people to be respectful, in short plain words', () => {
    installMedia();
    const { container } = setup();
    expect(screen.getByText(/Be kind and respectful/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/—/); // no em-dashes in the screen's text
  });

  it('tells a private person that their name is hidden', () => {
    installMedia();
    setup({ isPrivate: true });
    expect(screen.getByText(/Anonymous Candidate/)).toBeTruthy();
  });
});

describe('ReadyScreen: consent', () => {
  it('asks the exact question and keeps Ready off until the answer is Yes', async () => {
    installMedia();
    setup();
    expect(screen.getByText(CONSENT_QUESTION)).toBeTruthy();
    await screen.findByText(/Camera and microphone are working/); // devices fine, but no answer yet
    expect(readyButton().disabled).toBe(true);
    expect(screen.getByText(/Answer the question above to continue/)).toBeTruthy();
  });

  it('Yes is sent to the server, not assumed: Ready only unlocks when the server confirms it', async () => {
    installMedia();
    const user = userEvent.setup();
    const { rerender, onConsent, ...h } = setup();
    await screen.findByText(/Camera and microphone are working/);
    await user.click(screen.getByRole('button', { name: 'Yes, continue' }));
    expect(onConsent).toHaveBeenCalledWith(true);
    expect(readyButton().disabled).toBe(true); // the server has not said so yet
    rerender(<ReadyScreen state={state({ me: { consent: true, ready: false, host: true } })} onConsent={onConsent} {...h} />);
    expect(screen.getByText('You said Yes.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, continue' })).toBeNull();
    expect(readyButton().disabled).toBe(false);
  });

  it('No is sent as No, and Ready stays off', async () => {
    installMedia();
    const user = userEvent.setup();
    const { onConsent, onReady } = setup();
    await user.click(screen.getByRole('button', { name: 'No, cancel the session' }));
    expect(onConsent).toHaveBeenCalledWith(false);
    expect(readyButton().disabled).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('shows why a Yes could not be saved', () => {
    installMedia();
    setup({ error: 'consent-not-saved' });
    expect(screen.getByRole('alert').textContent).toMatch(/could not save your answer/);
  });
});

describe('ReadyScreen: camera and microphone check', () => {
  it('explains how to unblock a denied camera, offers to try again, and keeps Ready off', async () => {
    const gum = installMedia({ fail: 'NotAllowedError' });
    const user = userEvent.setup();
    setup({ state: state({ me: { consent: true, ready: false, host: true } }) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/blocking the camera or microphone/);
    expect(alert.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(readyButton().disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
  });

  it('says plainly when there is no device or it is busy', async () => {
    installMedia({ fail: 'NotFoundError' });
    const { unmount } = setup({ state: state({ me: { consent: true, ready: false, host: true } }) });
    expect((await screen.findByRole('alert')).textContent).toMatch(/No camera or microphone was found/);
    expect(readyButton().disabled).toBe(true);
    unmount();
    installMedia({ fail: 'NotReadableError' });
    setup({ state: state({ me: { consent: true, ready: false, host: true } }) });
    expect((await screen.findByRole('alert')).textContent).toMatch(/used by another app/);
  });

  it('a missing microphone is not a working setup', async () => {
    installMedia({ noAudio: true });
    setup({ state: state({ me: { consent: true, ready: false, host: true } }) });
    await screen.findByRole('option', { name: 'Front camera' });
    expect(readyButton().disabled).toBe(true);
    expect(screen.queryByText(/Camera and microphone are working/)).toBeNull();
  });

  it('switching camera restarts the preview on that device', async () => {
    const gum = installMedia();
    const user = userEvent.setup();
    setup();
    await screen.findByRole('option', { name: 'External camera' });
    await user.selectOptions(screen.getByLabelText(/Camera/), 'cam-B');
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
    expect(gum.mock.calls[1][0].video.deviceId).toEqual({ ideal: 'cam-B' });
  });
});

describe('ReadyScreen: Ready', () => {
  const yesState = () => state({ me: { consent: true, ready: false, host: true } });

  it('sends the devices in use, once, even if clicked many times', async () => {
    installMedia();
    const user = userEvent.setup();
    const { onReady } = setup({ state: yesState() });
    await screen.findByText(/Camera and microphone are working/);
    const b = readyButton();
    await user.click(b);
    await user.click(b);
    await user.click(b);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith({ cameraId: 'cam-A', micId: 'mic-A' });
    expect(readyButton().textContent).toMatch(/Waiting for your partner/);
    expect(readyButton().disabled).toBe(true);
  });

  it('after Ready the preview is NOT sent anywhere: nothing is emitted by this screen but the choice', async () => {
    installMedia();
    const { onReady, onConsent } = setup({ state: yesState() });
    await screen.findByText(/Camera and microphone are working/);
    expect(onReady).not.toHaveBeenCalled();
    expect(onConsent).not.toHaveBeenCalled();
  });

  it('both ready: the server moves on and this screen lets go of the camera', async () => {
    installMedia();
    const { unmount } = setup({ state: yesState() });
    await screen.findByText(/Camera and microphone are working/);
    unmount(); // MeetingRoom swaps this screen for the call when the server says go
    for (const t of stream.tracks) expect(t.stop).toHaveBeenCalled();
  });

  it('can be clicked again if the server says we are not ready any more (for example after a refresh)', async () => {
    installMedia();
    const user = userEvent.setup();
    const { rerender, onReady, ...h } = setup({ state: yesState() });
    await screen.findByText(/Camera and microphone are working/);
    await user.click(readyButton());
    rerender(<ReadyScreen state={state({ me: { consent: true, ready: true, host: true } })} onReady={onReady} {...h} />);
    rerender(<ReadyScreen state={state({ me: { consent: true, ready: false, host: true } })} onReady={onReady} {...h} />);
    await waitFor(() => expect(readyButton().disabled).toBe(false));
  });

  it('Leave is always available', async () => {
    installMedia();
    const user = userEvent.setup();
    const { onLeave } = setup({ state: null });
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onLeave).toHaveBeenCalled();
  });
});

describe('ReadyScreen: partner did not show', () => {
  const alone = () => state({ partner: { present: false, ready: false, card: null } });

  it('is not offered for an instant match', () => {
    installMedia();
    setup({ state: alone(), isScheduled: false });
    expect(screen.queryByRole('button', { name: 'Partner did not show' })).toBeNull();
  });

  it('is not offered before the grace window after the scheduled start', () => {
    installMedia();
    setup({ state: alone(), isScheduled: true, startMs: Date.now() - 3 * 60000 });
    expect(screen.queryByRole('button', { name: 'Partner did not show' })).toBeNull();
  });

  it('is offered after the grace window, and never while the partner is here', async () => {
    installMedia();
    const user = userEvent.setup();
    const { onNoShow, rerender, ...h } = setup({ state: alone(), isScheduled: true, startMs: Date.now() - 11 * 60000 });
    await user.click(screen.getByRole('button', { name: 'Partner did not show' }));
    expect(onNoShow).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/will not count against you/)).toBeTruthy();
    rerender(<ReadyScreen state={state()} isScheduled startMs={Date.now() - 11 * 60000} onNoShow={onNoShow} {...h} />);
    expect(screen.queryByRole('button', { name: 'Partner did not show' })).toBeNull();
  });

  it('shows the server’s answer if it said not yet', () => {
    installMedia();
    setup({ state: alone(), isScheduled: true, startMs: Date.now() - 11 * 60000, noShowMessage: 'Please wait 2 more minute(s) before marking this.' });
    expect(screen.getByText(/Please wait 2 more minute/)).toBeTruthy();
  });
});
