import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import InterviewSetup from '../src/components/InterviewSetup.jsx';
import InterviewReport from '../src/components/InterviewReport.jsx';

describe('InterviewSetup', () => {
  it('is a labelled modal dialog, takes focus, and Escape skips it', async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(<InterviewSetup onSubmit={() => {}} onSkip={onSkip} />);
    expect(screen.getByRole('dialog', { name: 'Interview Setup' }).getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText('Domain'));
    await user.keyboard('{Escape}');
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('puts focus back where it was when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<InterviewSetup onSubmit={() => {}} onSkip={() => {}} />);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('InterviewReport', () => {
  const report = { overall_score: 70, strengths: ['clear'], weaknesses: [], suggestions: [], topics_covered: [], question_timeline: [] };

  it('is a labelled dialog with a named close button that also closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InterviewReport report={report} isFinal={false} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: /Your Feedback Report/ })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close report' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close report' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
