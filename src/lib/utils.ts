import { schoolDate, SCHOOL_TIMEZONE, schoolTime } from './attendance'
import type { AttendanceStatus } from '../types/database'

export function greeting(date = new Date()) { const hour = Number(schoolTime(date).slice(0, 2)); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening' }
export function formatTime(value?: string | null) { return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: SCHOOL_TIMEZONE }) : '—' }
export function formatDate(value: string | Date) { return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric', timeZone: SCHOOL_TIMEZONE }) }
export function todayISO() { return schoolDate() }
export const statusLabels: Record<AttendanceStatus, string> = { P: 'Present', L: 'Late', A: 'Absent', E: 'Excused' }
export function teacherFirstName(name?: string) { return name?.trim().split(/\s+/)[0] || 'Teacher' }
export function attendanceMessage(teacher: string, student: string, classroom: string, status: AttendanceStatus, scanTime: string) {
  const hello = greeting(new Date(scanTime)); const time = formatTime(scanTime); const teacherName = teacherFirstName(teacher)
  return status === 'L'
    ? `${hello}, this is Teacher ${teacherName}. ${student} has arrived in my ${classroom} class today. The attendance QR code was scanned at ${time} and was recorded as LATE.`
    : `${hello}, this is Teacher ${teacherName}. ${student} is present in my ${classroom} class right now. The attendance QR code was scanned at ${time} today. Thank you.`
}
export function initials(name?: string) { return (name || 'T').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }
