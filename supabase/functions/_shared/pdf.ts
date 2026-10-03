import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { fmt, money, parseIso, periodByKey, WEEKDAYS } from "./period.ts";

export interface TimesheetRow {
  date: string;
  hours: number;
  rate: number;
  extra?: boolean;
}

export interface TimesheetForPdf {
  employeeName: string;
  employeeEmail: string;
  periodKey: string;
  rows: TimesheetRow[];
  days: number;
  hours: number;
  total: number;
  notes?: string | null;
  submittedAt: string;
  status: string;
}

// Standard PDF fonts only cover Latin-1; replace anything else so a name never breaks the PDF.
const safe = (s: string) =>
  String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

const GREEN = rgb(0.06, 0.48, 0.31);
const GREY = rgb(0.38, 0.42, 0.40);
const LINE = rgb(0.86, 0.89, 0.87);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(test, size) > width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export async function buildTimesheetPdf(t: TimesheetForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`FuturElitez Payroll - ${safe(t.employeeName)} - ${t.periodKey}`);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = periodByKey(t.periodKey);

  const W = 612, H = 792, L = 56, R = W - 56;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 64;

  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = o.font ?? reg, size = o.size ?? 10, str = safe(s);
    const xx = o.right ? x - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: xx, y: yy, font, size, color: o.color ?? rgb(0.08, 0.13, 0.11) });
  };

  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: GREEN });
  text("FUTURELITEZ", L, y, { font: bold, size: 9, color: GREEN });
  y -= 22;
  text("Payroll Timesheet", L, y, { font: bold, size: 22 });
  text(t.status === "paid" ? "PAID" : "SUBMITTED", R, y + 4, { font: bold, size: 10, color: t.status === "paid" ? GREEN : GREY, right: true });
  y -= 30;

  const info: [string, string][] = [
    ["Employee", t.employeeName],
    ["Email", t.employeeEmail || "-"],
    ["Pay period", `${fmt(p.start)} - ${fmt(p.end)}`],
    ["Pay date", fmt(p.pay)],
    ["Submitted", new Date(t.submittedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"],
  ];
  for (const [k, v] of info) {
    text(k, L, y, { font: bold, size: 10, color: GREY });
    text(v, L + 90, y, { size: 11 });
    y -= 17;
  }
  y -= 14;

  const cols = { date: L, type: L + 170, hours: L + 290, rate: L + 370, amt: R };
  const header = () => {
    page.drawRectangle({ x: L - 6, y: y - 6, width: R - L + 12, height: 20, color: rgb(0.90, 0.95, 0.92) });
    text("DATE", cols.date, y, { font: bold, size: 9 });
    text("TYPE", cols.type, y, { font: bold, size: 9 });
    text("HOURS", cols.hours, y, { font: bold, size: 9 });
    text("RATE", cols.rate, y, { font: bold, size: 9 });
    text("AMOUNT", cols.amt, y, { font: bold, size: 9, right: true });
    y -= 22;
  };
  header();

  for (const r of [...t.rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (y < 120) {
      page = doc.addPage([W, H]);
      y = H - 64;
      header();
    }
    const d = parseIso(r.date);
    text(`${WEEKDAYS[d.getUTCDay()]} ${fmt(d)}`, cols.date, y, { size: 10 });
    text(r.extra ? "Extra" : "Scheduled", cols.type, y, { size: 10, color: r.extra ? rgb(0.63, 0.36, 0) : GREY });
    text(String(r.hours), cols.hours, y, { size: 10 });
    text(`$${r.rate}/hr`, cols.rate, y, { size: 10 });
    text(money(r.hours * r.rate), cols.amt, y, { size: 10, right: true });
    page.drawLine({ start: { x: L - 6, y: y - 6 }, end: { x: R + 6, y: y - 6 }, thickness: 0.5, color: LINE });
    y -= 20;
  }

  y -= 8;
  text(`${t.days} day${t.days === 1 ? "" : "s"}  ·  ${t.hours} hours`, L, y, { font: bold, size: 11 });
  text(`Total  ${money(Number(t.total))}`, R, y, { font: bold, size: 14, color: GREEN, right: true });
  y -= 30;

  if (t.notes) {
    text("Notes", L, y, { font: bold, size: 10, color: GREY });
    y -= 15;
    for (const line of wrap(t.notes, reg, 10, R - L)) {
      if (y < 110) { page = doc.addPage([W, H]); y = H - 64; }
      text(line, L, y, { size: 10 });
      y -= 14;
    }
  }

  const sigY = Math.min(y - 30, 90);
  if (sigY < 50) { page = doc.addPage([W, H]); }
  const sy = sigY < 50 ? 90 : sigY;
  page.drawLine({ start: { x: L, y: sy }, end: { x: L + 220, y: sy }, thickness: 0.7, color: GREY });
  page.drawLine({ start: { x: R - 200, y: sy }, end: { x: R, y: sy }, thickness: 0.7, color: GREY });
  text("Employee signature", L, sy - 13, { size: 9, color: GREY });
  text("Approved by", R - 200, sy - 13, { size: 9, color: GREY });

  return await doc.save();
}

export function pdfFileName(name: string, periodKey: string): string {
  return `FuturElitez_Payroll_${String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_")}_${periodKey}.pdf`;
}
