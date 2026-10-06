// Pay period: last day of the previous month → the day before the last day of this month. Paid the 1st.
// Keyed by the month it ends in: "2026-10" = Sep 30 – Oct 30, 2026, paid Nov 1.

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
  // Ends the day before the last day of the month; starts the last day of the previous month.
  const end = new Date(Date.UTC(y, m, -1));
  const start = new Date(Date.UTC(y, m - 1, 0));
  const pay = new Date(Date.UTC(y, m, 1));
  return {
    key, start, end, pay,
    label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`,
  };
}

export function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
