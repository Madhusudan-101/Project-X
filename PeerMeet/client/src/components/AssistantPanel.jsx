/**
 * AssistantPanel.jsx
 *
 * The Interview Copilot panel. Rendered ONLY when this participant is the
 * active interviewer. The server never sends any of this data to the
 * candidate, and this component is never mounted for them.
 *
 * Sections (all interviewer-only):
 *   1. Candidate understanding — overall rating / confidence / difficulty
 *   2. Adaptive strategy         — what to do next, and why
 *   3. Recommended question      — the AI's suggested next question
 *   4. Coverage & topics         — domain coverage bars + covered/missing topics
 *   5. Follow-up questions       — probes into the latest answer, with reasons
 *   6. Live evaluation           — per-dimension scores for the latest answer
 *   7. Interview summary         — accumulated strengths/weaknesses this round
 *
 * All of this is powered by exactly two Gemini calls per analysis cycle
 * (generateQuestion + evaluateAnswer, both pre-existing) — nothing here adds
 * a new AI request. See server/src/interviewAssistant.js.
 */

import React from 'react';
import {
  HiSparkles,
  HiLightBulb,
  HiChartBar,
  HiChatBubbleLeftRight,
  HiUserCircle,
  HiFlag,
  HiListBullet,
  HiDocumentText,
} from 'react-icons/hi2';

function ScoreBar({ label, value }) {
  const v = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-400 w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-cyan-400"
          style={{ width: v != null ? `${v}%` : '0%' }}
        />
      </div>
      <span className="text-[11px] text-slate-300 w-8 text-right">{v != null ? v : '—'}</span>
    </div>
  );
}

function Chips({ items, tone = 'violet' }) {
  if (!items || items.length === 0) return <span className="text-xs text-slate-500">—</span>;
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
      : tone === 'red'
      ? 'border-red-500/30 text-red-300 bg-red-500/10'
      : tone === 'amber'
      ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
      : 'border-violet-500/30 text-violet-300 bg-violet-500/10';
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${toneClass}`}>
          {it}
        </span>
      ))}
    </div>
  );
}

// Consistent easy/medium/hard color language reused across the panel
// (evaluation difficulty, per-follow-up difficulty, etc).
function difficultyToneClass(difficulty) {
  const d = String(difficulty || '').toLowerCase();
  if (d === 'easy') return 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10';
  if (d === 'hard') return 'border-red-500/30 text-red-300 bg-red-500/10';
  if (d === 'medium') return 'border-amber-500/30 text-amber-300 bg-amber-500/10';
  return 'border-white/10 text-slate-300 bg-white/5';
}

function DifficultyBadge({ difficulty }) {
  if (!difficulty) return null;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize flex-shrink-0 ${difficultyToneClass(difficulty)}`}>
      {difficulty}
    </span>
  );
}

// Top-of-panel "Candidate Understanding" stat tile — overall rating,
// confidence, and current difficulty, all reused directly from the
// existing evaluateAnswer result (no new AI field).
function StatTile({ label, value, suffix = '' }) {
  return (
    <div className="glass-dark rounded-xl px-3 py-2 flex-1 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</p>
      <p className="text-lg font-bold text-white truncate">
        {value != null ? `${value}${suffix}` : '—'}
      </p>
    </div>
  );
}

function CoverageBar({ label, percent }) {
  const v = Math.max(0, Math.min(100, percent || 0));
  const barColor =
    v >= 75 ? 'from-emerald-500 to-emerald-400' : v >= 40 ? 'from-amber-500 to-amber-400' : 'from-red-500 to-red-400';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-300 w-28 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${barColor}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[11px] text-slate-400 w-9 text-right">{v}%</span>
    </div>
  );
}

const STRATEGY_LABELS = {
  continue_deeper: 'Continue deeper',
  move_to_next_topic: 'Move to next topic',
  ask_coding_question: 'Ask a coding question',
  challenge_candidate: 'Challenge the candidate',
  ask_debugging_scenario: 'Ask a debugging scenario',
  move_to_system_design: 'Move to system design',
  increase_difficulty: 'Increase difficulty',
  decrease_difficulty: 'Decrease difficulty',
};

function AssistantPanel({ recommendation, evaluation, tracking, summary, config, onSwitchRoles, onEndInterview }) {
  const strategy = summary?.strategy;
  const coverageAreas = summary?.coverageAreas || [];
  const overallCoverage = summary?.overallCoveragePercent ?? null;

  return (
    <aside className="glass rounded-2xl border border-violet-500/20 p-4 w-full lg:w-96 flex-shrink-0 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
      <div className="flex items-center gap-2">
        <HiSparkles className="text-violet-300 text-lg" />
        <h2 className="text-sm font-semibold text-white">Interview Copilot</h2>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-violet-500/30 text-violet-300">
          Interviewer only
        </span>
      </div>

      {config && (
        <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
          <span>Domain: <span className="text-slate-200">{config.domain}</span></span>
          <span>Difficulty: <span className="text-slate-200">{config.difficulty}</span></span>
          <span>Exp: <span className="text-slate-200">{config.experience}</span></span>
        </div>
      )}

      {/* 1. Candidate understanding — overall rating / confidence / difficulty,
          reused directly from the latest evaluateAnswer result. */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <HiUserCircle className="text-violet-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Candidate understanding</h3>
        </div>
        <div className="flex gap-2">
          <StatTile label="Overall rating" value={evaluation?.score ?? null} suffix="/100" />
          <StatTile label="Confidence" value={evaluation?.confidence ?? null} suffix="/100" />
          <StatTile
            label="Difficulty"
            value={evaluation?.difficulty ? evaluation.difficulty.charAt(0).toUpperCase() + evaluation.difficulty.slice(1) : null}
          />
        </div>
      </div>

      {/* 2. Adaptive strategy — what the interviewer should do next. */}
      {strategy && (
        <div className="glass-dark rounded-xl p-3 border border-cyan-500/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <HiFlag className="text-cyan-300 text-sm" />
            <h3 className="text-xs font-semibold text-white/90">Suggested next move</h3>
          </div>
          <p className="text-sm text-cyan-200 font-medium mb-1">
            {STRATEGY_LABELS[strategy.action] || strategy.label || 'Continue deeper'}
          </p>
          {strategy.reason && <p className="text-[11px] text-slate-400">{strategy.reason}</p>}
        </div>
      )}

      {/* Recommendation */}
      <div className="glass-dark rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HiLightBulb className="text-amber-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Recommended question</h3>
        </div>
        {recommendation ? (
          <>
            <p className="text-sm text-slate-100 mb-2">{recommendation.question}</p>
            {recommendation.expected_answer?.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Expected answer</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {recommendation.expected_answer.map((pt, i) => (
                    <li key={i} className="text-[11px] text-slate-300">{pt}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400 mb-2">
              {recommendation.difficulty && <span>Difficulty: <span className="text-slate-200">{recommendation.difficulty}</span></span>}
              {recommendation.candidate_level && <span>Level: <span className="text-slate-200">{recommendation.candidate_level}</span></span>}
              {recommendation.confidence_estimate && <span>Confidence: <span className="text-slate-200">{recommendation.confidence_estimate}</span></span>}
            </div>
            {recommendation.skills?.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Skills tested</p>
                <Chips items={recommendation.skills} />
              </div>
            )}
            {recommendation.follow_up && (
              <p className="text-[11px] text-slate-400">
                <span className="text-slate-500">Follow-up:</span> {recommendation.follow_up}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">Waiting for enough transcript to suggest a question…</p>
        )}
      </div>

      {/* 4. Coverage & topics — domain coverage bars (Copilot) + existing
          topic/question tracking, unchanged. */}
      <div className="glass-dark rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HiListBullet className="text-cyan-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Interview coverage</h3>
        </div>

        {(overallCoverage != null || coverageAreas.length > 0) && (
          <div className="space-y-1.5 mb-3 pb-3 border-b border-white/5">
            {overallCoverage != null && <CoverageBar label="Overall" percent={overallCoverage} />}
            {coverageAreas.map((c, i) => (
              <CoverageBar key={i} label={c.area} percent={c.percent} />
            ))}
          </div>
        )}

        {tracking ? (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Topics covered ({tracking.topicsCovered?.length || 0})
              </p>
              <Chips items={tracking.topicsCovered} tone="emerald" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Missing topics</p>
              <Chips items={tracking.remainingTopics} tone="amber" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Questions asked ({tracking.questionsAsked?.length || 0})
              </p>
              {tracking.questionsAsked?.length > 0 ? (
                <ol className="list-decimal list-inside space-y-0.5">
                  {tracking.questionsAsked.slice(-4).map((q, i) => (
                    <li key={i} className="text-[11px] text-slate-400 truncate">{q}</li>
                  ))}
                </ol>
              ) : (
                <span className="text-xs text-slate-500">—</span>
              )}
            </div>
            {tracking.difficultyProgression?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Difficulty progression</p>
                <p className="text-[11px] text-slate-300">
                  {tracking.difficultyProgression.join(' → ')}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No progress data yet.</p>
        )}
      </div>

      {/* 5. Suggested follow-up questions — generated from the candidate's
          most recent completed answer, paired with the question it was
          answering (see evaluateAnswer in interviewAssistant.js). Each
          probe carries its own difficulty and the concepts a strong answer
          would need to mention. */}
      <div className="glass-dark rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HiChatBubbleLeftRight className="text-emerald-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Suggested follow-up questions</h3>
        </div>
        {evaluation?.followUpQuestions?.length > 0 ? (
          <ol className="space-y-3">
            {evaluation.followUpQuestions.map((fq, i) => (
              <li key={i} className="text-sm">
                <div className="flex items-start gap-1.5">
                  <span className="text-emerald-300 font-semibold flex-shrink-0">{i + 1}.</span>
                  <span className="text-slate-100 flex-1">{fq.question}</span>
                  <DifficultyBadge difficulty={fq.difficulty} />
                </div>
                {fq.reason && (
                  <p className="text-[11px] text-slate-400 mt-1 pl-5">
                    <span className="text-slate-500">Why:</span> {fq.reason}
                  </p>
                )}
                {fq.expectedConcepts?.length > 0 && (
                  <div className="mt-1.5 pl-5">
                    <Chips items={fq.expectedConcepts} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : evaluation ? (
          <p className="text-xs text-slate-500">
            No follow-up suggestions for this answer — it may have been too short to probe further.
          </p>
        ) : (
          <p className="text-xs text-slate-500">Waiting for a completed answer to analyze…</p>
        )}
        {evaluation?.missingConcepts?.length > 0 && (
          <div className="pt-2 mt-2 border-t border-white/5">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Gaps identified this answer</p>
            <Chips items={evaluation.missingConcepts} tone="red" />
          </div>
        )}
      </div>

      {/* 6. Live evaluation — per-dimension scores for the LATEST answer. */}
      <div className="glass-dark rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HiChartBar className="text-cyan-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Live evaluation</h3>
        </div>
        {evaluation ? (
          <div className="space-y-1.5">
            <ScoreBar label="Correctness" value={evaluation.correctness} />
            <ScoreBar label="Depth" value={evaluation.depth} />
            <ScoreBar label="Confidence" value={evaluation.confidence} />
            <ScoreBar label="Communication" value={evaluation.communication} />
            <ScoreBar label="Completeness" value={evaluation.completeness} />
            <ScoreBar label="Problem solving" value={evaluation.problem_solving} />
            {(evaluation.strong_areas?.length > 0) && (
              <div className="pt-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Strong areas (this answer)</p>
                <Chips items={evaluation.strong_areas} tone="emerald" />
              </div>
            )}
            {(evaluation.weak_areas?.length > 0) && (
              <div className="pt-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Weak areas (this answer)</p>
                <Chips items={evaluation.weak_areas} tone="red" />
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No evaluation yet.</p>
        )}
      </div>

      {/* 7. Interview summary — continuously accumulated across the whole
          round (not just the latest answer), built by aggregating data the
          Copilot already collected — no extra AI call, so this updates
          instantly and stays cheap when the interview ends. */}
      <div className="glass-dark rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <HiDocumentText className="text-violet-300 text-sm" />
          <h3 className="text-xs font-semibold text-white/90">Interview summary</h3>
        </div>
        {summary && (summary.strengths?.length > 0 || summary.weaknesses?.length > 0) ? (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Strengths so far ({summary.strengths?.length || 0})
              </p>
              <Chips items={summary.strengths} tone="emerald" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                Weaknesses so far ({summary.weaknesses?.length || 0})
              </p>
              <Chips items={summary.weaknesses} tone="red" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Building up as the interview progresses…</p>
        )}
      </div>

      {/* Sticky, not mt-auto: the Copilot sections above can add up to more
          than the panel's max-h-[70vh], so mt-auto would just leave these
          as the last item in a long scroll — effectively invisible during
          a live interview. Sticky keeps them reachable at all times,
          regardless of how much Copilot content is above. */}
      <div className="flex flex-col gap-2 sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-3 glass-dark border-t border-white/10">
        <button onClick={onSwitchRoles} className="glass py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white border border-white/10">
          Switch roles (generate candidate report)
        </button>
        <button onClick={onEndInterview} className="py-2.5 rounded-xl text-xs font-medium text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20">
          End interview
        </button>
      </div>
    </aside>
  );
}

export default AssistantPanel;
