import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import Papa from 'papaparse'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Spinner } from '../components/UI'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { statusLabels, todayISO } from '../lib/utils'
import { buildSummary, type Enrollment } from '../lib/attendance'
import { allRows } from '../lib/query'
import type { Attendance } from '../types/database'

function download(name: string, values: Record<string, unknown>[]) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', Papa.unparse(values, { escapeFormulae: true })], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
export default function ReportsPage() {
  const { selected } = useClassroom()
  const [rows, setRows] = useState<Attendance[]>([])
  const [roster, setRoster] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(() => todayISO().slice(0, 8) + '01')
  const [to, setTo] = useState(todayISO)
  const invalidRange = !from || !to || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 731
  useEffect(() => {
    let cancelled = false
    setRows([]); setRoster([])
    if (!selected || invalidRange) { setLoading(false); return }
    setLoading(true); setError(null)
    Promise.all([
      allRows<Attendance>((start, end) => supabase.from('attendance').select('*,student:students(*)').eq('classroom_id', selected.id).gte('attendance_date', from).lte('attendance_date', to).order('attendance_date').order('id').range(start, end)),
      allRows<Enrollment>((start, end) => supabase.from('classroom_students').select('*,student:students(*)').eq('classroom_id', selected.id).order('id').range(start, end)),
    ]).then(([records, enrollments]) => { if (!cancelled) { setRows(records); setRoster(enrollments) } })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected, from, to, invalidRange])
  const summary = useMemo(() => selected && !invalidRange ? buildSummary(roster, rows, selected, from, to) : [], [roster, rows, selected, from, to, invalidRange])
  const rate = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`
  const exportSummary = () => download(`${selected?.classroom_name}-summary-${from}_${to}.csv`, summary.map(s => ({ student: s.name, student_number: s.number, present: s.p, late: s.l, absent: s.a, excused: s.e, not_recorded: selected?.teaching_days?.length ? s.unrecorded : 'Schedule required', recorded_attendance_rate: rate(s.rate) })))
  const exportDetailed = () => download(`${selected?.classroom_name}-records-${from}_${to}.csv`, rows.map(r => ({ date: r.attendance_date, student: r.student?.full_name, student_number: r.student?.student_number, status: statusLabels[r.status], scan_time: r.scan_time || '', notes: r.notes || '' })))
  return <div className="page">
    <PageHeader eyebrow="ATTENDANCE EXPORTS" title="Reports" description="Complete roster summaries and recorded attendance logs."
      actions={<><button className="btn secondary" onClick={exportSummary} disabled={loading || !!error || invalidRange || !summary.length}><Download size={17} />Summary CSV</button><button className="btn primary" onClick={exportDetailed} disabled={loading || !!error || invalidRange || !rows.length}><Download size={17} />Detailed CSV</button></>} />
    <div className="toolbar"><label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To <input type="date" value={to} max={todayISO()} onChange={e => setTo(e.target.value)} /></label></div>
    <p>Recorded attendance rate = (present + late) ÷ (present + late + absent). Excused and unrecorded days are excluded. “—” means no applicable records. A rate with unrecorded days is incomplete.</p>
    <p>Not recorded counts scheduled class days through today, within enrollment dates, using the classroom’s current teaching days and holiday/cancellation dates. Detailed CSV includes saved records only.</p>
    {selected && !selected.teaching_days?.length && <p role="alert">Set classroom teaching days to calculate unrecorded days.</p>}
    {invalidRange ? <p role="alert">Choose a valid date range of up to two years.</p> : loading ? <Spinner /> : error ? <p role="alert" className="text-red">{error}</p> : !summary.length ? <EmptyState title="No students in this range" description="Select a classroom and a date range with enrolled students." /> : <div className="table-card"><div className="table-wrap"><table>
      <thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Not recorded</th><th>Recorded rate</th></tr></thead>
      <tbody>{summary.map(s => <tr key={s.id}><td><strong>{s.name}</strong><span>{s.number}</span></td><td>{s.p}</td><td>{s.l}</td><td>{s.a}</td><td>{s.e}</td><td>{selected?.teaching_days?.length ? s.unrecorded : 'Schedule required'}</td><td><strong className={s.rate !== null && s.rate < 80 ? 'text-red' : ''}>{rate(s.rate)}</strong>{s.unrecorded > 0 && <span>Incomplete</span>}</td></tr>)}</tbody>
    </table></div></div>}
  </div>
}
