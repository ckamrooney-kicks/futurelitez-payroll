create or replace function public.validate_submission()
returns trigger language plpgsql as $$
declare
  y int; m int; p_start date; p_end date;
  r jsonb; d date; h numeric; rt int;
  seen date[] := '{}'; n int := 0; hrs numeric := 0; tot numeric := 0;
begin
  y := split_part(new.period_key, '-', 1)::int;
  m := split_part(new.period_key, '-', 2)::int;
  p_end   := (make_date(y, m, 1) + interval '1 month' - interval '2 days')::date;
  p_start := (make_date(y, m, 1) - 1);
  if jsonb_typeof(new.rows) <> 'array' or jsonb_array_length(new.rows) = 0 then
    raise exception 'Timesheet has no dates worked';
  end if;
  if jsonb_array_length(new.rows) > 31 then
    raise exception 'Too many dates for one pay period';
  end if;
  for r in select * from jsonb_array_elements(new.rows) loop
    begin
      d := (r ->> 'date')::date; h := (r ->> 'hours')::numeric; rt := (r ->> 'rate')::int;
    exception when others then
      raise exception 'A date row is badly formatted';
    end;
    if d is null or d < p_start or d > p_end then
      raise exception 'Date % is outside the pay period (% to %)', d, p_start, p_end;
    end if;
    if d = any(seen) then raise exception 'Date % is listed twice', d; end if;
    if h is null or h <= 0 or h > 12 then
      raise exception 'Hours on % must be more than 0 and at most 12', d;
    end if;
    if rt is null or rt not in (40, 45, 50, 55) then
      raise exception 'Rate on % must be $40, $45, $50 or $55', d;
    end if;
    seen := seen || d; n := n + 1; hrs := hrs + h; tot := tot + h * rt;
  end loop;
  new.days := n; new.hours := round(hrs, 2); new.total := round(tot, 2);
  return new;
end $$;
