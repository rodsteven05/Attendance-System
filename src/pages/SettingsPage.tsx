import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Field } from '../components/UI'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/feedback'

export default function SettingsPage() {
  const { selected, refresh } = useClassroom()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selected) return
    const f = Object.fromEntries(new FormData(e.currentTarget))
    if (f.late_threshold < f.start_time) { toast.error('"Late after" must be at or after the class start time.'); return }
    if (f.attendance_cutoff < f.late_threshold) { toast.error('"Attendance cutoff" must be at or after the "Late after" time.'); return }
    setSaving(true)
    const { error } = await supabase.from('classrooms').update({ ...f, absence_warning_threshold: Number(f.absence_warning_threshold) }).eq('id', selected.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Settings saved.')
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    await refresh()
  }

  return (
    <div className="page">
      <PageHeader eyebrow="CONFIGURATION" title="Classroom settings" description="Attendance rules and details for the selected classroom." />
      {!selected ? <EmptyState title="No classroom selected" description="Choose a classroom to edit its settings." /> : (
        <Card className="settings-card">
          <div className="card-heading"><div><span className="eyebrow">{selected.classroom_name}</span><h2>{selected.subject} · {selected.grade_level} {selected.section}</h2></div></div>
          <form className="form-grid" onSubmit={submit} key={selected.id}>
            <Field label="Schedule"><input name="schedule" placeholder="Monday & Wednesday" defaultValue={selected.schedule ?? ''} /></Field>
            <Field label="Room number"><input name="room_number" defaultValue={selected.room_number ?? ''} /></Field>
            <Field label="Class starts"><input name="start_time" type="time" required defaultValue={selected.start_time} /></Field>
            <Field label="Late after"><input name="late_threshold" type="time" required defaultValue={selected.late_threshold} /></Field>
            <Field label="Attendance cutoff"><input name="attendance_cutoff" type="time" required defaultValue={selected.attendance_cutoff} /></Field>
            <Field label="Absence warning threshold"><input name="absence_warning_threshold" type="number" min="1" required defaultValue={selected.absence_warning_threshold} /></Field>
            <Field label="Status">
              <select name="status" required defaultValue={selected.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Description"><textarea name="description" rows={3} defaultValue={selected.description ?? ''} /></Field>
            <div className="form-actions">
              {saved && <span className="muted">Settings saved.</span>}
              <button className="btn primary" disabled={saving}><Save size={17} />{saving ? 'Saving…' : 'Save settings'}</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  )
}
