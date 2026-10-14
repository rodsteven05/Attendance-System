import type { Attendance, Classroom, Student } from '../types/database'

export const SCHOOL_TIMEZONE = 'Asia/Manila'
export function schoolDate(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
export function schoolTime(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}
export function isClassDay(classroom: Pick<Classroom, 'teaching_days' | 'no_class_dates' | 'created_at'>, date: string) {
  return date >= schoolDate(classroom.created_at)
    && (classroom.teaching_days || []).includes(new Date(`${date}T00:00:00Z`).getUTCDay())
    && !(classroom.no_class_dates || []).includes(date)
}
export function finalizationProblem(classroom: Classroom, date: string, pending: number, now = new Date()) {
  if (pending) return 'Sync this day’s pending scans before finalizing.'
  if (classroom.status !== 'active') return 'This classroom is inactive.'
  if (!classroom.teaching_days?.length) return 'Set teaching days in classroom settings first.'
  if (date > schoolDate(now)) return 'Future dates cannot be finalized.'
  if (!isClassDay(classroom, date)) return 'This is not a scheduled class day.'
  if (date === schoolDate(now) && schoolTime(now) < classroom.attendance_cutoff) return `Available after ${classroom.attendance_cutoff.slice(0, 5)} (Manila time).`
  return null
}

export interface Enrollment {
  student_id: string
  enrollment_status: string
  enrolled_at: string
  removed_at: string | null
  student: Student
}
export function enrolledOn(enrollment: Enrollment, date: string) {
  return schoolDate(enrollment.enrolled_at) <= date
    && (!enrollment.removed_at || schoolDate(enrollment.removed_at) > date)
    && (enrollment.enrollment_status === 'active' || !!enrollment.removed_at)
}
export function dateRange(from: string, to: string) {
  const dates: string[] = []
  for (const d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}
export function buildSummary(enrollments: Enrollment[], rows: Attendance[], classroom: Classroom, from: string, to: string, today = schoolDate()) {
  const dates = from <= to ? dateRange(from, to < today ? to : today).filter(date => isClassDay(classroom, date)) : []
  const students = new Map(enrollments.filter(e => e.student && (e.enrollment_status === 'active' || (schoolDate(e.enrolled_at) <= to && !!e.removed_at && schoolDate(e.removed_at) > from))).map(e => [e.student_id, e.student]))
  for (const row of rows) if (row.student) students.set(row.student_id, row.student)
  return [...students.values()].map(student => {
    const records = rows.filter(r => r.student_id === student.id)
    const enrollment = enrollments.find(e => e.student_id === student.id)
    const recordedDates = new Set(records.map(r => r.attendance_date))
    const counts = { p: 0, l: 0, a: 0, e: 0 }
    for (const row of records) counts[row.status.toLowerCase() as keyof typeof counts]++
    const denominator = counts.p + counts.l + counts.a
    return { id: student.id, name: student.full_name, number: student.student_number, ...counts,
      unrecorded: enrollment ? dates.filter(date => enrolledOn(enrollment, date) && !recordedDates.has(date)).length : 0,
      rate: denominator ? (counts.p + counts.l) / denominator * 100 : null }
  }).sort((a, b) => a.name.localeCompare(b.name))
}
