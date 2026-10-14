create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('teacher', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.record_status as enum ('active', 'inactive'); exception when duplicate_object then null; end $$;
do $$ begin create type public.enrollment_status as enum ('active', 'removed', 'transferred'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attendance_status as enum ('P', 'L', 'A', 'E'); exception when duplicate_object then null; end $$;
do $$ begin create type public.delivery_status as enum ('queued', 'sent', 'failed', 'skipped'); exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_channel as enum ('email', 'sms'); exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_type as enum ('ATTENDANCE_PRESENT', 'ATTENDANCE_LATE', 'THREE_ABSENCES_WARNING', 'GENERAL_NOTIFICATION'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) >= 2),
  email text not null,
  role public.app_role not null default 'teacher',
  profile_photo_url text,
  teacher_id text,
  department text,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  classroom_name text not null,
  subject text not null,
  grade_level text not null,
  section text not null,
  room_number text,
  school_year text not null,
  semester text not null,
  schedule text,
  start_time time not null,
  late_threshold time not null,
  attendance_cutoff time not null,
  absence_warning_threshold integer not null default 3 check (absence_warning_threshold > 0),
  description text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time <= late_threshold and late_threshold <= attendance_cutoff)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  full_name text generated always as (trim(first_name || ' ' || coalesce(middle_name || ' ', '') || last_name)) stored,
  grade_level text not null,
  section text not null,
  parent_name text not null,
  parent_phone text,
  parent_email text check (parent_email is null or parent_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  address text,
  emergency_contact text,
  qr_token uuid not null default gen_random_uuid() unique,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_phone is not null or parent_email is not null)
);

create table if not exists public.classroom_students (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  enrollment_status public.enrollment_status not null default 'active',
  enrolled_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (classroom_id, student_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  attendance_date date not null default current_date,
  scan_time timestamptz,
  status public.attendance_status not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, classroom_id, attendance_date)
);

create table if not exists public.excuses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  classroom_id uuid not null references public.classrooms(id),
  teacher_id uuid not null references public.profiles(id),
  attendance_id uuid not null unique references public.attendance(id) on delete cascade,
  reason text not null check (length(trim(reason)) > 0),
  notes text,
  document_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  classroom_id uuid not null references public.classrooms(id),
  teacher_id uuid not null references public.profiles(id),
  attendance_id uuid references public.attendance(id) on delete set null,
  parent_contact text,
  notification_type public.notification_type not null,
  channel public.notification_channel not null,
  message text not null,
  delivery_status public.delivery_status not null default 'queued',
  sent_at timestamptz,
  error_message text,
  threshold_count integer,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_warning_once on public.notifications(student_id, classroom_id, notification_type, threshold_count, channel) where notification_type = 'THREE_ABSENCES_WARNING';

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists attendance_classroom_date_idx on public.attendance(classroom_id, attendance_date);
create index if not exists attendance_student_classroom_idx on public.attendance(student_id, classroom_id);
create index if not exists classroom_students_classroom_idx on public.classroom_students(classroom_id) where enrollment_status = 'active';
create index if not exists notifications_teacher_idx on public.notifications(teacher_id, created_at desc);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create or replace function public.owns_classroom(classroom uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.classrooms where id = classroom and teacher_id = auth.uid()) or public.is_admin();
$$;

alter table public.profiles enable row level security;
alter table public.classrooms enable row level security;
alter table public.students enable row level security;
alter table public.classroom_students enable row level security;
alter table public.attendance enable row level security;
alter table public.excuses enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles own read" on public.profiles;
create policy "profiles own read" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "teachers own classrooms" on public.classrooms;
create policy "teachers own classrooms" on public.classrooms for all using (teacher_id = auth.uid() or public.is_admin()) with check (teacher_id = auth.uid() or public.is_admin());
drop policy if exists "teachers see enrolled students" on public.students;
create policy "teachers see enrolled students" on public.students for select using (public.is_admin() or exists(select 1 from public.classroom_students cs join public.classrooms c on c.id = cs.classroom_id where cs.student_id = students.id and c.teacher_id = auth.uid()));
drop policy if exists "teachers create students" on public.students;
create policy "teachers create students" on public.students for insert with check (auth.uid() is not null);
drop policy if exists "teachers update enrolled students" on public.students;
create policy "teachers update enrolled students" on public.students for update using (public.is_admin() or exists(select 1 from public.classroom_students cs join public.classrooms c on c.id = cs.classroom_id where cs.student_id = students.id and c.teacher_id = auth.uid()));
drop policy if exists "classroom enrollment access" on public.classroom_students;
create policy "classroom enrollment access" on public.classroom_students for all using (public.owns_classroom(classroom_id)) with check (public.owns_classroom(classroom_id));
drop policy if exists "attendance classroom access" on public.attendance;
create policy "attendance classroom access" on public.attendance for all using (public.owns_classroom(classroom_id)) with check (public.owns_classroom(classroom_id) and teacher_id = auth.uid());
drop policy if exists "excuses classroom access" on public.excuses;
create policy "excuses classroom access" on public.excuses for all using (public.owns_classroom(classroom_id)) with check (public.owns_classroom(classroom_id) and teacher_id = auth.uid());
drop policy if exists "notifications classroom access" on public.notifications;
create policy "notifications classroom access" on public.notifications for select using (public.owns_classroom(classroom_id));
drop policy if exists "audit own read" on public.audit_logs;
create policy "audit own read" on public.audit_logs for select using (user_id = auth.uid() or public.is_admin());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, email) values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email);
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_updated on public.profiles;
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists classrooms_updated on public.classrooms;
create trigger classrooms_updated before update on public.classrooms for each row execute function public.set_updated_at();
drop trigger if exists students_updated on public.students;
create trigger students_updated before update on public.students for each row execute function public.set_updated_at();
drop trigger if exists attendance_updated on public.attendance;
create trigger attendance_updated before update on public.attendance for each row execute function public.set_updated_at();

create or replace function public.record_qr_attendance(p_classroom_id uuid, p_qr_token uuid, p_scanned_at timestamptz default now())
returns table(attendance_id uuid, student_id uuid, student_name text, status public.attendance_status, scan_time timestamptz, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_class public.classrooms; v_student public.students; v_existing public.attendance; v_status public.attendance_status; v_id uuid; v_local_time time;
begin
  select * into v_class from public.classrooms where id = p_classroom_id and teacher_id = auth.uid() and status = 'active';
  if not found then raise exception using errcode = '42501', message = 'Classroom unavailable'; end if;
  select s.* into v_student from public.students s join public.classroom_students cs on cs.student_id = s.id where s.qr_token = p_qr_token and s.status = 'active' and cs.classroom_id = p_classroom_id and cs.enrollment_status = 'active';
  if not found then raise exception using errcode = 'P0002', message = 'Student is not active in this classroom'; end if;
  select * into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  if found then return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true; return; end if;
  v_local_time := (p_scanned_at at time zone 'Asia/Manila')::time;
  if v_local_time > v_class.attendance_cutoff then raise exception using errcode = '22023', message = 'Attendance cutoff has passed'; end if;
  v_status := case when v_local_time <= v_class.late_threshold then 'P'::public.attendance_status else 'L'::public.attendance_status end;
  insert into public.attendance(student_id, classroom_id, teacher_id, attendance_date, scan_time, status) values(v_student.id, p_classroom_id, auth.uid(), (p_scanned_at at time zone 'Asia/Manila')::date, p_scanned_at, v_status) returning id into v_id;
  insert into public.audit_logs(user_id, action, target_type, target_id, description) values(auth.uid(), 'ATTENDANCE_RECORDED', 'attendance', v_id::text, v_student.full_name || ' recorded as ' || v_status::text);
  return query select v_id, v_student.id, v_student.full_name, v_status, p_scanned_at, false;
exception when unique_violation then
  select * into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true;
end; $$;

grant execute on function public.record_qr_attendance(uuid, uuid, timestamptz) to authenticated;

create or replace function public.mark_classroom_absences(p_classroom_id uuid, p_date date default current_date) returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  if not public.owns_classroom(p_classroom_id) then raise exception using errcode = '42501', message = 'Unauthorized'; end if;
  insert into public.attendance(student_id, classroom_id, teacher_id, attendance_date, status)
  select cs.student_id, c.id, c.teacher_id, p_date, 'A'::public.attendance_status from public.classrooms c join public.classroom_students cs on cs.classroom_id = c.id
  where c.id = p_classroom_id and cs.enrollment_status = 'active' and localtime >= c.attendance_cutoff
  on conflict(student_id, classroom_id, attendance_date) do nothing;
  get diagnostics inserted_count = row_count; return inserted_count;
end; $$;
grant execute on function public.mark_classroom_absences(uuid, date) to authenticated;

create or replace function public.regenerate_student_qr(p_student_id uuid, p_classroom_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  if not public.owns_classroom(p_classroom_id) or not exists(select 1 from public.classroom_students where classroom_id = p_classroom_id and student_id = p_student_id) then raise exception using errcode = '42501', message = 'Unauthorized'; end if;
  update public.students set qr_token = token where id = p_student_id;
  insert into public.audit_logs(user_id, action, target_type, target_id, description) values(auth.uid(), 'QR_REGENERATED', 'student', p_student_id::text, 'Student QR token regenerated');
  return token;
end; $$;
grant execute on function public.regenerate_student_qr(uuid, uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.attendance; exception when duplicate_object then null; end $$;
