import React from 'react';
import { HiMicrophone, HiSpeakerXMark, HiVideoCamera, HiVideoCameraSlash } from 'react-icons/hi2';

function Row({ name, role, audio, video, you }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">
          {name}
          {you && <span className="ml-1 text-xs text-slate-400">(you)</span>}
        </div>
        {role && <div className="text-xs text-slate-400">{role}</div>}
      </div>
      <div className="flex items-center gap-2 text-slate-300" aria-label={`${audio ? 'Microphone on' : 'Microphone off'}, ${video ? 'camera on' : 'camera off'}`}>
        {audio ? <HiMicrophone aria-hidden="true" /> : <HiSpeakerXMark className="text-red-400" aria-hidden="true" />}
        {video ? <HiVideoCamera aria-hidden="true" /> : <HiVideoCameraSlash className="text-red-400" aria-hidden="true" />}
      </div>
    </li>
  );
}

function ParticipantsPanel({ me, partner }) {
  return (
    <div className="p-3">
      <h3 className="sr-only">People in this meeting</h3>
      <ul className="space-y-2">
        <Row you name="You" role={me.role} audio={me.audio} video={me.video} />
        {partner ? (
          <Row name={partner.name} role={partner.role} audio={partner.audio} video={partner.video} />
        ) : (
          <li className="text-sm text-slate-500 px-1">Waiting for your partner to join.</li>
        )}
      </ul>
    </div>
  );
}

export default ParticipantsPanel;
