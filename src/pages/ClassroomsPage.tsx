import { useState, type FormEvent } from 'react'
import { BookOpen, Clock3, MapPin, Pencil, Plus, Users } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Field, Modal } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/feedback'
import type { Classroom } from '../types/database'

export default function ClassroomsPage() {
  const { profile } = useAuth()
  const { classrooms, selected, select, refresh } = useClassroom()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Classroom | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    const form = new FormData(e.currentTarget)
    const f = Object.fromEntries(form)
    if (f.late_threshold < f.start_time) {
      setSaving(false)
      toast.error('"Late after" must be at or after the class start time.')
      return
    }
    if (f.attendance_cutoff < f.late_threshold) {
      setSaving(false)
      toast.error('"Attendance cutoff" must be at or after the "Late after" time.')
      return
    }
    const teaching_days = form.getAll('teaching_days').map(Number)
    const no_class_dates = String(f.no_class_dates || '').split(/[\s,]+/).filter(Boolean)
    if (!teaching_days.length || no_class_dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      setSaving(false)
      toast.error('Select teaching days and enter valid holiday/cancellation dates as YYYY-MM-DD.')
      return
    }
    const payload = { ...f, teaching_days, no_class_dates: [...new Set(no_class_dates)], absence_warning_threshold: Number(f.absence_warning_threshold) }
    const { error } = editing
      ? await supabase.from('classrooms').update(payload).eq('id', editing.id)
      : await supabase.from('classrooms').insert({ ...payload, teacher_id: profile?.id })
    setSaving(false)
    if (!error) { setOpen(false); setEditing(null); toast.success(editing ? 'Classroom updated.' : 'Classroom created.'); await refresh() }
    else toast.error(error.message)
  }

  const openCreate = () => { setEditing(null); setOpen(true) }
  const openEdit = (c: Classroom) => { setEditing(c); setOpen(true) }
  const close = () => { setOpen(false); setEditing(null) }

  return (
    <div className="page">
      <PageHeader
        eyebrow="CLASSROOM MANAGEMENT"
        title="My classrooms"
        description="Keep schedules, attendance rules, and student records separate for every class."
        actions={<button className="btn primary" onClick={openCreate}><Plus size={17} />Add classroom</button>}
      />
      {classrooms.length ? (
        <div className="classroom-grid">
          {classrooms.map(c => (
            <Card key={c.id} className={`classroom-card ${selected?.id === c.id ? 'selected' : ''}`}>
              <div className="classroom-card-top">
                <div className="subject-icon"><BookOpen /></div>
                <span className="badge status-active">{c.status}</span>
              </div>
              <span className="eyebrow">{c.school_year} · {c.semester}</span>
              <h2>{c.subject} · {c.classroom_name}</h2>
              <p>{c.grade_level} {c.section}</p>
              <div className="class-details">
                <span><MapPin size={15} />{c.room_number || 'Room not set'}</span>
                <span><Clock3 size={15} />{c.schedule || 'Schedule not set'}</span>
                <span><Users size={15} />Late after {c.late_threshold.slice(0, 5)} · cutoff {c.attendance_cutoff.slice(0, 5)}</span>
              </div>
              <div className="card-actions">
                <button className="btn secondary" onClick={() => openEdit(c)}><Pencil size={15} />Edit</button>
                <button className="btn secondary" onClick={() => select(c.id)}>{selected?.id === c.id ? 'Current classroom' : 'Open classroom'}</button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No classrooms yet" description="Create a classroom to begin enrolling students and taking attendance." />
      )}
      {open && (
        <Modal title={editing ? 'Edit classroom' : 'Create classroom'} onClose={close}>
          <form className="form-grid" onSubmit={submit} key={editing?.id ?? 'new'}>
            <Field label="Classroom name"><input name="classroom_name" required placeholder="IT415 – Application Development" defaultValue={editing?.classroom_name} /></Field>
            <Field label="Subject"><input name="subject" required placeholder="IT415" defaultValue={editing?.subject} /></Field>
            <Field label="Grade / year level"><input name="grade_level" required placeholder="BSIT 4" defaultValue={editing?.grade_level} /></Field>
            <Field label="Section"><input name="section" required placeholder="BSIT4D" defaultValue={editing?.section} /></Field>
            <Field label="Room number"><input name="room_number" placeholder="Computer Laboratory 2" defaultValue={editing?.room_number ?? ''} /></Field>
            <Field label="School year"><input name="school_year" required placeholder="2026–2027" defaultValue={editing?.school_year} /></Field>
            <Field label="Semester">
              <select name="semester" required defaultValue={editing?.semester ?? 'First Semester'}>
                <option>First Semester</option>
                <option>Second Semester</option>
                <option>Summer</option>
              </select>
            </Field>
            <Field label="Schedule"><input name="schedule" placeholder="Monday & Wednesday" defaultValue={editing?.schedule ?? ''} /></Field>
            <fieldset className="teaching-days"><legend>Teaching days (Manila time)</legend>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => <label key={day}><input type="checkbox" name="teaching_days" value={i} defaultChecked={editing?.teaching_days?.includes(i) ?? false} />{day}</label>)}
            </fieldset>
            <Field label="Holidays / cancelled class dates"><textarea name="no_class_dates" placeholder="YYYY-MM-DD, one per line" rows={3} defaultValue={editing?.no_class_dates?.join('\n') || ''} /></Field>
            <Field label="Class starts"><input name="start_time" type="time" required defaultValue={editing?.start_time} /></Field>
            <Field label="Late after"><input name="late_threshold" type="time" required defaultValue={editing?.late_threshold} /></Field>
            <Field label="Attendance cutoff"><input name="attendance_cutoff" type="time" required defaultValue={editing?.attendance_cutoff} /></Field>
            <Field label="Absence warning"><input name="absence_warning_threshold" type="number" min="1" required defaultValue={editing?.absence_warning_threshold ?? 3} /></Field>
            <Field label="Status">
              <select name="status" required defaultValue={editing?.status ?? 'active'}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Description"><textarea name="description" rows={3} defaultValue={editing?.description ?? ''} /></Field>
            <div className="form-actions">
              <button type="button" className="btn secondary" onClick={close}>Cancel</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create classroom'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
