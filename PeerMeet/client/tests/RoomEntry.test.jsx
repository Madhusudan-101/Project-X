import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/pages/MeetingRoom.jsx', () => ({
  default: ({ lobby }) => <div data-testid="room">room with {JSON.stringify(lobby)}</div>,
}));
vi.mock('../src/components/Lobby.jsx', () => ({
  default: ({ isPrivate, hasIdentity }) => <div data-testid="lobby">lobby private={String(isPrivate)} identity={String(hasIdentity)}</div>,
}));

import RoomEntry from '../src/pages/RoomEntry.jsx';
import { setAuthToken, setIdentityPrivate } from '../src/utils/authToken.js';
import { saveLobby } from '../src/utils/lobbyPrefs.js';

const at = (roomId) =>
  render(
    <MemoryRouter initialEntries={[`/room/${roomId}?init=true`]}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomEntry />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  sessionStorage.clear();
  setAuthToken(null);
  setIdentityPrivate(false);
});

describe('RoomEntry', () => {
  it('shows the lobby first, with the privacy and sign-in state the dashboard link carried', () => {
    setAuthToken('t');
    setIdentityPrivate(true);
    at('room-aaa111');
    expect(screen.getByTestId('lobby').textContent).toBe('lobby private=true identity=true');
    expect(screen.queryByTestId('room')).toBeNull();
  });

  it('an anonymous visitor sees the lobby without a sign-in', () => {
    at('room-bbb222');
    expect(screen.getByTestId('lobby').textContent).toBe('lobby private=false identity=false');
  });

  it('goes straight back into the room after a refresh, with what was chosen', () => {
    saveLobby('room-ccc333', { cameraId: 'cam', micId: 'mic', transcriptionConsent: true });
    at('room-ccc333');
    expect(screen.getByTestId('room').textContent).toContain('"cameraId":"cam"');
    expect(screen.getByTestId('room').textContent).toContain('"transcriptionConsent":true');
    expect(screen.queryByTestId('lobby')).toBeNull();
  });

  it('the choice is per room: another room still shows the lobby', () => {
    saveLobby('room-ccc333', { cameraId: 'cam', micId: 'mic', transcriptionConsent: true });
    at('room-ddd444');
    expect(screen.getByTestId('lobby')).toBeTruthy();
  });
});
