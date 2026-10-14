import { schoolDate } from './attendance'

export interface QueuedScan {
  id: string
  userId: string
  classroomId: string
  token: string
  scannedAt: string
  attendanceId?: string
  error?: string
}
export interface ScanOutcome {
  attendance_id: string
  student_name: string
  status: string
  scan_time: string
  duplicate: boolean
}
const prefix = (userId: string) => `attendance-queue:v2:${userId}:`
export function readQueue(storage: Storage, userId: string): QueuedScan[] {
  const items: QueuedScan[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith(prefix(userId))) continue
    const item = JSON.parse(storage.getItem(key) || 'null') as QueuedScan | null
    if (!item || item.userId !== userId || !item.id || !item.token || !item.classroomId || !Number.isFinite(Date.parse(item.scannedAt))) {
      throw new Error('A saved scan could not be read. Keep this browser’s data and contact your administrator.')
    }
    items.push(item)
  }
  return items.sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))
}
export function enqueue(storage: Storage, scan: QueuedScan) {
  const existing = readQueue(storage, scan.userId).find(item => item.classroomId === scan.classroomId && item.token === scan.token && schoolDate(item.scannedAt) === schoolDate(scan.scannedAt))
  if (existing) return existing
  storage.setItem(prefix(scan.userId) + scan.id, JSON.stringify(scan))
  return scan
}
export function removeRejectedScan(storage: Storage, userId: string, id: string) {
  const item = readQueue(storage, userId).find(scan => scan.id === id)
  if (!item?.error || item.attendanceId) throw new Error('Only rejected, unsaved scans can be removed here.')
  storage.removeItem(prefix(userId) + id)
}
export async function flushQueue(storage: Storage, userId: string, actions: {
  isCurrentUser: () => Promise<boolean>
  record: (item: QueuedScan) => Promise<ScanOutcome>
  notify: (attendanceId: string) => Promise<void>
}) {
  let saved = 0
  const outcomes: Record<string, ScanOutcome> = {}
  for (const item of readQueue(storage, userId)) {
    if (!await actions.isCurrentUser()) break
    const key = prefix(userId) + item.id
    // Another tab may have finished this item while this tab waited for its lock.
    if (!storage.getItem(key)) continue
    try {
      if (!item.attendanceId) {
        const outcome = await actions.record(item)
        if (outcome.status === 'A' || outcome.status === 'E') {
          throw new Error('This day already has an absent/excused record. Review and correct it in Attendance before retrying this scan.')
        }
        outcomes[item.id] = outcome
        item.attendanceId = outcome.attendance_id
        storage.setItem(key, JSON.stringify(item))
      }
      if (!await actions.isCurrentUser()) break
      await actions.notify(item.attendanceId)
      storage.removeItem(key)
      saved++
    } catch (error) {
      item.error = error instanceof Error ? error.message : 'Synchronization failed. Retry when connected.'
      storage.setItem(key, JSON.stringify(item))
    }
  }
  return { saved, outcomes }
}
