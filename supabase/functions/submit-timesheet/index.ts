// POST { period_key: "2026-10", rows: [{date, hours, rate}], notes?: string }
// Verifies the coach, saves the timesheet (database re-checks every row and computes the total),
// builds the PDF and emails it to the admins with a copy to the coach.
import { adminClient, cors, env, json, userFromRequest } from "../_shared/http.ts";
import { buildTimesheetPdf, pdfFileName, type TimesheetRow } from "../_shared/pdf.ts";
import { money, parseIso, periodByKey } from "../_shared/period.ts";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const caller = await userFromRequest(req);
    if (!caller) return json({ error: "Please sign in again." }, 401);

    const admin = adminClient();
    const { data: emp } = await admin.from("employees").select("*").eq("email", caller.email).eq("active", true).maybeSingle();
    if (!emp) return json({ error: "Your email isn't on the FuturElitez payroll roster. Ask an admin to add you." }, 403);

    const body = await req.json().catch(() => null);
    const periodKey = String(body?.period_key ?? "");
    let period;
    try { period = periodByKey(periodKey); } catch { return json({ error: "Pick a valid pay period." }, 400); }
    if (!Array.isArray(body?.rows) || body.rows.length === 0) return json({ error: "Tick at least one date you worked." }, 400);

    // Mark which dates fall outside the coach's set workdays, so admins can spot extras.
    const workdays: number[] = emp.workdays ?? [];
    const rows: TimesheetRow[] = body.rows.slice(0, 31).map((r: TimesheetRow) => ({
      date: String(r.date),
      hours: Number(r.hours),
      rate: Number(r.rate),
      extra: !workdays.includes(parseIso(String(r.date)).getUTCDay()),
    }));
    const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;

    const { data: existing } = await admin.from("submissions").select("status").eq("employee_id", emp.id).eq("period_key", periodKey).maybeSingle();
    if (existing?.status === "paid") return json({ error: "This pay period is already marked paid. Ask an admin to reopen it." }, 409);

    const { data: saved, error: saveErr } = await admin
      .from("submissions")
      .upsert(
        { employee_id: emp.id, period_key: periodKey, rows, notes, status: "submitted", submitted_at: new Date().toISOString(), emailed_at: null },
        { onConflict: "employee_id,period_key" },
      )
      .select("*")
      .single();
    if (saveErr) return json({ error: saveErr.message }, 400); // validation messages from the database are written for people

    // Email the PDF
    const { data: settings } = await admin.from("settings").select("admin_emails").eq("id", 1).single();
    const to: string[] = (settings?.admin_emails ?? []).filter(Boolean);
    let emailed = false, emailError: string | null = null;

    if (to.length === 0) {
      emailError = "No admin email is set yet. An admin can add one under Settings.";
    } else {
      const pdf = await buildTimesheetPdf({
        employeeName: emp.full_name, employeeEmail: emp.email, periodKey, rows: saved.rows,
        days: saved.days, hours: Number(saved.hours), total: Number(saved.total),
        notes: saved.notes, submittedAt: saved.submitted_at, status: saved.status,
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env("PAYROLL_FROM_EMAIL"),
          to,
          cc: [emp.email],
          reply_to: emp.email,
          subject: `Payroll timesheet – ${emp.full_name} – ${period.label}`,
          text:
            `${emp.full_name} submitted a timesheet.\n\n` +
            `Pay period: ${period.label}\n` +
            `${saved.days} days · ${saved.hours} hours · Total ${money(Number(saved.total))}\n` +
            (saved.notes ? `\nNotes: ${saved.notes}\n` : "") +
            `\nThe PDF is attached.`,
          attachments: [{ filename: pdfFileName(emp.full_name, periodKey), content: toBase64(pdf) }],
        }),
      });
      if (res.ok) {
        emailed = true;
        await admin.from("submissions").update({ emailed_at: new Date().toISOString() }).eq("id", saved.id);
      } else {
        emailError = `Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
        console.error(emailError);
      }
    }

    return json({ ok: true, id: saved.id, total: Number(saved.total), days: saved.days, hours: Number(saved.hours), emailed, emailError });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
