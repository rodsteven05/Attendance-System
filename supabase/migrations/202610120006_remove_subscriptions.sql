-- Remove subscription gating while preserving classroom ownership.
-- Apply after all earlier migrations on existing and new installations.
begin;
drop policy if exists "teachers own classrooms" on public.classrooms;
create policy "teachers own classrooms" on public.classrooms
for all using (teacher_id = auth.uid() or public.is_admin())
with check (teacher_id = auth.uid() or public.is_admin());
drop policy if exists "teachers create students" on public.students;
create policy "teachers create students" on public.students
for insert with check (auth.uid() is not null);
drop policy if exists "teachers update enrolled students" on public.students;
create policy "teachers update enrolled students" on public.students
for update using (public.is_admin() or created_by = auth.uid() or exists (
select 1 from public.classroom_students cs join public.classrooms c on c.id = cs.classroom_id
where cs.student_id = students.id and c.teacher_id = auth.uid()));
drop policy if exists "attendance classroom access" on public.attendance;
create policy "attendance classroom access" on public.attendance
for all using (public.owns_classroom(classroom_id))
with check (public.owns_classroom(classroom_id) and teacher_id = auth.uid());
drop policy if exists "admins update profiles" on public.profiles;

create or replace function public.record_qr_attendance(p_classroom_id uuid, p_qr_token uuid, p_scanned_at timestamptz default now())
returns table(attendance_id uuid, student_id uuid, student_name text, status public.attendance_status, scan_time timestamptz, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare v_class public.classrooms; v_student public.students; v_existing public.attendance; v_status public.attendance_status; v_id uuid; v_local_time time;
begin
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

grant execute on function public.record_qr_attendance(uuid, uuid, timestamptz) to authenticated;

drop function if exists public.is_active();
alter table public.profiles drop column if exists subscription_status,
drop column if exists subscription_expires_at;
commit;
