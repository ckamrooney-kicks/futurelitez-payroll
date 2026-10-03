# FuturElitez Payroll

Coach timesheets and monthly payroll for FuturElitez.

- Coaches sign in with their email, and their set workdays for the pay period are already filled in. They untick missed days, pick a rate ($40 / $45 / $50 / $55 per hour), adjust hours, add extra dates, and submit.
- **Pay period:** 21st → 20th. **Payday:** the 1st of the following month.
- On submit, the server re-checks every date, hour and rate, computes the total itself, builds a PDF and **emails it to the admins** (the coach gets a copy).
- Admins see every timesheet per period, who's missing, and the period total. They can download PDFs, mark timesheets paid (which locks them), manage the roster and set the payroll email.
- It installs to a phone's home screen like an app.

```
web/                       The app (plain HTML/CSS/JS, no build step) → GitHub Pages
supabase/migrations/       Database tables + security rules
supabase/functions/        submit-timesheet (save + PDF + email), timesheet-pdf (download)
.github/workflows/         Auto-deploy on push to main, plus a keep-alive ping
```

---

## One-time setup (about 30 minutes)

### 1. Supabase project
1. Create a project at [supabase.com](https://supabase.com). Save the **database password** you choose.
2. From **Project Settings**, copy:
   - **Project ref**: the ID in the URL, e.g. `abcd1234efgh5678`
   - **Project URL**: `https://<ref>.supabase.co`
   - **anon / publishable key**
3. Create a personal access token at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

### 2. GitHub repo
1. Create a new repo (e.g. `futurelitez-payroll`) and push this folder to `main`:
   ```bash
   cd futurelitez-payroll
   git init && git add . && git commit -m "FuturElitez Payroll"
   git branch -M main
   git remote add origin https://github.com/<you>/futurelitez-payroll.git
   git push -u origin main
   ```
   GitHub Pages is free for **public** repos. A private repo needs GitHub Pro, or you can host `web/` on Vercel or Netlify instead. A public repo is safe because no secrets are stored in it.
2. **Settings → Pages → Source:** choose **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret.** Add:

   | Secret | Value |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | personal access token from step 1.3 |
   | `SUPABASE_PROJECT_REF` | project ref |
   | `SUPABASE_DB_PASSWORD` | database password |
   | `SUPABASE_URL` | project URL (used by the keep-alive ping) |
   | `SUPABASE_ANON_KEY` | anon / publishable key (used by the keep-alive ping) |

### 3. Point the app at Supabase
Edit `web/config.js` with your project URL and anon key, then commit and push. The anon key is meant to be public, because the database rules protect the data.

### 4. Deploy
In the **Actions** tab, run **Deploy database + functions to Supabase** and **Deploy app to GitHub Pages**. Both also run on their own whenever you push changes. The Pages run prints your app link, e.g. `https://<you>.github.io/futurelitez-payroll/`.

### 5. Email (Resend)
1. Create a free account at [resend.com](https://resend.com). Add and verify the domain you'll send from (e.g. `futurelitez.com`, which means adding the DNS records Resend gives you). Until a domain is verified, Resend only delivers to your own Resend account email.
2. Create an API key.
3. In Supabase, go to **Edge Functions → Secrets** and add:
   - `RESEND_API_KEY` = your Resend key
   - `PAYROLL_FROM_EMAIL` = `FuturElitez Payroll <payroll@futurelitez.com>` (must be on the verified domain)

### 6. Sign-in emails (Supabase → Authentication)
1. **URL Configuration → Site URL:** your GitHub Pages link.
2. **Emails → Templates:** in both **Magic Link** and **Confirm signup**, replace the body with:
   ```html
   <h2>Your FuturElitez Payroll code</h2>
   <p>Enter this code in the app: <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>It expires in 1 hour.</p>
   ```
   The app signs in with a 6-digit code instead of a link, because on iPhone a link would open Safari instead of the home-screen app.
3. **Emails → SMTP Settings:** turn on custom SMTP so sign-in codes aren't capped by Supabase's built-in sender, which only allows a few emails per hour. Using Resend:
   - Host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key
   - Sender = an address on your verified domain

### 7. Make yourself the first admin
Go to **Supabase → SQL Editor** and run, with your details:
```sql
insert into public.employees (full_name, email, role, default_rate, default_hours, workdays)
values ('Ckameron', 'your-email@example.com', 'admin', 50, 1.5, '{2,4}');
-- workdays: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
```
Then open the app, sign in with that email, go to **Settings** and enter the payroll email address(es), and add your coaches under **Employees**.

---

## For coaches
1. Open the app link on your phone.
2. **iPhone:** Share → **Add to Home Screen**. **Android:** ⋮ menu → **Install app**.
3. Sign in with the email your admin added, and enter the 6-digit code from your inbox.
4. Before the 20th each month, check your dates and tap **Submit for payroll**. You can resubmit until an admin marks it paid.

## Monthly admin routine
1. After the 20th, open **Submissions** and choose the period. Anyone marked **Missing** hasn't submitted yet.
2. Run payroll from the PDFs in your inbox (or download them from the list).
3. Tap **Mark paid** on each one. That locks the timesheet.

## Making changes
- **The app's look or behavior:** edit files in `web/` and push. Pages redeploys in about a minute.
- **Database changes:** add a new file in `supabase/migrations/` (never edit an applied one) and push.
- **Rates:** the allowed list ($40–$55) lives in `web/app.js` (`RATES`) and in the database check in the migration. Change both, with the database part done as a new migration.

## Security model
- Coaches can read only their own roster row and their own timesheets. They can't change their rate, workdays or role.
- Timesheets are written only by the `submit-timesheet` function. The database recalculates every total and rejects dates outside the period, duplicate dates, hours outside 0–12, and rates not on the list.
- Only admins can see all timesheets, mark them paid, edit the roster or change settings.
- Anyone can request a sign-in code, but an email that isn't on the roster sees nothing.
