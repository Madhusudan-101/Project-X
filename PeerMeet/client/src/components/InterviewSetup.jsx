/**
 * InterviewSetup.jsx
 *
 * Pre-interview configuration modal. Shown to the meeting creator once both
 * participants are connected. Collects domain, difficulty, candidate
 * experience, duration, and who starts first, then hands the config up.
 *
 * Reuses the existing glassmorphism design language.
 */

import React, { useState } from 'react';
import { HiSparkles } from 'react-icons/hi2';

const DOMAINS = [
  'Java', 'Python', 'C++', 'JavaScript', 'TypeScript', 'React', 'Angular',
  'Vue', 'Node.js', 'Express', 'Spring Boot', 'Machine Learning',
  'Artificial Intelligence', 'Data Science', 'DBMS', 'SQL',
  'Operating Systems', 'Computer Networks', 'OOP', 'DSA', 'System Design',
  'HR', 'Aptitude',
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Adaptive'];
const EXPERIENCES = ['Fresher', '0-2 Years', '2-5 Years', '5+ Years'];
const DURATIONS = [15, 30, 45, 60];

function InterviewSetup({ onSubmit, onSkip }) {
  const [domain, setDomain] = useState('DSA');
  const [customDomain, setCustomDomain] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [difficulty, setDifficulty] = useState('Adaptive');
  const [experience, setExperience] = useState('Fresher');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [whoStarts, setWhoStarts] = useState('interviewer');

  const handleSubmit = () => {
    const resolvedDomain = useCustom && customDomain.trim()
      ? customDomain.trim()
      : domain;

    onSubmit({
      domain: resolvedDomain,
      difficulty,
      experience,
      durationMinutes,
      whoStarts,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="glass-strong rounded-3xl p-6 md:p-8 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center gap-2 mb-1">
          <HiSparkles className="text-violet-300 text-xl" />
          <h2 className="text-lg font-bold text-white">Interview Setup</h2>
        </div>
        <p className="text-slate-400 text-sm mb-6">
          Configure this AI-assisted mock interview. Both participants will see
          that AI assistance is active.
        </p>

        {/* Domain */}
        <label htmlFor="interview-domain" className="block text-sm font-medium text-slate-300 mb-2">Domain</label>
        <div className="flex gap-2 mb-2">
          <select
            id="interview-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={useCustom}
            className="input-glass flex-1 disabled:opacity-50"
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d} className="bg-dark-900">{d}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 mb-4">
          <input
            type="checkbox"
            checked={useCustom}
            onChange={(e) => setUseCustom(e.target.checked)}
          />
          Use a custom domain
        </label>
        {useCustom && (
          <input
            type="text"
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="e.g. Kubernetes"
            className="input-glass w-full mb-4"
          />
        )}

        {/* Difficulty */}
        <label id="interview-difficulty-label" className="block text-sm font-medium text-slate-300 mb-2">Difficulty</label>
        <div role="group" aria-labelledby="interview-difficulty-label" className="grid grid-cols-4 gap-2 mb-4">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                difficulty === d
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                  : 'glass text-slate-300 hover:text-white'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Experience */}
        <label id="interview-experience-label" className="block text-sm font-medium text-slate-300 mb-2">Candidate Experience</label>
        <div role="group" aria-labelledby="interview-experience-label" className="grid grid-cols-4 gap-2 mb-4">
          {EXPERIENCES.map((e) => (
            <button
              key={e}
              onClick={() => setExperience(e)}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                experience === e
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                  : 'glass text-slate-300 hover:text-white'
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Duration */}
        <label id="interview-duration-label" className="block text-sm font-medium text-slate-300 mb-2">Duration (minutes)</label>
        <div role="group" aria-labelledby="interview-duration-label" className="grid grid-cols-4 gap-2 mb-4">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDurationMinutes(d)}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                durationMinutes === d
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                  : 'glass text-slate-300 hover:text-white'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Who starts */}
        <label id="interview-who-starts-label" className="block text-sm font-medium text-slate-300 mb-2">Who starts first?</label>
        <div role="group" aria-labelledby="interview-who-starts-label" className="grid grid-cols-2 gap-2 mb-6">
          {[
            { key: 'interviewer', label: 'Interviewer' },
            { key: 'candidate', label: 'Candidate' },
          ].map((o) => (
            <button
              key={o.key}
              onClick={() => setWhoStarts(o.key)}
              className={`py-2 rounded-lg text-sm font-medium transition-all ${
                whoStarts === o.key
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                  : 'glass text-slate-300 hover:text-white'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onSkip} className="glass flex-1 py-3 rounded-xl text-sm text-slate-300 hover:text-white">
            Skip (plain meeting)
          </button>
          <button onClick={handleSubmit} className="btn-primary flex-1 py-3 text-sm">
            Start AI-assisted interview
          </button>
        </div>
      </div>
    </div>
  );
}

export default InterviewSetup;
