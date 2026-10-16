import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import InterviewerOnboarding from '../src/components/InterviewerOnboarding.jsx';
import CandidateNote from '../src/components/CandidateNote.jsx';
import SessionEnded from '../src/components/SessionEnded.jsx';
import DisclosureBanner from '../src/components/DisclosureBanner.jsx';
import InterviewReport from '../src/components/InterviewReport.jsx';

describe('InterviewerOnboarding', () => {
  it('says what was asked for, in plain words', () => {
    render(<InterviewerOnboarding onDismiss={() => {}} />);
    const dlg = screen.getByRole('dialog', { name: 'You are the interviewer' });
    expect(dlg.textContent).toContain('live suggested questions and live scoring of your partner');
    expect(dlg.textContent).toContain('guide, not a script');
    expect(dlg.textContent).toContain('actually run a good interview');
    expect(dlg.textContent).toMatch(/Glance at the suggestions/);
    expect(dlg.textContent).toMatch(/Ask it naturally/);
    expect(dlg.textContent).toMatch(/topic map/);
    expect(dlg.textContent).not.toMatch(/—/);
  });

  it('closes only on an explicit click of the button', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<InterviewerOnboarding onDismiss={onDismiss} />);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement);
    expect(onDismiss).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('puts focus on the button so the keyboard works', () => {
    render(<InterviewerOnboarding onDismiss={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Got it' }));
  });
});

describe('CandidateNote', () => {
  it('tells the candidate to answer out loud and what a short answer gets', () => {
    render(<CandidateNote />);
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/answer properly and out loud/);
    expect(note.textContent).toMatch(/too short to judge/);
    expect(note.textContent).not.toMatch(/—/);
  });
});

describe('DisclosureBanner', () => {
  it('says AI assistance is active and the role, for either role', () => {
    const { rerender } = render(<DisclosureBanner role="interviewer" phase={0} />);
    expect(screen.getByText(/AI assistance is active/)).toBeTruthy();
    expect(screen.getByText(/You are the interviewer/)).toBeTruthy();
    rerender(<DisclosureBanner role="candidate" phase={0} />);
    expect(screen.getByText(/AI assistance is active/)).toBeTruthy();
    expect(screen.getByText(/You are the candidate/)).toBeTruthy();
  });
});

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('SessionEnded', () => {
  it.each([
    ['declined', 'Session cancelled'],
    ['cancelled', 'Session cancelled'],
    ['timeout', 'Not ready in time'],
    ['no-show', 'Marked as a no-show'],
  ])('%s has a clear heading and a way back', (kind, heading) => {
    inRouter(<SessionEnded kind={kind} onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy();
  });

  it('never says why the partner cancelled', () => {
    inRouter(<SessionEnded kind="cancelled" onBack={() => {}} />);
    expect(screen.getByRole('status').textContent).not.toMatch(/declin|refus|said no|chose not/i);
  });

  it('goes back to the dashboard when there is one', () => {
    inRouter(<SessionEnded kind="timeout" backHref="https://app.example/candidate" />);
    expect(screen.getByRole('link', { name: /dashboard/i }).getAttribute('href')).toBe('https://app.example/candidate');
  });
});

describe('InterviewReport when the answers were too short', () => {
  const report = {
    overall_score: null, technical_score: null, communication_score: null, confidence_score: null, problem_solving_score: null,
    strengths: [], weaknesses: [], topics_covered: [], question_timeline: [],
    suggestions: ['Your answers were too short to judge, so this round has no score.'],
    final_recommendation: 'Not enough to judge', insufficient: true,
  };

  it('says so plainly and shows no scores', () => {
    render(<InterviewReport report={report} isFinal onClose={() => {}} />);
    expect(screen.getByRole('status').textContent).toMatch(/too short to judge/);
    expect(screen.queryByText('Overall')).toBeNull();
    expect(screen.queryByText('Strengths')).toBeNull();
    expect(screen.getByText('Not enough to judge')).toBeTruthy();
  });

  it('a normal report still shows its scores', () => {
    render(<InterviewReport report={{ ...report, insufficient: false, overall_score: 70, final_recommendation: 'Maybe' }} isFinal onClose={() => {}} />);
    expect(screen.getByText('Overall')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
