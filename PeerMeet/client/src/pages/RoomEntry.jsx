/**
 * RoomEntry.jsx — decides whether to show the pre-join lobby or go straight into the meeting.
 *
 * A person who already went through the lobby for this room in this tab (for example after a page
 * refresh) goes straight back in; everyone else sees the lobby first.
 */

import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import Lobby from '../components/Lobby.jsx';
import MeetingRoom from './MeetingRoom.jsx';
import { getAuthToken, getIdentityPrivate } from '../utils/authToken.js';
import { loadLobby, saveLobby } from '../utils/lobbyPrefs.js';

function RoomEntry() {
  const { roomId } = useParams();
  const [lobby, setLobby] = useState(() => loadLobby(roomId));

  if (!lobby) {
    return (
      <Lobby
        // Home read this from the dashboard link and removed it from the URL; it lives in memory now.
        isPrivate={getIdentityPrivate()}
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
