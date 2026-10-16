/**
 * RoomEntry.jsx: the page for /room/:roomId.
 *
 * Everyone lands on the "Get ready" screen first (inside MeetingRoom). The call itself starts only after
 * both people have said Yes and clicked Ready, which the meeting server decides.
 */

import React from 'react';
import MeetingRoom from './MeetingRoom.jsx';

function RoomEntry() {
  return <MeetingRoom />;
}

export default RoomEntry;
