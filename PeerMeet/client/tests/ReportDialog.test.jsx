import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ReportDialog from '../src/components/ReportDialog.jsx';

const socketThatReplies = (reply) => ({ emit: vi.fn((_e, _p, ack) => setTimeout(() => ack(reply), 0)) });

describe('ReportDialog', () => {
  it('is an accessible dialog and cannot be sent without a reason', async () => {
    render(<ReportDialog socket={socketThatReplies({ ok: true })} roomId="r1" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: /Report this person/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send report' }).disabled).toBe(true);
  });

  it('sends the report over the socket and confirms; blocking is OFF by default so a report never ends the call', async () => {
    const socket = socketThatReplies({ ok: true });
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<ReportDialog socket={socket} roomId="r1" onClose={() => {}} onSubmitted={onSubmitted} />);
    await user.click(screen.getByLabelText('Harassment or abuse'));
    await user.type(screen.getByLabelText(/Details/), 'rude');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('status');
    expect(socket.emit).toHaveBeenCalledWith('report-user', { roomId: 'r1', reason: 'harassment', details: 'rude', block: false }, expect.any(Function));
    expect(onSubmitted).toHaveBeenCalledWith({ block: false });
    expect(screen.queryByText(/will not be matched with them again/)).toBeNull();
  });

  it('says the call is not ended, and only blocks (which leaves the call) if you tick the box', async () => {
    const socket = socketThatReplies({ ok: true });
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<ReportDialog socket={socket} roomId="r1" onClose={() => {}} onSubmitted={onSubmitted} />);
    expect(screen.getByText(/Reporting does not end your call/)).toBeTruthy();
    expect(screen.getByLabelText(/Also block this person/).checked).toBe(false);
    await user.click(screen.getByLabelText('Rude or disrespectful'));
    await user.click(screen.getByLabelText(/Also block this person/));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('status');
    expect(socket.emit).toHaveBeenCalledWith('report-user', { roomId: 'r1', reason: 'rude', details: '', block: true }, expect.any(Function));
    expect(onSubmitted).toHaveBeenCalledWith({ block: true });
    expect(screen.getByText(/will not be matched with them again/)).toBeTruthy();
  });

  it('offers the asked-for reasons, and "Something else" needs a description', async () => {
    const socket = socketThatReplies({ ok: true });
    const user = userEvent.setup();
    render(<ReportDialog socket={socket} roomId="r1" onClose={() => {}} />);
    for (const label of ['Inappropriate content or behaviour', 'Rude or disrespectful', 'Not making a genuine effort']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    await user.click(screen.getByLabelText(/Something else/));
    expect(screen.getByText('Details (required)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/describe what happened/);
    expect(socket.emit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Details/), 'They shared a real question');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('status');
    expect(socket.emit).toHaveBeenCalledWith('report-user', expect.objectContaining({ reason: 'other', details: 'They shared a real question' }), expect.any(Function));
  });

  it('shows a clear message for an anonymous guest and lets them close', async () => {
    const user = userEvent.setup();
    render(<ReportDialog socket={socketThatReplies({ ok: false, error: 'login-required' })} roomId="r1" onClose={() => {}} />);
    await user.click(screen.getByLabelText('Spam or off-topic'));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/signed in/);
    expect(screen.getByRole('button', { name: 'Send report' }).disabled).toBe(false);
  });

  it('closes on Escape and on Cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportDialog socket={socketThatReplies({ ok: true })} roomId="r1" onClose={onClose} />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
