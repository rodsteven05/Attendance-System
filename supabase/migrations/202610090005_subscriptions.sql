-- Subscription gating for self-serve teacher accounts.
-- New signups start 'pending'; an admin flips them to 'active' (optionally
-- with an expiry date) after payment is collected manually.

alter table public.profiles
  add column if not exists subscription_status text not null default 'pending'
    check (subscription_status in ('pending', 'active', 'expired')),
  add column if not exists subscription_expires_at date;

-- Grandfather any existing users so they are not locked out
update public.profiles set subscription_status = 'active' where subscription_status = 'pending';

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'admin'
           or (subscription_status = 'active'
               and (subscription_expires_at is null or subscription_expires_at >= current_date)))
  );
$$;

-- Let admins update other profiles (activate / deactivate customers)
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles" on public.profiles
  for update using (public.is_admin());

-- Gate the core write paths on an active subscription
drop policy if exists "teachers own classrooms" on public.classrooms;
create policy "teachers own classrooms" on public.classrooms
  for all using ((teacher_id = auth.uid() or public.is_admin()) and public.is_active())
  with check ((teacher_id = auth.uid() or public.is_admin()) and public.is_active());

drop policy if exists "teachers create students" on public.students;
create policy "teachers create students" on public.students
  for insert with check (public.is_active());

drop policy if exists "teachers update enrolled students" on public.students;
create policy "teachers update enrolled students" on public.students
  for update using (public.is_active() or public.is_admin());

drop policy if exists "attendance classroom access" on public.attendance;
create policy "attendance classroom access" on public.attendance
  for all using (public.owns_classroom(classroom_id) and public.is_active())
  with check (public.owns_classroom(classroom_id) and public.is_active());

-- Block QR scans for inactive accounts inside the security-definer function
create or replace function public.record_qr_attendance(p_classroom_id uuid, p_qr_token uuid, p_scanned_at timestamptz default now())
returns table(attendance_id uuid, student_id uuid, student_name text, status public.attendance_status, scan_time timestamptz, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_class public.classrooms; v_student public.students; v_existing public.attendance; v_status public.attendance_status; v_id uuid; v_local_time time;
begin
  if not public.is_active() then raise exception using errcode = '42501', message = 'Subscription is not active'; end if;
  select c.* into v_class from public.classrooms c where c.id = p_classroom_id and c.teacher_id = auth.uid() and c.status = 'active';
  if not found then raise exception using errcode = '42501', message = 'Classroom unavailable'; end if;
  select s.* into v_student from public.students s join public.classroom_students cs on cs.student_id = s.id where s.qr_token = p_qr_token and s.status = 'active' and cs.classroom_id = p_classroom_id and cs.enrollment_status = 'active';
  if not found then raise exception using errcode = 'P0002', message = 'Student is not active in this classroom'; end if;
  select a.* into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  if found then return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true; return; end if;
  v_local_time := (p_scanned_at at time zone 'Asia/Manila')::time;
  if v_local_time > v_class.attendance_cutoff then raise exception using errcode = '22023', message = 'Attendance cutoff has passed'; end if;
  v_status := case when v_local_time <= v_class.late_threshold then 'P'::public.attendance_status else 'L'::public.attendance_status end;
  insert into public.attendance(student_id, classroom_id, teacher_id, attendance_date, scan_time, status) values(v_student.id, p_classroom_id, auth.uid(), (p_scanned_at at time zone 'Asia/Manila')::date, p_scanned_at, v_status) returning id into v_id;
  insert into public.audit_logs(user_id, action, target_type, target_id, description) values(auth.uid(), 'ATTENDANCE_RECORDED', 'attendance', v_id::text, v_student.full_name || ' recorded as ' || v_status::text);
  return query select v_id, v_student.id, v_student.full_name, v_status, p_scanned_at, false;
exception when unique_violation then
  select a.* into v_existing from public.attendance a where a.student_id = v_student.id and a.classroom_id = p_classroom_id and a.attendance_date = (p_scanned_at at time zone 'Asia/Manila')::date;
  return query select v_existing.id, v_student.id, v_student.full_name, v_existing.status, v_existing.scan_time, true;
end; $$;
