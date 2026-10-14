import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, Modal, Spinner, StatusBadge } from '../components/UI'
import { SyncStatus } from '../components/SyncStatus'
import { useClassroom } from '../contexts/ClassroomContext'
import { useAttendanceSync } from '../contexts/AttendanceSyncContext'
import { supabase } from '../lib/supabase'
import { promptDialog, toast } from '../lib/feedback'
import { formatDate, formatTime, statusLabels, todayISO } from '../lib/utils'
import { allRows } from '../lib/query'
import { enrolledOn, finalizationProblem, schoolDate, type Enrollment } from '../lib/attendance'
import type { Attendance, AttendanceStatus, Classroom } from '../types/database'

interface History { id: number; actor_name: string; old_status: AttendanceStatus; new_status: AttendanceStatus; old_notes: string | null; new_notes: string | null; reason: string; created_at: string }
export default function AttendancePage() {
  const { selected } = useClassroom()
  if (!selected) return <div className="page"><EmptyState title="Select a classroom" description="Choose a classroom to review attendance." /></div>
  return <AttendanceWorkspace key={selected.id} classroom={selected} />
}
function AttendanceWorkspace({ classroom }: { classroom: Classroom }) {
  const [date, setDate] = useState(todayISO)
  const [filter, setFilter] = useState('all')
  const [rows, setRows] = useState<Attendance[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [historyFor, setHistoryFor] = useState<Attendance | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const { queue, legacyQueue, error: syncError } = useAttendanceSync()
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    try {
      const [records, roster] = await Promise.all([
        allRows<Attendance>((from, to) => supabase.from('attendance').select('*,student:students(*)').eq('classroom_id', classroom.id).eq('attendance_date', date).order('id').range(from, to)),
        allRows<Enrollment>((from, to) => supabase.from('classroom_students').select('*,student:students(*)').eq('classroom_id', classroom.id).order('id').range(from, to)),
      ])
      if (request !== generation.current) return
      setRows(records); setEnrollments(roster); setError(null)
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not load attendance.') }
    finally { if (request === generation.current) setLoading(false) }
  }, [classroom.id, date])
  useEffect(() => {
    void load()
    const refresh = () => void load()
    window.addEventListener('attendance-synced', refresh)
    const channel = supabase.channel(`attendance-view-${classroom.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `classroom_id=eq.${classroom.id}` }, refresh).subscribe()
    return () => { generation.current++; window.removeEventListener('attendance-synced', refresh); void supabase.removeChannel(channel) }
  }, [classroom.id, load])

  const roster = new Map(enrollments.filter(e => e.student?.status === 'active' && enrolledOn(e, date)).map(e => [e.student_id, e.student]))
  rows.forEach(row => { if (row.student) roster.set(row.student_id, row.student) })
  const students = [...roster.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
  const byStudent = new Map(rows.map(row => [row.student_id, row]))
  const unrecorded = students.filter(s => !byStudent.has(s.id)).length
  const pending = queue.filter(q => q.classroomId === classroom.id && schoolDate(q.scannedAt) === date && !q.attendanceId).length
  const blocked = syncError || (legacyQueue ? 'Review older unassigned offline scans before finalizing.' : finalizationProblem(classroom, date, pending))
  const correct = async (row: Attendance, next: AttendanceStatus) => {
    if (next === row.status) return
    const reason = await promptDialog({ title: `Change ${row.student?.full_name || 'attendance'} to ${statusLabels[next]}`, label: 'This reason will be saved in correction history.', placeholder: 'Reason for correction', required: true })
    if (!reason?.trim()) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('correct_attendance', { p_attendance_id: row.id, p_status: next, p_reason: reason, p_expected_status: row.status })
      if (error) throw new Error(error.message)
      toast.success('Attendance corrected. Change recorded in history.')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Correction failed. Please retry.') }
    finally { setSaving(false) }
  }
  const finalize = async () => {
    if (blocked || saving) return
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('mark_classroom_absences', { p_classroom_id: classroom.id, p_date: date })
      if (error) throw new Error(error.message)
      toast.success(`${data} unrecorded student(s) marked absent.`)
      const { data: delivery, error: deliveryError } = await supabase.functions.invoke('send-notification', { body: { classroom_id: classroom.id } })
      if (deliveryError || delivery?.failed || delivery?.processing) toast.info('Attendance saved. Some parent messages are pending; review Notifications.')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not finalize attendance.') }
    finally { setSaving(false) }
  }
  useEffect(() => {
    if (!historyFor) return
    let cancelled = false
    setHistoryLoading(true); setHistoryError(null)
    allRows<History>((from, to) => supabase.from('attendance_history').select('*').eq('attendance_id', historyFor.id).order('id', { ascending: false }).range(from, to))
      .then(data => { if (!cancelled) setHistory(data) })
      .catch(e => { if (!cancelled) setHistoryError(e.message) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [historyFor])

  return <div className="page">
    <PageHeader eyebrow="CLASS RECORD" title={date === todayISO() ? 'Today’s class' : 'Attendance'} description={`${classroom.classroom_name} · All times are in Asia/Manila.`}
      actions={<button className="btn primary" disabled={!!blocked || saving || loading || !!error || !unrecorded} onClick={() => void finalize()}>{saving ? 'Saving…' : 'Finalize attendance'}</button>} />
    <SyncStatus />
    <p>{blocked || `Finalizing marks ${unrecorded} unrecorded student(s) absent. Records already saved stay as recorded. Sync scans on all other devices first.`}</p>
    <div className="toolbar">
      <label className="search"><CalendarDays size={18} /><input aria-label="Attendance date" type="date" value={date} max={todayISO()} disabled={saving} onChange={e => { if (e.target.value) setDate(e.target.value) }} /></label>
      <select aria-label="Filter attendance" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">All students</option><option value="unrecorded">Not recorded</option>
        {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <button className="btn secondary" disabled={loading} onClick={() => void load()}>Refresh</button>
    </div>
    {loading ? <Spinner /> : error ? <p role="alert" className="text-red">{error}</p> : <>
      <div className="stats-grid">{[
        ['Expected students', students.length], ['Present', rows.filter(r => r.status === 'P').length],
        ['Late', rows.filter(r => r.status === 'L').length], ['Absent', rows.filter(r => r.status === 'A').length],
        ['Excused', rows.filter(r => r.status === 'E').length], ['Not recorded', unrecorded], ['Pending offline scans', pending],
      ].map(([label, value]) => <Card key={label} className="stat-card"><div><span>{label}</span><strong>{value}</strong></div></Card>)}</div>
      {!students.length ? <EmptyState title="No students for this date" description="Enroll students in this classroom to begin attendance." /> : <div className="table-card"><div className="table-wrap"><table>
        <thead><tr><th>Student</th><th>Time</th><th>Status</th><th>Notes</th><th>Correct status</th><th>History</th></tr></thead>
        <tbody>{students.filter(s => filter === 'all' || (byStudent.get(s.id)?.status || 'unrecorded') === filter).map(student => {
          const row = byStudent.get(student.id)
          return <tr key={student.id}><td><strong>{student.full_name}</strong><span>{student.student_number}</span></td>
            <td>{formatTime(row?.scan_time)}</td><td>{row ? <StatusBadge status={row.status} /> : <span className="badge">Not recorded</span>}</td><td>{row?.notes || '—'}</td>
            <td>{row ? <select aria-label={`Correct status for ${student.full_name}`} disabled={saving} value={row.status} onChange={e => void correct(row, e.target.value as AttendanceStatus)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : '—'}</td>
            <td>{row && <button className="btn secondary" onClick={() => setHistoryFor(row)}>View history</button>}</td></tr>
        })}</tbody>
      </table></div></div>}
    </>}
    {historyFor && <Modal title={`Correction history — ${historyFor.student?.full_name || 'Student'}`} onClose={() => setHistoryFor(null)}>
      {historyLoading ? <Spinner /> : historyError ? <p role="alert">{historyError}</p> : !history.length ? <p>No corrections recorded.</p> : <ol className="correction-history">{history.map(h => <li key={h.id}>
        <strong>{statusLabels[h.old_status]} → {statusLabels[h.new_status]}</strong><p>{h.reason}</p>
        <p>Notes: {h.old_notes || 'None'} → {h.new_notes || 'None'}</p>
        <small>{h.actor_name} · {formatDate(h.created_at)} {formatTime(h.created_at)}</small>
      </li>)}</ol>}
    </Modal>}
  </div>
}
