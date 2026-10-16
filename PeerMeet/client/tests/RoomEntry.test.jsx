import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/pages/MeetingRoom.jsx', () => ({
  default: () => <div data-testid="room">the room page</div>,
}));

import RoomEntry from '../src/pages/RoomEntry.jsx';

describe('RoomEntry', () => {
  it('goes straight to the room page, whose first screen is "Get ready" (there is no separate lobby any more)', () => {
    render(
      <MemoryRouter initialEntries={['/room/room-aaa111?init=true']}>
        <Routes>
          <Route path="/room/:roomId" element={<RoomEntry />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('room')).toBeTruthy();
  });
});
