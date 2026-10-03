// Pay period: 21st of the previous month → 20th. Paid on the 1st of the following month.
// A period is keyed by the month it ends in: "2026-10" = Sep 21 – Oct 20, 2026, paid Nov 1.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface Period {
  key: string;
  start: Date;
  end: Date;
  pay: Date;
  label: string;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function periodByKey(key: string): Period {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error("Invalid pay period");
  const [y, m] = key.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, 20));
  const start = new Date(Date.UTC(y, m - 2, 21));
  const pay = new Date(Date.UTC(y, m, 1));
  return {
    key, start, end, pay,
    label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`,
  };
}

export function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
