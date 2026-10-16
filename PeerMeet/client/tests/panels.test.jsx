import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChatPanel from '../src/components/ChatPanel.jsx';
import ParticipantsPanel from '../src/components/ParticipantsPanel.jsx';
import SidePanel from '../src/components/SidePanel.jsx';
import ConfirmDialog from '../src/components/ConfirmDialog.jsx';
import { feedbackUrl } from '../src/pages/EndedScreen.jsx';

describe('ChatPanel', () => {
  it('renders hostile text as plain text, never as markup', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = render(<ChatPanel messages={[{ id: '1', text: evil, mine: false, from: 'Pat' }]} onSend={vi.fn()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(evil)).toBeTruthy();
  });

  it('labels who said what', () => {
    render(<ChatPanel messages={[{ id: '1', text: 'hello', mine: true }, { id: '2', text: 'hi', mine: false, from: 'Anonymous Candidate' }]} onSend={vi.fn()} />);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Anonymous Candidate')).toBeTruthy();
  });

  it('sends a message and clears the box; keeps the text and shows why when it fails', async () => {
    const onSend = vi.fn().mockResolvedValueOnce({ ok: false, message: 'You are sending messages too fast. Wait a moment.' }).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} onSend={onSend} />);
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText('Message'), 'hello');
    await user.click(send);
    expect((await screen.findByRole('alert')).textContent).toMatch(/too fast/);
    expect(screen.getByLabelText('Message').value).toBe('hello');
    await user.click(send);
    await waitFor(() => expect(screen.getByLabelText('Message').value).toBe(''));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('is a labelled live log with a friendly empty state', () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} />);
    expect(screen.getByRole('log', { name: 'Chat messages' })).toBeTruthy();
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
  });
});

describe('ParticipantsPanel', () => {
  it('shows me and my partner with their mic and camera state', () => {
    render(<ParticipantsPanel me={{ role: 'Interviewer', audio: true, video: true }} partner={{ name: 'Anonymous Candidate', role: 'Candidate', audio: false, video: true }} />);
    expect(screen.getByText('Anonymous Candidate')).toBeTruthy();
    expect(screen.getByLabelText('Microphone off, camera on')).toBeTruthy();
    expect(screen.getByLabelText('Microphone on, camera on')).toBeTruthy();
  });
  it('says when nobody else is here yet', () => {
    render(<ParticipantsPanel me={{ audio: true, video: true }} partner={null} />);
    expect(screen.getByText(/Waiting for your partner/)).toBeTruthy();
  });
});

describe('SidePanel', () => {
  it('is an accessible tab list: arrow keys move between tabs, the unread count is announced, close works', async () => {
    const onTab = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SidePanel tab="chat" onTab={onTab} onClose={onClose} unreadChat={3}><p>body</p></SidePanel>);
    expect(screen.getByRole('tab', { name: /Chat/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('3 unread')).toBeTruthy();
    screen.getByRole('tab', { name: /Chat/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onTab).toHaveBeenCalledWith('people');
    await user.keyboard('{ArrowLeft}');
    expect(onTab).toHaveBeenLastCalledWith('captions'); // wraps around
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });
});

describe('ConfirmDialog', () => {
  it('focuses the safe choice, cancels on Escape, and confirms only on the button', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="Leave this meeting?" confirmLabel="Leave" cancelLabel="Stay" danger onConfirm={onConfirm} onCancel={onCancel}>Are you sure?</ConfirmDialog>);
    expect(screen.getByRole('alertdialog', { name: 'Leave this meeting?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stay' }));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('feedbackUrl', () => {
  it('points at the dashboard feedback dialog for that meeting, or nothing without a dashboard', () => {
    expect(feedbackUrl('https://app.example.com', 'abc123def456')).toBe('https://app.example.com/candidate?peer_feedback=abc123def456');
    expect(feedbackUrl('', 'abc')).toBeNull();
    expect(feedbackUrl(undefined, 'abc')).toBeNull();
    expect(feedbackUrl('not a url', 'abc')).toBeNull();
  });
});
