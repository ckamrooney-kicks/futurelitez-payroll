// GET ?id=<submission id> → the timesheet PDF.
// Reads as the signed-in user, so coaches only get their own and admins get any.
import { cors, json, userFromRequest } from "../_shared/http.ts";
import { buildTimesheetPdf, pdfFileName } from "../_shared/pdf.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = await userFromRequest(req);
    if (!caller) return json({ error: "Please sign in again." }, 401);

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "Missing id" }, 400);

    const { data: s } = await caller.client
      .from("submissions")
      .select("*, employees(full_name, email)")
      .eq("id", id)
      .maybeSingle();
    if (!s) return json({ error: "Timesheet not found" }, 404);

    const pdf = await buildTimesheetPdf({
      employeeName: s.employees.full_name, employeeEmail: s.employees.email, periodKey: s.period_key,
      rows: s.rows, days: s.days, hours: Number(s.hours), total: Number(s.total),
      notes: s.notes, submittedAt: s.submitted_at, status: s.status,
    });
    return new Response(pdf, {
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(s.employees.full_name, s.period_key)}"`,
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
