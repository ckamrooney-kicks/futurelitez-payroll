import { adminClient, cors, env, json } from "../_shared/http.ts";
import { fmt, periodByKey } from "../_shared/period.ts";

const APP_URL = "https://ckamrooney-kicks.github.io/futurelitez-payroll/";

function todayEastern(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.headers.get("x-reminder-secret") !== env("REMINDER_SECRET")) return json({ error: "Not allowed" }, 401);

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const only = url.searchParams.get("only")?.toLowerCase() || null;

    const t = todayEastern();
    const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
    let period = periodByKey(key(t.y, t.m));
    if (t.d > period.end.getUTCDate()) {
      const ny = t.m === 12 ? t.y + 1 : t.y, nm = t.m === 12 ? 1 : t.m + 1;
      period = periodByKey(key(ny, nm));
    }
    const due = period.end;
    const dayBefore = new Date(due); dayBefore.setUTCDate(due.getUTCDate() - 1);
    const isReminderDay = t.y === dayBefore.getUTCFullYear() && t.m === dayBefore.getUTCMonth() + 1 && t.d === dayBefore.getUTCDate();

    if (!isReminderDay && !force) {
      return json({ sent: 0, skipped: `Not reminder day. Next reminder: ${fmt(dayBefore)} for the ${period.label} period.` });
    }

    const db = adminClient();
    const [{ data: emps, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
      db.from("employees").select("id, full_name, email, workdays").eq("active", true),
      db.from("submissions").select("employee_id").eq("period_key", period.key),
    ]);
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    const done = new Set((subs ?? []).map((s) => s.employee_id));
    let targets = (emps ?? []).filter((e) => (e.workdays ?? []).length > 0 && !done.has(e.id));
    if (only) targets = (emps ?? []).filter((e) => e.email === only);
    if (targets.length === 0) return json({ sent: 0, period: period.label, note: "Everyone has already submitted." });

    const emails = targets.map((e) => ({
      from: env("PAYROLL_FROM_EMAIL"),
      to: [e.email],
      subject: `Reminder: timesheet due tomorrow (${fmt(due)})`,
      text:
        `Hi ${e.full_name.split(" ")[0]},\n\n` +
        `Your FuturElitez timesheet for ${period.label} is due tomorrow, ${fmt(due)}.\n` +
        `Payday is ${fmt(period.pay)}.\n\n` +
        `Submit it here: ${APP_URL}\n\n` +
        `Your set days are already filled in. Just check them, adjust anything that changed, and tap Submit for payroll.\n\n` +
        `Thanks,\nFuturElitez`,
    }));

    let sent = 0;
    const errors: string[] = [];
    for (let i = 0; i < emails.length; i += 100) {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(emails.slice(i, i + 100)),
      });
      if (res.ok) sent += Math.min(100, emails.length - i);
      else errors.push(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    return json({ sent, period: period.label, due: fmt(due), to: targets.map((e) => e.email), errors });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
