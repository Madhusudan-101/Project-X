/** A calendar file (.ics) for a scheduled peer interview, so it lands in the person's own calendar. */

export interface IcsMeeting {
  id: string;
  title: string | null;
  scheduled_at: string;
  duration_minutes: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 20301231T093000Z */
export function icsTime(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Text values must escape backslash, comma, semicolon and newlines (RFC 5545). */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded onto continuation lines that start with a space. */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(" " + line.slice(i, i + 74));
  return parts.join("\r\n");
}

export function buildIcs(m: IcsMeeting, now: Date = new Date()): string {
  const start = new Date(m.scheduled_at);
  const end = new Date(start.getTime() + m.duration_minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mirracle//Peer Interview//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.id}@mirracle`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(m.title?.trim() || "Peer interview")}`,
    `DESCRIPTION:${icsEscape("Practice interview on Mirracle. Open your dashboard and join from 5 minutes before the start.")}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Your peer interview starts in 15 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadIcs(m: IcsMeeting): void {
  const blob = new Blob([buildIcs(m)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "peer-interview.ics";
  a.click();
  URL.revokeObjectURL(url);
}
