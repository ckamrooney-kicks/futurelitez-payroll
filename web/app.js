import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.PAYROLL_CONFIG || {};
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const RATES = [40, 45, 50, 55];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const app = document.getElementById("app");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const fmtShort = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3000);
}
function store(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null");
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  } catch { return null; }
}

/* ── Pay periods: 21st → 20th, paid on the 1st of the next month ── */
export function periodFor(endY, endM) {
  const end = new Date(endY, endM, 20), start = new Date(endY, endM - 1, 21), pay = new Date(endY, endM + 1, 1);
  return { key: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`, start, end, pay,
    label: `${fmtShort(start)} – ${fmtShort(end)}, ${end.getFullYear()}` };
}
export function currentPeriod(today = new Date()) {
  return today.getDate() > 20 ? periodFor(today.getFullYear(), today.getMonth() + 1) : periodFor(today.getFullYear(), today.getMonth());
}
export const periodByKey = (k) => { const [y, m] = k.split("-").map(Number); return periodFor(y, m - 1); };
function periodOptions(back = 6) {
  const cur = currentPeriod(), out = [];
  for (let i = 1; i >= -back; i--) out.push(periodFor(cur.end.getFullYear(), cur.end.getMonth() + i));
  return out;
}
function periodSelectHtml(id, selected) {
  const cur = currentPeriod().key;
  return `<select id="${id}">${periodOptions().map((p) =>
    `<option value="${p.key}" ${p.key === selected ? "selected" : ""}>${p.label}${p.key === cur ? " (current)" : ""}</option>`).join("")}</select>`;
}

/* ── App state ── */
let session = null, me = null, tab = "sheet", booted = false;

sb.auth.onAuthStateChange((_evt, s) => {
  const changed = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
  session = s;
  // Supabase recommends not awaiting other Supabase calls inside this callback
  if (!booted || changed) { booted = true; setTimeout(boot, 0); }
});

async function boot() {
  if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT")) {
    app.innerHTML = `<div class="login panel"><h2>Almost there</h2><p class="note">Add your Supabase URL and key to <b>web/config.js</b>, then reload.</p></div>`;
    return;
  }
  if (!session) return renderLogin();
  const email = session.user.email.toLowerCase();
  const { data, error } = await sb.from("employees").select("*").eq("email", email).maybeSingle();
  if (error) { app.innerHTML = `<div class="login panel"><h2>Can't load your account</h2><p class="note">${esc(error.message)}</p></div>`; return; }
  me = data;
  if (!me || !me.active) {
    app.innerHTML = `<div class="login panel"><h2>Not on the roster yet</h2>
      <p class="note">${esc(email)} isn't on the FuturElitez payroll roster. Ask an admin to add this exact email, then sign in again.</p>
      <button class="btn" id="signout">Sign out</button></div>`;
    $("signout").onclick = () => sb.auth.signOut();
    return;
  }
  renderShell();
}

/* ── Login: email → 6-digit code (works inside the home-screen app, unlike magic links) ── */
function renderLogin(sentTo) {
  app.innerHTML = `<div class="login stack">
    <div><div class="eyebrow">FuturElitez</div><h1>Coach Payroll</h1></div>
    <div class="panel">
      ${sentTo ? `
        <p>We emailed a 6-digit code to <b>${esc(sentTo)}</b>.</p>
        <label class="f">Code<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
        <button class="btn primary" id="verify">Sign in</button>
        <button class="btn link" id="back">Use a different email</button>`
      : `
        <label class="f">Your work email<input id="email" type="email" autocomplete="email" placeholder="you@futurelitez.com"></label>
        <button class="btn primary" id="send">Email me a sign-in code</button>
        <p class="note">Use the email your admin added to the payroll roster.</p>`}
    </div></div>`;
  if (sentTo) {
    $("code").focus();
    $("back").onclick = () => renderLogin();
    const go = async () => {
      const token = $("code").value.trim();
      if (!token) return;
      $("verify").disabled = true;
      const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: "email" });
      if (error) { toast("That code didn't work. Check it or request a new one."); $("verify").disabled = false; }
    };
    $("verify").onclick = go;
    $("code").onkeydown = (e) => e.key === "Enter" && go();
  } else {
    const send = async () => {
      const email = $("email").value.trim().toLowerCase();
      if (!email.includes("@")) return toast("Enter your email");
      $("send").disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) { toast(error.message); $("send").disabled = false; return; }
      renderLogin(email);
    };
    $("send").onclick = send;
    $("code").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }
}

/* ── Shell with tabs ── */
function renderShell() {
  const isAdmin = me.role === "admin";
  const p = currentPeriod();
  app.innerHTML = `
    <div class="head">
      <div><div class="eyebrow">FuturElitez · ${esc(me.full_name)}</div><h1>Coach Payroll</h1></div>
      <div class="period"><span class="eyebrow">Current pay period</span><b>${p.label}</b><span class="pill">Paid ${fmt(p.pay)}</span></div>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="sheet">My timesheet</button>
      ${isAdmin ? `<button role="tab" data-tab="subs">Submissions</button><button role="tab" data-tab="roster">Employees</button><button role="tab" data-tab="settings">Settings</button>` : ""}
      <button role="tab" data-tab="signout" style="margin-left:auto">Sign out</button>
    </div>
    <div id="view"></div>`;
  app.querySelector(".tabs").onclick = (e) => {
    const t = e.target.dataset?.tab; if (!t) return;
    if (t === "signout") return sb.auth.signOut();
    tab = t; showTab();
  };
  showTab();
}
function showTab() {
  for (const b of app.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.tab === tab);
  document.querySelector(".bar")?.remove();
  ({ sheet: renderSheet, subs: renderSubs, roster: renderRoster, settings: renderSettings }[tab] || renderSheet)();
}

/* ── Timesheet ── */
let sheet = null; // { periodKey, entries: {date: {on, hours, rate, extra}}, notes, existing }

function buildEntries(p, prev) {
  const entries = {};
  for (let d = new Date(p.start); d <= p.end; d.setDate(d.getDate() + 1)) {
    if ((me.workdays || []).includes(d.getDay())) {
      const k = iso(d);
      entries[k] = prev?.[k] ?? { on: true, hours: Number(me.default_hours), rate: me.default_rate, extra: false };
    }
  }
  if (prev) for (const k in prev) if (!entries[k]) entries[k] = { ...prev[k], extra: true };
  return entries;
}
const draftKey = (k) => `fe-payroll:${me.id}:${k}`;
const saveDraft = () => sheet && store(draftKey(sheet.periodKey), { entries: sheet.entries, notes: sheet.notes });

async function renderSheet(periodKey = sheet?.periodKey || currentPeriod().key) {
  const view = $("view");
  view.innerHTML = `<div class="stack">
    <div class="panel">
      <div class="row">
        <label class="f">Pay period ${periodSelectHtml("periodSel", periodKey)}</label>
      </div>
      <p class="note" id="sched"></p>
      <div id="status"></div>
    </div>
    <div class="panel">
      <div class="head" style="margin:0">
        <h2>Dates worked</h2>
        <label class="f" style="flex-direction:row;align-items:center;gap:6px">Set all rates
          <select id="bulkRate" style="width:auto"><option value="">—</option>${RATES.map((r) => `<option value="${r}">$${r}</option>`).join("")}</select>
        </label>
      </div>
      <p class="note">Filled in from your set workdays. Untick days you didn't work, adjust hours, and add any extra dates.</p>
      <div class="tablewrap"><table class="days">
        <thead><tr><th>Worked</th><th>Date</th><th>Hours</th><th>Rate/hr</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody id="dayRows"></tbody>
      </table></div>
      <div class="row" style="align-items:end">
        <label class="f">Add an extra date<input type="date" id="extraDate"></label>
        <div style="flex:0 0 auto"><button class="btn" id="addExtra">Add date</button></div>
      </div>
      <label class="f">Notes for admins (optional)<textarea id="notes" rows="2" maxlength="1000" placeholder="e.g. Covered U9 session for another coach on the 14th"></textarea></label>
    </div>
  </div>`;
  document.querySelectorAll(".bar").forEach((b) => b.remove());
  if (tab !== "sheet") return;
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML = `<div class="in"><div class="total"><small id="totalMeta"></small><span class="big" id="totalAmt">$0.00</span></div>
    <button class="btn primary" id="submitBtn">Submit for payroll</button></div>`;
  document.body.appendChild(bar);

  const p = periodByKey(periodKey);
  $("sched").textContent = `Your set days: ${(me.workdays || []).slice().sort().map((d) => WD[d]).join(", ") || "none"} · default ${money(me.default_rate)}/hr · ${Number(me.default_hours)} hrs/day · paid ${fmt(p.pay)}`;
  $("extraDate").min = iso(p.start); $("extraDate").max = iso(p.end);

  const { data: existing } = await sb.from("submissions").select("*").eq("employee_id", me.id).eq("period_key", periodKey).maybeSingle();
  const draft = store(draftKey(periodKey));
  let prev = draft?.entries;
  if (!prev && existing) {
    prev = {};
    for (const r of existing.rows) prev[r.date] = { on: true, hours: r.hours, rate: r.rate, extra: !!r.extra };
    // scheduled days that were left off the submission show as unticked
    const sched = buildEntries(p, null);
    for (const k in sched) if (!prev[k]) prev[k] = { ...sched[k], on: false };
  }
  sheet = { periodKey, entries: buildEntries(p, prev), notes: draft?.notes ?? existing?.notes ?? "", existing };
  $("notes").value = sheet.notes;
  renderStatus();
  drawRows();

  $("periodSel").onchange = (e) => { sheet = null; renderSheet(e.target.value); };
  $("dayRows").onchange = (e) => {
    const [kind, ...rest] = (e.target.id || "").split("_"); const k = rest.join("_"); const en = sheet.entries[k]; if (!en) return;
    if (kind === "on") en.on = e.target.checked;
    if (kind === "hrs") en.hours = Math.min(12, Math.max(0, parseFloat(e.target.value) || 0));
    if (kind === "rate") en.rate = Number(e.target.value);
    saveDraft(); drawRows();
  };
  $("dayRows").onclick = (e) => { const k = e.target.dataset?.del; if (!k) return; delete sheet.entries[k]; saveDraft(); drawRows(); };
  $("addExtra").onclick = () => {
    const v = $("extraDate").value; if (!v) return;
    const d = parseIso(v);
    if (d < p.start || d > p.end) return toast("That date is outside this pay period");
    if (sheet.entries[v]) { sheet.entries[v].on = true; toast("Already listed, marked as worked"); }
    else sheet.entries[v] = { on: true, hours: Number(me.default_hours), rate: me.default_rate, extra: true };
    $("extraDate").value = ""; saveDraft(); drawRows();
  };
  $("bulkRate").onchange = (e) => { const r = Number(e.target.value); if (!r) return; for (const k in sheet.entries) sheet.entries[k].rate = r; e.target.value = ""; saveDraft(); drawRows(); };
  $("notes").oninput = (e) => { sheet.notes = e.target.value; clearTimeout(saveDraft._t); saveDraft._t = setTimeout(saveDraft, 400); };
  $("submitBtn").onclick = submit;
}

function renderStatus() {
  const s = sheet.existing, el = $("status");
  if (!s) { el.innerHTML = ""; return; }
  const paid = s.status === "paid";
  el.innerHTML = `<div class="${paid ? "ok" : "notice"}">${paid ? "Paid" : "Submitted"} ${new Date(paid ? s.paid_at || s.submitted_at : s.submitted_at).toLocaleDateString("en-US")} · ${money(s.total)}
    ${paid ? "" : " · You can change it and submit again before payday."}</div>
    <div class="acts" style="margin-top:8px"><button class="btn small" id="myPdf">Download my PDF</button></div>`;
  $("myPdf").onclick = () => downloadPdf(s.id, $("myPdf"));
}

function totals() {
  let days = 0, hours = 0, amt = 0;
  for (const k in sheet.entries) { const e = sheet.entries[k]; if (!e.on || !(e.hours > 0)) continue; days++; hours += e.hours; amt += e.hours * e.rate; }
  return { days, hours: Math.round(hours * 100) / 100, amt };
}

function drawRows() {
  const tb = $("dayRows"), keys = Object.keys(sheet.entries).sort();
  const locked = sheet.existing?.status === "paid";
  tb.innerHTML = keys.length ? "" : `<tr><td colspan="5" class="note">None of your set workdays fall in this period. Add dates below.</td></tr>`;
  for (const k of keys) {
    const e = sheet.entries[k], d = parseIso(k), tr = document.createElement("tr");
    if (!e.on) tr.className = "off";
    tr.innerHTML = `<td><input type="checkbox" id="on_${k}" ${e.on ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="Worked ${fmt(d)}"></td>
      <td class="dt"><b>${WD[d.getDay()]} ${fmtShort(d)}</b><span>${e.extra ? '<span class="extra-tag">EXTRA</span>' : "Scheduled"}</span></td>
      <td><input type="number" id="hrs_${k}" min="0" max="12" step="0.25" value="${e.hours}" ${locked ? "disabled" : ""} aria-label="Hours on ${fmt(d)}"></td>
      <td><select id="rate_${k}" ${locked ? "disabled" : ""} aria-label="Rate on ${fmt(d)}">${RATES.map((r) => `<option value="${r}" ${Number(e.rate) === r ? "selected" : ""}>$${r}</option>`).join("")}</select></td>
      <td class="amt">${e.on ? money(e.hours * e.rate) : "—"}${e.extra && !locked ? ` <button class="x" data-del="${k}" aria-label="Remove ${fmt(d)}">×</button>` : ""}</td>`;
    tb.appendChild(tr);
  }
  const t = totals();
  $("totalAmt").textContent = money(t.amt);
  $("totalMeta").textContent = `${t.days} day${t.days === 1 ? "" : "s"} · ${t.hours} hrs`;
  const btn = $("submitBtn");
  btn.disabled = locked || t.days === 0;
  btn.textContent = locked ? "Paid — locked" : sheet.existing ? "Resubmit for payroll" : "Submit for payroll";
  for (const el of document.querySelectorAll("#addExtra,#extraDate,#bulkRate,#notes")) el.disabled = locked;
}

async function submit() {
  const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Submitting…";
  const rows = Object.keys(sheet.entries).sort().filter((k) => sheet.entries[k].on && sheet.entries[k].hours > 0)
    .map((k) => ({ date: k, hours: sheet.entries[k].hours, rate: sheet.entries[k].rate }));
  const { data, error } = await sb.functions.invoke("submit-timesheet", { body: { period_key: sheet.periodKey, rows, notes: sheet.notes } });
  if (error) {
    let msg = "Couldn't submit. Check your connection and try again.";
    try { msg = (await error.context.json()).error || msg; } catch {}
    toast(msg); drawRows(); return;
  }
  store(draftKey(sheet.periodKey), null);
  toast(data.emailed ? `Submitted · ${money(data.total)} · emailed to admins` : `Submitted · ${money(data.total)}`);
  await renderSheet(sheet.periodKey);
  if (!data.emailed && data.emailError) {
    $("status").insertAdjacentHTML("beforeend", `<div class="notice" style="margin-top:8px">Saved for admins, but the email didn't go out: ${esc(data.emailError)}</div>`);
  }
}

async function downloadPdf(id, btn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Preparing…"; }
  try {
    const { data: { session: s } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/timesheet-pdf?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "timesheet.pdf";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { toast("Couldn't get the PDF: " + e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}

/* ── Admin: submissions ── */
async function renderSubs(periodKey = currentPeriod().key) {
  $("view").innerHTML = `<div class="stack"><div class="panel">
    <div class="row" style="align-items:end">
      <label class="f">Pay period ${periodSelectHtml("subsPeriod", periodKey)}</label>
      <div class="total" style="flex:0 0 auto;text-align:right"><small>Period total</small><span class="big" id="subsTotal">—</span></div>
    </div>
    <p class="note" id="subsMeta"></p>
    <div class="list" id="subsList"><div class="note">Loading…</div></div>
  </div></div>`;
  $("subsPeriod").onchange = (e) => renderSubs(e.target.value);
  const [{ data: subs, error }, { data: emps }] = await Promise.all([
    sb.from("submissions").select("*, employees(full_name, email)").eq("period_key", periodKey),
    sb.from("employees").select("id, full_name, active").eq("active", true).order("full_name"),
  ]);
  if (error) { $("subsList").innerHTML = `<div class="notice">${esc(error.message)}</div>`; return; }
  const p = periodByKey(periodKey);
  subs.sort((a, b) => a.employees.full_name.localeCompare(b.employees.full_name));
  const total = subs.reduce((a, s) => a + Number(s.total), 0);
  const paid = subs.filter((s) => s.status === "paid").length;
  $("subsTotal").textContent = money(total);
  $("subsMeta").textContent = `${subs.length} submitted · ${paid} paid · payday ${fmt(p.pay)}`;
  const list = $("subsList"); list.innerHTML = "";
  for (const s of subs) {
    const el = document.createElement("div"); el.className = "item";
    el.innerHTML = `<div class="who"><b>${esc(s.employees.full_name)}</b><span>${s.days} days · ${Number(s.hours)} hrs · submitted ${new Date(s.submitted_at).toLocaleDateString("en-US")}${s.emailed_at ? "" : " · not emailed"}${s.notes ? " · has notes" : ""}</span></div>
      <span class="pill ${s.status === "paid" ? "" : "warn"}">${s.status === "paid" ? "Paid" : "Awaiting payment"}</span>
      <span class="money">${money(s.total)}</span>
      <div class="acts"><button class="btn small" data-pdf>PDF</button><button class="btn small" data-paid>${s.status === "paid" ? "Reopen" : "Mark paid"}</button></div>`;
    el.querySelector("[data-pdf]").onclick = (e) => downloadPdf(s.id, e.target);
    el.querySelector("[data-paid]").onclick = async (e) => {
      e.target.disabled = true;
      const toPaid = s.status !== "paid";
      const { error } = await sb.from("submissions").update({ status: toPaid ? "paid" : "submitted", paid_at: toPaid ? new Date().toISOString() : null }).eq("id", s.id);
      if (error) { toast(error.message); e.target.disabled = false; return; }
      renderSubs(periodKey);
    };
    list.appendChild(el);
  }
  const done = new Set(subs.map((s) => s.employee_id));
  for (const e of emps || []) {
    if (done.has(e.id)) continue;
    const el = document.createElement("div"); el.className = "item";
    el.innerHTML = `<div class="who"><b>${esc(e.full_name)}</b><span>No timesheet yet</span></div><span class="pill warn">Missing</span>`;
    list.appendChild(el);
  }
  if (!list.children.length) list.innerHTML = `<div class="note">No coaches on the roster yet. Add them in Employees.</div>`;
}

/* ── Admin: employees ── */
let formDays = [];
async function renderRoster() {
  $("view").innerHTML = `<div class="stack">
    <div class="panel">
      <h2 id="empFormTitle">Add employee</h2>
      <input type="hidden" id="empId">
      <div class="row">
        <label class="f">Full name<input id="empName" placeholder="Jordan Alvarez"></label>
        <label class="f">Email (they sign in with this)<input id="empEmail" type="email" placeholder="jordan@example.com"></label>
      </div>
      <div class="row">
        <label class="f">Default rate (per hour)<select id="empRate">${RATES.map((r) => `<option value="${r}" ${r === 45 ? "selected" : ""}>$${r}</option>`).join("")}</select></label>
        <label class="f">Default hours per day<input id="empHours" type="number" step="0.25" min="0.25" max="12" value="1.5"></label>
        <label class="f">Access<select id="empRole"><option value="coach">Coach</option><option value="admin">Admin</option></select></label>
      </div>
      <div class="f">Set workdays<div class="chips" id="empDays"></div></div>
      <div class="acts"><button class="btn primary" id="saveEmp">Save employee</button><button class="btn" id="cancelEmp" hidden>Cancel</button></div>
    </div>
    <div class="panel"><h2>Roster</h2><div class="list" id="rosterList"><div class="note">Loading…</div></div></div>
  </div>`;
  const chips = () => ($("empDays").innerHTML = WD.map((n, i) => `<button type="button" class="chip" aria-pressed="${formDays.includes(i)}" data-d="${i}">${n}</button>`).join(""));
  const reset = () => { $("empId").value = ""; $("empName").value = ""; $("empEmail").value = ""; $("empRate").value = "45"; $("empHours").value = "1.5"; $("empRole").value = "coach"; formDays = []; chips(); $("empFormTitle").textContent = "Add employee"; $("cancelEmp").hidden = true; };
  reset();
  $("empDays").onclick = (e) => { const d = e.target.dataset?.d; if (d === undefined) return; const n = Number(d); formDays = formDays.includes(n) ? formDays.filter((x) => x !== n) : [...formDays, n]; chips(); };
  $("cancelEmp").onclick = reset;
  $("saveEmp").onclick = async () => {
    const row = {
      full_name: $("empName").value.trim(), email: $("empEmail").value.trim().toLowerCase(),
      default_rate: Number($("empRate").value), default_hours: parseFloat($("empHours").value) || 1,
      role: $("empRole").value, workdays: formDays.slice().sort(), active: true,
    };
    if (!row.full_name || !row.email.includes("@")) return toast("Enter a name and email");
    const id = $("empId").value;
    if (id === me.id && row.role !== "admin") return toast("You can't remove your own admin access");
    const { error } = id ? await sb.from("employees").update(row).eq("id", id) : await sb.from("employees").insert(row);
    if (error) return toast(error.code === "23505" ? "That email is already on the roster" : error.message);
    toast(`Saved ${row.full_name}`);
    if (id === me.id) me = { ...me, ...row };
    reset(); loadList();
  };
  async function loadList() {
    const { data, error } = await sb.from("employees").select("*").order("active", { ascending: false }).order("full_name");
    const list = $("rosterList");
    if (error) { list.innerHTML = `<div class="notice">${esc(error.message)}</div>`; return; }
    list.innerHTML = data.length ? "" : `<div class="note">No employees yet. Add your first coach above.</div>`;
    for (const e of data) {
      const el = document.createElement("div"); el.className = "item";
      el.innerHTML = `<div class="who"><b>${esc(e.full_name)}${e.role === "admin" ? ' <span class="pill">Admin</span>' : ""}${e.active ? "" : ' <span class="pill warn">Inactive</span>'}</b>
        <span>${esc(e.email)} · ${(e.workdays || []).map((d) => WD[d]).join(", ") || "no set days"} · ${money(e.default_rate)}/hr · ${Number(e.default_hours)} hrs/day</span></div>
        <div class="acts"><button class="btn small" data-edit>Edit</button>${e.id === me.id ? "" : `<button class="btn small" data-act>${e.active ? "Deactivate" : "Reactivate"}</button>`}</div>`;
      el.querySelector("[data-edit]").onclick = () => {
        $("empId").value = e.id; $("empName").value = e.full_name; $("empEmail").value = e.email; $("empRate").value = String(e.default_rate);
        $("empHours").value = Number(e.default_hours); $("empRole").value = e.role; formDays = [...(e.workdays || [])]; chips();
        $("empFormTitle").textContent = `Edit ${e.full_name}`; $("cancelEmp").hidden = false; window.scrollTo({ top: 0, behavior: "smooth" });
      };
      const act = el.querySelector("[data-act]");
      if (act) act.onclick = async () => {
        const { error } = await sb.from("employees").update({ active: !e.active }).eq("id", e.id);
        if (error) return toast(error.message);
        loadList();
      };
      list.appendChild(el);
    }
  }
  loadList();
}

/* ── Admin: settings ── */
async function renderSettings() {
  $("view").innerHTML = `<div class="stack"><div class="panel">
    <h2>Payroll email</h2>
    <p class="note">Every submitted timesheet PDF is emailed here automatically. The coach gets a copy.</p>
    <label class="f">Admin email addresses (comma-separated)<input id="adminEmails" placeholder="payroll@futurelitez.com, owner@futurelitez.com"></label>
    <div class="acts"><button class="btn primary" id="saveSettings">Save</button></div>
  </div></div>`;
  const { data } = await sb.from("settings").select("admin_emails").eq("id", 1).single();
  $("adminEmails").value = (data?.admin_emails || []).join(", ");
  $("saveSettings").onclick = async () => {
    const list = $("adminEmails").value.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
    const { error } = await sb.from("settings").update({ admin_emails: list }).eq("id", 1);
    if (error) return toast(error.message);
    $("adminEmails").value = list.join(", ");
    toast("Saved");
  };
}

