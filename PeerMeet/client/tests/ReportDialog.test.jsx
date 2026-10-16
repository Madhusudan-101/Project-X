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

  it('sends the report over the socket and confirms; blocking is on by default', async () => {
    const socket = socketThatReplies({ ok: true });
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    render(<ReportDialog socket={socket} roomId="r1" onClose={() => {}} onSubmitted={onSubmitted} />);
    await user.click(screen.getByLabelText('Harassment or abuse'));
    await user.type(screen.getByLabelText(/Details/), 'rude');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('status');
    expect(socket.emit).toHaveBeenCalledWith('report-user', { roomId: 'r1', reason: 'harassment', details: 'rude', block: true }, expect.any(Function));
    expect(onSubmitted).toHaveBeenCalledWith({ block: true });
    expect(screen.getByText(/will not be matched with them again/)).toBeTruthy();
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
