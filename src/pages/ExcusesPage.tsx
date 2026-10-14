import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ClipboardList, FileCheck } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Field, Modal, Spinner, StatusBadge } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/feedback'
import { formatDate, formatTime } from '../lib/utils'
import type { Attendance, Excuse } from '../types/database'

export default function ExcusesPage() {
  const { session } = useAuth()
  const { selected } = useClassroom()
  const [records, setRecords] = useState<Attendance[]>([])
  const [excuses, setExcuses] = useState<Excuse[]>([])
  const [loading, setLoading] = useState(true)
  const [filing, setFiling] = useState<Attendance | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!selected) { setRecords([]); setExcuses([]); setLoading(false); return }
    setLoading(true)
    const [{ data: a }, { data: e }] = await Promise.all([
      supabase.from('attendance').select('*,student:students(*)').eq('classroom_id', selected.id).in('status', ['A', 'E']).order('attendance_date', { ascending: false }).limit(200),
      supabase.from('excuses').select('*,student:students(*)').eq('classroom_id', selected.id).order('created_at', { ascending: false }),
    ])
    setRecords((a || []) as unknown as Attendance[])
    setExcuses((e || []) as unknown as Excuse[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const excusedIds = useMemo(() => new Set(excuses.map(e => e.attendance_id)), [excuses])
  const pending = records.filter(r => r.status === 'A' && !excusedIds.has(r.id))

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!filing || !selected || !session) return
    setSaving(true)
    const f = Object.fromEntries(new FormData(e.currentTarget))
    const { error } = await supabase.rpc('correct_attendance', {
      p_attendance_id: filing.id,
      p_status: 'E',
      p_reason: String(f.reason),
      p_expected_status: filing.status,
      p_excuse_notes: f.notes ? String(f.notes) : null,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Excuse filed.')
    setFiling(null)
    await load()
  }

  if (loading) return <Spinner />
  return (
    <div className="page">
      <PageHeader eyebrow="ATTENDANCE EXCEPTIONS" title="Excuses" description="File supporting reasons for absences and review approved exceptions." />
      {!selected ? <EmptyState title="No classroom selected" description="Choose a classroom to review excuses." /> : (
        <div className="dashboard-grid">
          <Card className="chart-card">
            <div className="card-heading"><div><span className="eyebrow">ACTION NEEDED</span><h2>Absences without an excuse ({pending.length})</h2></div><ClipboardList /></div>
            {!pending.length ? <p className="muted">Every recorded absence has an excuse on file.</p> : (
              <div className="table-wrap"><table><thead><tr><th>Student</th><th>Date</th><th>Status</th><th /></tr></thead>
                <tbody>{pending.map(r => <tr key={r.id}><td><strong>{r.student?.full_name}</strong><span>{r.student?.student_number}</span></td><td>{formatDate(r.attendance_date)}</td><td><StatusBadge status={r.status} /></td><td><button className="btn secondary" onClick={() => setFiling(r)}><FileCheck size={15} />File excuse</button></td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
          <Card className="chart-card">
            <div className="card-heading"><div><span className="eyebrow">ON FILE</span><h2>Filed excuses ({excuses.length})</h2></div></div>
            {!excuses.length ? <p className="muted">No excuses filed yet.</p> : (
              <div className="table-wrap"><table><thead><tr><th>Student</th><th>Reason</th><th>Filed</th></tr></thead>
                <tbody>{excuses.map(x => <tr key={x.id}><td><strong>{x.student?.full_name}</strong></td><td>{x.reason}{x.notes ? <span> — {x.notes}</span> : null}</td><td>{formatTime(x.created_at)}</td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
      {filing && (
        <Modal title={`Excuse — ${filing.student?.full_name}`} onClose={() => setFiling(null)}>
          <form className="form-grid" onSubmit={submit}>
            <Field label="Reason"><input name="reason" required placeholder="e.g. Medical appointment, family emergency" /></Field>
            <Field label="Notes (optional)"><textarea name="notes" rows={3} /></Field>
            <div className="form-actions">
              <button type="button" className="btn secondary" onClick={() => setFiling(null)}>Cancel</button>
              <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'File excuse'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
