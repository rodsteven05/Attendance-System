begin;

-- Do not guess the teaching days of existing classrooms from free-form text.
alter table public.classrooms
  add column teaching_days integer[] not null default '{}',
  add column no_class_dates date[] not null default '{}',
  add constraint valid_teaching_days check (teaching_days <@ array[0,1,2,3,4,5,6]);

create or replace function public.protect_profile_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only administrators can change roles';
  end if;
  return new;
end; $$;
create trigger protect_profile_role before update on public.profiles
for each row execute function public.protect_profile_role();

drop policy if exists "teachers create students" on public.students;
create policy "teachers create students" on public.students for insert
with check (created_by = auth.uid());
create or replace function public.protect_student_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'The student creator cannot be changed';
  end if;
  return new;
end; $$;
create trigger protect_student_creator before update on public.students
for each row execute function public.protect_student_creator();

-- Resolve student access outside RLS to avoid recursive student/enrollment policies.
create or replace function public.can_access_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1 from public.students s where s.id = p_student_id and s.created_by = auth.uid()
  ) or exists (
    select 1 from public.classroom_students cs join public.classrooms c on c.id = cs.classroom_id
    where cs.student_id = p_student_id and c.teacher_id = auth.uid()
  );
$$;
drop policy if exists "teachers see enrolled or created students" on public.students;
create policy "teachers see enrolled or created students" on public.students for select
-- INSERT ... RETURNING must see the new row before a stable lookup can see it.
using (created_by = auth.uid() or public.can_access_student(id));
drop policy if exists "teachers update enrolled students" on public.students;
create policy "teachers update enrolled students" on public.students for update
using (public.can_access_student(id)) with check (public.can_access_student(id));
drop policy if exists "classroom enrollment access" on public.classroom_students;
create policy "classroom enrollment access" on public.classroom_students for all
using (public.owns_classroom(classroom_id))
with check (public.owns_classroom(classroom_id) and public.can_access_student(student_id));

create or replace function public.is_class_day(p_classroom_id uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(dow from p_date)::integer = any(c.teaching_days)
    and not p_date = any(c.no_class_dates)
    and p_date >= (c.created_at at time zone 'Asia/Manila')::date
    from public.classrooms c where c.id = p_classroom_id), false);
$$;

create or replace function public.mark_classroom_absences(
  p_classroom_id uuid, p_date date default (now() at time zone 'Asia/Manila')::date
) returns integer language plpgsql security definer set search_path = '' as $$
declare c public.classrooms; n integer; local_now timestamp := now() at time zone 'Asia/Manila';
begin
  if not public.owns_classroom(p_classroom_id) then raise exception 'Unauthorized'; end if;
  select * into c from public.classrooms where id = p_classroom_id for update;
  if c.status <> 'active' then raise exception 'Classroom is inactive'; end if;
  if cardinality(c.teaching_days) = 0 then raise exception 'Set teaching days in classroom settings first'; end if;
  if p_date is null or p_date > local_now::date then raise exception 'Cannot finalize a future date'; end if;
  if not public.is_class_day(c.id, p_date) then raise exception 'This is not a scheduled class day'; end if;
  if p_date = local_now::date and local_now::time < c.attendance_cutoff then
    raise exception 'Wait until the attendance cutoff before finalizing';
  end if;
  insert into public.attendance(student_id, classroom_id, teacher_id, attendance_date, status)
  select s.id, c.id, c.teacher_id, p_date, 'A' from public.classroom_students cs
  join public.students s on s.id = cs.student_id
  where cs.classroom_id = c.id and s.status = 'active'
    and (cs.enrolled_at at time zone 'Asia/Manila')::date <= p_date
    and (cs.removed_at is null or (cs.removed_at at time zone 'Asia/Manila')::date > p_date)
    and (cs.enrollment_status = 'active' or cs.removed_at is not null)
  on conflict (student_id, classroom_id, attendance_date) do nothing;
  get diagnostics n = row_count;
  insert into public.audit_logs(user_id, action, target_type, target_id, description)
  values(auth.uid(), 'ATTENDANCE_FINALIZED', 'classroom', c.id::text, p_date::text || ': ' || n || ' absences recorded');
  return n;
end; $$;

create table public.attendance_history (
  id bigint generated always as identity primary key,
  attendance_id uuid not null references public.attendance(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id),
  actor_id uuid references public.profiles(id),
  actor_name text not null,
  old_status public.attendance_status not null,
  new_status public.attendance_status not null,
  old_notes text,
  new_notes text,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.attendance_history enable row level security;
create policy "classroom correction history" on public.attendance_history for select
using (public.owns_classroom(classroom_id));
grant select on public.attendance_history to authenticated;
revoke insert, update, delete on public.attendance_history from anon, authenticated;
create index on public.attendance_history(attendance_id, created_at desc);

create or replace function public.audit_attendance_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare reason text := nullif(trim(current_setting('app.correction_reason', true)), '');
begin
  if row(new.student_id, new.classroom_id, new.teacher_id, new.attendance_date, new.scan_time)
    is distinct from row(old.student_id, old.classroom_id, old.teacher_id, old.attendance_date, old.scan_time) then
    raise exception 'Attendance identity and scan time cannot be changed';
  end if;
  if row(new.status, new.notes) is distinct from row(old.status, old.notes) then
    if reason is null then raise exception 'A correction reason is required'; end if;
    insert into public.attendance_history(attendance_id, classroom_id, actor_id, actor_name,
      old_status, new_status, old_notes, new_notes, reason)
    values (old.id, old.classroom_id, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'System'),
      old.status, new.status, old.notes, new.notes, reason);
  end if;
  return new;
end; $$;
create trigger audit_attendance_correction before update on public.attendance
for each row execute function public.audit_attendance_correction();

-- All attendance mutations go through authorized functions, with an audit reason.
revoke insert, update, delete on public.attendance from authenticated, anon;
revoke insert, update, delete on public.excuses from authenticated, anon;
create or replace function public.correct_attendance(
  p_attendance_id uuid, p_status public.attendance_status, p_reason text,
  p_expected_status public.attendance_status, p_excuse_notes text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare a public.attendance;
begin
  select * into a from public.attendance where id = p_attendance_id for update;
  if not found or not public.owns_classroom(a.classroom_id) then raise exception 'Attendance unavailable'; end if;
  if a.status is distinct from p_expected_status then raise exception 'Attendance changed. Reload before correcting it'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A correction reason is required'; end if;
  perform set_config('app.correction_reason', trim(p_reason), true);
  update public.attendance set status = p_status, notes = trim(p_reason) where id = a.id;
  if p_status = 'E' then
    insert into public.excuses(student_id, classroom_id, teacher_id, attendance_id, reason, notes)
    values(a.student_id, a.classroom_id, auth.uid(), a.id, trim(p_reason), p_excuse_notes)
    on conflict(attendance_id) do update set reason = excluded.reason, notes = excluded.notes;
  elsif a.status = 'E' then
    delete from public.excuses where attendance_id = a.id;
  end if;
end; $$;
revoke all on function public.correct_attendance(uuid, public.attendance_status, text, public.attendance_status, text) from public, anon;
grant execute on function public.correct_attendance(uuid, public.attendance_status, text, public.attendance_status, text) to authenticated;

-- Queue notifications in the same transaction as online OR offline attendance.
alter table public.notifications add column delivery_key text unique,
  add column processing_at timestamptz;
with first_notification as (
  select distinct on (attendance_id, channel) id, attendance_id, channel
  from public.notifications where attendance_id is not null
    and notification_type in ('ATTENDANCE_PRESENT', 'ATTENDANCE_LATE')
  order by attendance_id, channel, created_at, id
)
update public.notifications n set delivery_key = 'attendance:' || f.attendance_id || ':' || f.channel
from first_notification f where n.id = f.id;

create or replace function public.queue_attendance_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.students; c public.classrooms; message text;
begin
  if new.status not in ('P', 'L') or new.scan_time is null then return new; end if;
  select * into s from public.students where id = new.student_id;
  select * into c from public.classrooms where id = new.classroom_id;
  message := format('%s was recorded %s in %s on %s at %s (Asia/Manila).',
    s.full_name, case when new.status = 'L' then 'late' else 'present' end,
    c.subject, new.attendance_date, to_char(new.scan_time at time zone 'Asia/Manila', 'HH12:MI AM'));
  insert into public.notifications(student_id, classroom_id, teacher_id, attendance_id,
    parent_contact, notification_type, channel, message, delivery_key)
  select new.student_id, new.classroom_id, new.teacher_id, new.id, contacts.contact,
    case when new.status = 'L' then 'ATTENDANCE_LATE'::public.notification_type else 'ATTENDANCE_PRESENT'::public.notification_type end,
    contacts.channel, message, 'attendance:' || new.id || ':' || contacts.channel
  from (values (s.parent_email, 'email'::public.notification_channel), (s.parent_phone, 'sms'::public.notification_channel)) contacts(contact, channel)
  where nullif(trim(contacts.contact), '') is not null on conflict(delivery_key) do nothing;
  return new;
end; $$;
create trigger queue_attendance_notification after insert on public.attendance
for each row execute function public.queue_attendance_notification();

-- Status corrections must also keep pending warnings accurate.
create or replace function public.refresh_absence_warnings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'A' and new.status <> 'A' then
    update public.notifications set delivery_status = 'skipped', error_message = 'Absence count changed after a correction'
    where student_id = new.student_id and classroom_id = new.classroom_id
      and notification_type = 'THREE_ABSENCES_WARNING' and delivery_status in ('queued', 'failed')
      and processing_at is null
      and threshold_count > (select count(*) from public.attendance where student_id = new.student_id and classroom_id = new.classroom_id and status = 'A');
  end if;
  return new;
end; $$;
create trigger refresh_absence_warnings after update of status on public.attendance
for each row execute function public.refresh_absence_warnings();
create trigger correction_absence_warnings after update of status on public.attendance
for each row when (old.status is distinct from new.status and new.status = 'A')
execute function public.queue_absence_warnings();

create or replace function public.record_qr_attendance(p_classroom_id uuid, p_qr_token uuid, p_scanned_at timestamptz default now())
returns table(attendance_id uuid, student_id uuid, student_name text, status public.attendance_status, scan_time timestamptz, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_class public.classrooms; v_student public.students; v_existing public.attendance; v_status public.attendance_status; v_id uuid; v_local_time time;
begin
  select c.* into v_class from public.classrooms c where c.id = p_classroom_id and c.teacher_id = auth.uid() and c.status = 'active' for update;
  if not found then raise exception using errcode = '42501', message = 'Classroom unavailable'; end if;
  select s.* into v_student from public.students s join public.classroom_students cs on cs.student_id = s.id where s.qr_token = p_qr_token and s.status = 'active' and cs.classroom_id = p_classroom_id and cs.enrollment_status = 'active';
  if not found then raise exception using errcode = 'P0002', message = 'Student is not active in this classroom'; end if;
  select a.* into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  if found then return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true; return; end if;
  if p_scanned_at is null or p_scanned_at > now() + interval '5 minutes' then
    raise exception 'Invalid scan time';
  end if;
  if not public.is_class_day(p_classroom_id, (p_scanned_at at time zone 'Asia/Manila')::date) then
    raise exception 'This is not a scheduled class day. Check classroom teaching days';
  end if;
  if not exists(select 1 from public.classroom_students cs where cs.classroom_id = p_classroom_id
    and cs.student_id = v_student.id and cs.enrolled_at <= p_scanned_at) then
    raise exception 'Scan predates enrollment';
  end if;
  v_local_time := (p_scanned_at at time zone 'Asia/Manila')::time;
  if v_local_time < v_class.start_time then raise exception 'Class has not started'; end if;
  if v_local_time > v_class.attendance_cutoff then raise exception using errcode = '22023', message = 'Attendance cutoff has passed'; end if;
  v_status := case when v_local_time <= v_class.late_threshold then 'P'::public.attendance_status else 'L'::public.attendance_status end;
  insert into public.attendance(student_id, classroom_id, teacher_id, attendance_date, scan_time, status) values(v_student.id, p_classroom_id, auth.uid(), (p_scanned_at at time zone 'Asia/Manila')::date, p_scanned_at, v_status) returning id into v_id;
  insert into public.audit_logs(user_id, action, target_type, target_id, description) values(auth.uid(), 'ATTENDANCE_RECORDED', 'attendance', v_id::text, v_student.full_name || ' recorded as ' || v_status::text);
  return query select v_id, v_student.id, v_student.full_name, v_status, p_scanned_at, false;
exception when unique_violation then
  select a.* into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true;
end; $$;

grant execute on function public.record_qr_attendance(uuid, uuid, timestamptz) to authenticated;

create or replace function public.queue_absence_warnings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_threshold integer;
  v_subject text;
  v_count integer;
  v_student public.students;
begin
  if NEW.status <> 'A' then return NEW; end if;

  select c.absence_warning_threshold, c.subject into v_threshold, v_subject
  from public.classrooms c where c.id = NEW.classroom_id;

  select count(*) into v_count from public.attendance a
  where a.student_id = NEW.student_id and a.classroom_id = NEW.classroom_id and a.status = 'A';

  if v_count < v_threshold or v_count % v_threshold <> 0 then return NEW; end if;

  select s.* into v_student from public.students s where s.id = NEW.student_id;

  insert into public.notifications(student_id, classroom_id, teacher_id, attendance_id, parent_contact, notification_type, channel, message, delivery_status, threshold_count)
  select NEW.student_id, NEW.classroom_id, NEW.teacher_id, NEW.id, c.contact, 'THREE_ABSENCES_WARNING', c.channel,
    format('Warning: %s has been marked absent %s times in %s. Please contact the school if this is unexpected.', v_student.full_name, v_count, v_subject),
    'queued', v_count
  from (values
    (v_student.parent_email, 'email'::public.notification_channel),
    (v_student.parent_phone, 'sms'::public.notification_channel)
  ) as c(contact, channel)
  where c.contact is not null
  on conflict (student_id, classroom_id, notification_type, threshold_count, channel)
    where notification_type = 'THREE_ABSENCES_WARNING'
  do update set delivery_status = 'queued', attendance_id = excluded.attendance_id,
    message = excluded.message, parent_contact = excluded.parent_contact, error_message = null
  where public.notifications.delivery_status = 'skipped' and public.notifications.processing_at is null;

  return NEW;
end; $$;


commit;
