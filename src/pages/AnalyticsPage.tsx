import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, ChartTip, EmptyState, Spinner } from '../components/UI'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import type { Attendance, Student } from '../types/database'

const COLORS: Record<string, string> = { present: '#1e6f5c', late: '#d69b35', absent: '#d5654d', excused: '#5079b8' }

export default function AnalyticsPage() {
  const { selected } = useClassroom()
  const [rows, setRows] = useState<Attendance[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (!selected) { setLoading(false); return }
    setLoading(true)
    const since = new Date(Date.now() - days * 86400000).toLocaleDateString('en-CA')
    Promise.all([
      supabase.from('attendance').select('*,student:students(*)').eq('classroom_id', selected.id).gte('attendance_date', since),
      supabase.from('classroom_students').select('student:students(*)').eq('classroom_id', selected.id).eq('enrollment_status', 'active'),
    ]).then(([{ data: a }, { data: e }]) => {
      setRows((a || []) as unknown as Attendance[])
      setStudents(((e || []) as unknown as { student: Student }[]).map(r => r.student))
      setLoading(false)
    })
  }, [selected?.id, days])

  const trend = useMemo(() => {
    const dates = [...new Set(rows.map(r => r.attendance_date))].sort()
    return dates.map(date => {
      const day = rows.filter(r => r.attendance_date === date)
      const marked = day.filter(r => r.status !== 'E').length
      return {
        date: new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        present: day.filter(r => r.status === 'P').length,
        late: day.filter(r => r.status === 'L').length,
        absent: day.filter(r => r.status === 'A').length,
        rate: marked ? Math.round((day.filter(r => ['P', 'L'].includes(r.status)).length / marked) * 100) : null,
      }
    })
  }, [rows])

  const perStudent = useMemo(() => students.map(s => {
    const mine = rows.filter(r => r.student_id === s.id)
    const attended = mine.filter(r => ['P', 'L'].includes(r.status)).length
    const absent = mine.filter(r => r.status === 'A').length
    const late = mine.filter(r => r.status === 'L').length
    return { name: s.full_name, number: s.student_number, attended, absent, late, total: attended + absent, rate: attended + absent ? (attended / (attended + absent)) * 100 : null }
  }).sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)), [rows, students])

  const atRisk = useMemo(() => perStudent.filter(s => (selected && s.absent >= selected.absence_warning_threshold) || (s.total >= 3 && s.rate !== null && s.rate < 80)), [perStudent, selected])
  const chartData = useMemo(() => [...perStudent].filter(s => s.rate !== null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 12), [perStudent])

  if (loading) return <Spinner />
  return (
    <div className="page">
      <PageHeader
        eyebrow="CLASSROOM INSIGHTS"
        title="Analytics"
        description="Recorded attendance rates exclude excused and unrecorded days. Review Reports for missing records."
        actions={<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>School year</option></select>}
      />
      {!rows.length ? <EmptyState title="Not enough data" description="Record attendance for this classroom to see analytics." /> : (
        <>
          <div className="dashboard-grid">
            <Card className="chart-card wide">
              <div className="card-heading"><div><span className="eyebrow">DAILY RATE</span><h2>Attendance rate trend</h2></div></div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={trend}>
                  <defs><linearGradient id="rate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1e6f5c" stopOpacity={.35} /><stop offset="1" stopColor="#1e6f5c" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<ChartTip unit="%" />} />
                  <Area type="monotone" dataKey="rate" stroke="#1e6f5c" fill="url(#rate)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card className="chart-card">
              <div className="card-heading"><div><span className="eyebrow">BREAKDOWN</span><h2>Status totals</h2></div></div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={[{ name: 'Status', present: rows.filter(r => r.status === 'P').length, late: rows.filter(r => r.status === 'L').length, absent: rows.filter(r => r.status === 'A').length, excused: rows.filter(r => r.status === 'E').length }]} layout="vertical">
                  <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" /><Tooltip content={<ChartTip />} cursor={{ fill: '#1e6f5c10' }} />
                  {Object.keys(COLORS).map(k => <Bar key={k} dataKey={k} stackId="s" fill={COLORS[k]} radius={[0, 4, 4, 0]} />)}
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="chart-card wide">
              <div className="card-heading"><div><span className="eyebrow">TOP 12</span><h2>Attendance rate by student</h2></div></div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" hide /><YAxis domain={[0, 100]} unit="%" /><Tooltip content={<ChartTip unit="%" />} cursor={{ fill: '#1e6f5c10' }} />
                  <Bar dataKey="rate" radius={[6, 6, 0, 0]}>{chartData.map(s => <Cell key={s.number} fill={s.rate !== null && s.rate < 80 ? '#d5654d' : '#1e6f5c'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="chart-card">
              <div className="card-heading"><div><span className="eyebrow">INTERVENTION</span><h2>At-risk students</h2></div><TriangleAlert color="#d5654d" /></div>
              {!atRisk.length ? <p className="muted">No students currently meet the at-risk criteria.</p> : (
                <div className="table-wrap"><table><thead><tr><th>Student</th><th>Absences</th><th>Late</th><th>Rate</th></tr></thead>
                  <tbody>{atRisk.map(s => <tr key={s.number}><td><strong>{s.name}</strong><span>{s.number}</span></td><td>{s.absent}</td><td>{s.late}</td><td><strong className="text-red">{s.rate === null ? '—' : s.rate.toFixed(0) + '%'}</strong></td></tr>)}</tbody>
                </table></div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
