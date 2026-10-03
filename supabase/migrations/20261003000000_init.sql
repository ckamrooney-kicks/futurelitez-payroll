-- FuturElitez Payroll — initial schema
-- Pay period: 21st of the previous month through the 20th; paid on the 1st of the following month.
-- A period is identified by the month it ENDS in, e.g. '2026-10' = Sep 21 – Oct 20, 2026 (paid Nov 1).

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────
create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null check (length(trim(full_name)) between 1 and 120),
  email          text not null unique check (email = lower(trim(email)) and email like '%@%'),
  role           text not null default 'coach' check (role in ('coach', 'admin')),
  default_rate   int  not null default 45 check (default_rate in (40, 45, 50, 55)),
  default_hours  numeric(4,2) not null default 1.5 check (default_hours > 0 and default_hours <= 12),
  workdays       smallint[] not null default '{}' check (workdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
comment on column public.employees.workdays is '0 = Sunday … 6 = Saturday';

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete restrict,
  period_key    text not null check (period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  rows          jsonb not null,           -- [{date:'YYYY-MM-DD', hours:1.5, rate:45, extra:false}]
  days          int,                      -- computed by trigger
  hours         numeric(6,2),             -- computed by trigger
  total         numeric(10,2),            -- computed by trigger
  notes         text check (notes is null or length(notes) <= 1000),
  status        text not null default 'submitted' check (status in ('submitted', 'paid')),
  submitted_at  timestamptz not null default now(),
  emailed_at    timestamptz,
  paid_at       timestamptz,
  unique (employee_id, period_key)
);

create table public.settings (
  id            int primary key default 1 check (id = 1),
  admin_emails  text[] not null default '{}'
);
insert into public.settings default values;

-- ─────────────────────────────────────────────────────────────
-- Helpers (security definer so policies can look up the caller's roster row)
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees
  where email = lower(auth.jwt() ->> 'email') and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees
    where email = lower(auth.jwt() ->> 'email') and active and role = 'admin'
  )
$$;

-- ─────────────────────────────────────────────────────────────
-- Server-side validation: totals are always computed here, never trusted from the browser
-- ─────────────────────────────────────────────────────────────
create or replace function public.validate_submission()
returns trigger language plpgsql as $$
declare
  y int; m int; p_start date; p_end date;
  r jsonb; d date; h numeric; rt int;
  seen date[] := '{}'; n int := 0; hrs numeric := 0; tot numeric := 0;
begin
  y := split_part(new.period_key, '-', 1)::int;
  m := split_part(new.period_key, '-', 2)::int;
  p_end   := make_date(y, m, 20);
  p_start := (make_date(y, m, 21) - interval '1 month')::date;

  if jsonb_typeof(new.rows) <> 'array' or jsonb_array_length(new.rows) = 0 then
    raise exception 'Timesheet has no dates worked';
  end if;
  if jsonb_array_length(new.rows) > 31 then
    raise exception 'Too many dates for one pay period';
  end if;

  for r in select * from jsonb_array_elements(new.rows) loop
    begin
      d  := (r ->> 'date')::date;
      h  := (r ->> 'hours')::numeric;
      rt := (r ->> 'rate')::int;
    exception when others then
      raise exception 'A date row is badly formatted';
    end;
    if d is null or d < p_start or d > p_end then
      raise exception 'Date % is outside the pay period (% to %)', d, p_start, p_end;
    end if;
    if d = any(seen) then
      raise exception 'Date % is listed twice', d;
    end if;
    if h is null or h <= 0 or h > 12 then
      raise exception 'Hours on % must be more than 0 and at most 12', d;
    end if;
    if rt is null or rt not in (40, 45, 50, 55) then
      raise exception 'Rate on % must be $40, $45, $50 or $55', d;
    end if;
    seen := seen || d; n := n + 1; hrs := hrs + h; tot := tot + h * rt;
  end loop;

  new.days  := n;
  new.hours := round(hrs, 2);
  new.total := round(tot, 2);
  return new;
end $$;

create trigger submissions_validate
  before insert or update of rows, period_key on public.submissions
  for each row execute function public.validate_submission();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- Coaches: read their own roster row and their own submissions.
-- Admins: everything. Submissions are written by the submit-timesheet edge function.
-- ─────────────────────────────────────────────────────────────
alter table public.employees   enable row level security;
alter table public.submissions enable row level security;
alter table public.settings    enable row level security;

create policy "employees: read self or admin" on public.employees
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin());
create policy "employees: admin insert" on public.employees
  for insert to authenticated with check (public.is_admin());
create policy "employees: admin update" on public.employees
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "employees: admin delete" on public.employees
  for delete to authenticated using (public.is_admin());

create policy "submissions: read own or admin" on public.submissions
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_admin());
create policy "submissions: admin update" on public.submissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "submissions: admin delete" on public.submissions
  for delete to authenticated using (public.is_admin());

create policy "settings: admin read" on public.settings
  for select to authenticated using (public.is_admin());
create policy "settings: admin update" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.employees, public.submissions to authenticated;
grant select, update on public.settings to authenticated;
-- The server functions use service_role; grant explicitly so this works even if
-- "Automatically expose new tables" was turned off when the project was created.
grant select, insert, update, delete on public.employees, public.submissions, public.settings to service_role;
grant execute on function public.current_employee_id(), public.is_admin() to authenticated, service_role;
