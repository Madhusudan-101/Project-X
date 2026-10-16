/**
 * RoomEntry.jsx — decides whether to show the pre-join lobby or go straight into the meeting.
 *
 * A person who already went through the lobby for this room in this tab (for example after a page
 * refresh) goes straight back in; everyone else sees the lobby first.
 */

import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Lobby from '../components/Lobby.jsx';
import MeetingRoom from './MeetingRoom.jsx';
import { getAuthToken } from '../utils/authToken.js';
import { loadLobby, saveLobby } from '../utils/lobbyPrefs.js';

function RoomEntry() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const [lobby, setLobby] = useState(() => loadLobby(roomId));

  if (!lobby) {
    return (
      <Lobby
        isPrivate={searchParams.get('private') === '1'}
        hasIdentity={Boolean(getAuthToken())}
        onJoin={(prefs) => {
          saveLobby(roomId, prefs);
          setLobby({ ...prefs });
        }}
      />
    );
  }
  return <MeetingRoom lobby={lobby} />;
}

export default RoomEntry;
