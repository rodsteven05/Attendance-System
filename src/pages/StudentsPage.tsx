import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, Plus, Search, Upload, UserRound } from 'lucide-react'
import Papa from 'papaparse'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Field, Modal, Spinner, StatusBadge } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/feedback'
import type { Student } from '../types/database'

const CSV_FIELDS = ['student_number', 'first_name', 'middle_name', 'last_name', 'grade_level', 'section', 'parent_name', 'parent_phone', 'parent_email', 'address', 'emergency_contact']

function cleanRow(raw: Record<string, string>) {
  const row: Record<string, string> = {}
  for (const key of CSV_FIELDS) {
    const value = raw[key]?.trim()
    if (value) row[key] = value
  }
  return row
}

export default function StudentsPage() {
  const { session } = useAuth()
  const { selected } = useClassroom()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const [search, setSearch] = useState((location.state as { search?: string } | null)?.search || '')
  const [importing, setImporting] = useState(false)

  const load = async () => {
    if (!selected) { setStudents([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('classroom_students')
      .select('student:students(*)')
      .eq('classroom_id', selected.id)
      .eq('enrollment_status', 'active')
    setStudents(((data || []) as unknown as { student: Student }[]).map(r => r.student))
    setLoading(false)
  }

  useEffect(() => { void load() }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selected || !session) return
    const values = Object.fromEntries(new FormData(e.currentTarget))
    const { data, error } = await supabase
      .from('students')
      .insert({ ...values, created_by: session.user.id })
      .select()
      .single()
    if (error || !data) { toast.error(error?.message || 'Could not create student'); return }
    const { error: joinError } = await supabase
      .from('classroom_students')
      .insert({ classroom_id: selected.id, student_id: data.id })
    if (joinError) {
      await supabase.from('students').delete().eq('id', data.id)
      toast.error(joinError.message)
      return
    }
    setOpen(false)
    toast.success('Student added.')
    await load()
  }

  const importCsv = (file: File) => Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (r) => {
      if (!selected || !session) return
      setImporting(true)
      let failures = 0
      for (const raw of r.data as Record<string, string>[]) {
        const row = cleanRow(raw)
        if (!row.student_number && !row.first_name && !row.last_name) continue
        const { data: existing, error: lookupError } = await supabase.from('students').select('id').eq('student_number', row.student_number).maybeSingle()
        if (lookupError) { failures++; continue }
        const { data, error } = existing
          ? await supabase.from('students').update(row).eq('id', existing.id).select().single()
          : await supabase.from('students').insert({ ...row, created_by: session.user.id }).select().single()
        if (error || !data) { failures++; continue }
        const { error: joinError } = await supabase
          .from('classroom_students')
          .upsert({ classroom_id: selected.id, student_id: data.id }, { onConflict: 'classroom_id,student_id' })
        if (joinError) failures++
      }
      setImporting(false)
      if (failures) toast.error(`${failures} row(s) failed to import`)
      else toast.success('Students imported.')
      await load()
    },
  })

  const exportCsv = () => {
    const csv = Papa.unparse(students.map(s => ({
      student_number: s.student_number,
      first_name: s.first_name,
      middle_name: s.middle_name ?? '',
      last_name: s.last_name,
      grade_level: s.grade_level,
      section: s.section,
      parent_name: s.parent_name,
      parent_phone: s.parent_phone ?? '',
      parent_email: s.parent_email ?? '',
      address: s.address ?? '',
      emergency_contact: s.emergency_contact ?? '',
    })))
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected?.classroom_name ?? 'students'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = students.filter(s => `${s.full_name} ${s.student_number}`.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <Spinner />

  return (
    <div className="page">
      <PageHeader
        eyebrow="STUDENT DIRECTORY"
        title="Students"
        description="Enroll, search, import, and manage students in the selected classroom."
        actions={<>
          <label className="btn secondary file-btn">
            <Upload size={17} />{importing ? 'Importing…' : 'Import CSV'}
            <input type="file" accept=".csv" onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
          <button className="btn secondary" onClick={exportCsv} disabled={!students.length}><Download size={17} />Export</button>
          <button className="btn primary" onClick={() => setOpen(true)} disabled={!selected}><Plus size={17} />Add Student</button>
        </>}
      />
      <div className="toolbar">
        <div className="search"><Search size={17} /><input placeholder="Search name or student number" value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>
      {!selected ? <EmptyState title="No classroom selected" description="Choose a classroom to view its students." />
        : !filtered.length ? <EmptyState title="No students" description="Add a student or import a CSV to get started." />
        : (
          <div className="card-grid">
            {filtered.map(s => (
              <div className="card student-card" key={s.id}>
                <div className="avatar"><UserRound size={22} /></div>
                <div className="card-body">
                  <strong>{s.full_name}</strong>
                  <span className="muted">{s.student_number} · {s.grade_level} {s.section}</span>
                  <span className="muted">Parent: {s.parent_name}{s.parent_phone ? ` · ${s.parent_phone}` : ''}</span>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        )}
      {open && (
        <Modal title="Add Student" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="form-grid">
            <Field label="Student Number"><input name="student_number" required /></Field>
            <Field label="First Name"><input name="first_name" required /></Field>
            <Field label="Middle Name"><input name="middle_name" /></Field>
            <Field label="Last Name"><input name="last_name" required /></Field>
            <Field label="Grade Level"><input name="grade_level" required /></Field>
            <Field label="Section"><input name="section" required /></Field>
            <Field label="Parent/Guardian Name"><input name="parent_name" required /></Field>
            <Field label="Parent Phone"><input name="parent_phone" type="tel" /></Field>
            <Field label="Parent Email"><input name="parent_email" type="email" /></Field>
            <Field label="Address"><input name="address" /></Field>
            <Field label="Emergency Contact"><input name="emergency_contact" /></Field>
            <button className="btn primary" type="submit">Save Student</button>
          </form>
        </Modal>
      )}
    </div>
  )
}
