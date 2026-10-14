-- Allow teachers to select students they created before enrollment exists.
-- INSERT ... RETURNING evaluates SELECT policies, so the creator must be
-- visible immediately or the insert fails under RLS.

alter table public.students
  add column if not exists created_by uuid references public.profiles(id);

create index if not exists students_created_by_idx on public.students(created_by);

drop policy if exists "teachers see enrolled students" on public.students;
drop policy if exists "teachers see enrolled or created students" on public.students;
create policy "teachers see enrolled or created students"
on public.students
for select
using (
  public.is_admin()
  or created_by = auth.uid()
  or exists (
    select 1
    from public.classroom_students cs
    join public.classrooms c on c.id = cs.classroom_id
    where cs.student_id = students.id
      and c.teacher_id = auth.uid()
  )
);
