import { describe, expect, it } from 'vitest'
import { buildSummary, finalizationProblem, isClassDay, schoolDate, type Enrollment } from '../src/lib/attendance'
import type { Attendance, Classroom, Student } from '../src/types/database'

const classroom = { id: 'class', teaching_days: [1, 2, 3, 4, 5], no_class_dates: ['2026-10-13'], created_at: '2026-10-01T00:00:00Z', attendance_cutoff: '09:00:00', status: 'active' } as Classroom
const enrollment = (id: string, enrolled_at = '2026-10-01T00:00:00Z'): Enrollment => ({ student_id: id, enrollment_status: 'active', enrolled_at, removed_at: null, student: { id, full_name: id, student_number: id, status: 'active' } as Student })
describe('school calendar and roster reports', () => {
  it('uses Manila dates across UTC midnight', () => {
    expect(schoolDate('2026-10-11T17:00:00Z')).toBe('2026-10-12')
  })
  it('rejects weekends and holidays and accepts scheduled days', () => {
    expect(isClassDay(classroom, '2026-10-11')).toBe(false)
    expect(isClassDay(classroom, '2026-10-13')).toBe(false)
    expect(isClassDay(classroom, '2026-10-12')).toBe(true)
  })
  it('blocks finalization before cutoff, in the future, or with unsynced scans', () => {
    const now = new Date('2026-10-12T00:00:00Z')
    expect(finalizationProblem(classroom, '2026-10-12', 0, now)).toContain('09:00')
    expect(finalizationProblem(classroom, '2026-10-14', 0, now)).toContain('Future')
    expect(finalizationProblem(classroom, '2026-10-09', 1, now)).toContain('Sync')
    expect(finalizationProblem(classroom, '2026-10-09', 0, now)).toBeNull()
    expect(finalizationProblem(classroom, '2026-10-12', 0, new Date('2026-10-12T01:00:00Z'))).toBeNull()
  })
  it('includes students with no records, excludes excused days from rate, and counts unrecorded days', () => {
    const roster = [enrollment('Alice'), enrollment('Bob'), enrollment('Carol', '2026-10-14T00:00:00Z')]
    const rows = [
      { student_id: 'Alice', student: roster[0].student, attendance_date: '2026-10-12', status: 'P' },
      { student_id: 'Alice', student: roster[0].student, attendance_date: '2026-10-14', status: 'E' },
    ] as Attendance[]
    const summary = buildSummary(roster, rows, classroom, '2026-10-12', '2026-10-16', '2026-10-14')
    expect(summary).toHaveLength(3)
    expect(summary[0]).toMatchObject({ name: 'Alice', rate: 100, unrecorded: 0, e: 1 })
    expect(summary[1]).toMatchObject({ name: 'Bob', rate: null, unrecorded: 2 })
    expect(summary[2]).toMatchObject({ name: 'Carol', rate: null, unrecorded: 1 })
  })
  it('does not count dates after removal or before classroom creation', () => {
    const removed = { ...enrollment('Alice'), enrollment_status: 'removed', removed_at: '2026-10-14T00:00:00Z' }
    expect(buildSummary([removed], [], classroom, '2026-10-12', '2026-10-16', '2026-10-16')[0].unrecorded).toBe(1)
    expect(isClassDay(classroom, '2026-09-30')).toBe(false)
  })
})
