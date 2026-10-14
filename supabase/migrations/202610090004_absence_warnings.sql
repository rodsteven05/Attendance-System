-- Queue THREE_ABSENCES_WARNING notifications when a student's absences in a
-- classroom reach (or repeat at multiples of) the classroom's
-- absence_warning_threshold. Delivery is handled by the send-notification
-- edge function, invoked by the client after marking absences.

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
  on conflict do nothing;

  return NEW;
end; $$;

drop trigger if exists absence_warnings on public.attendance;
create trigger absence_warnings after insert on public.attendance
for each row execute function public.queue_absence_warnings();
