import { describe, expect, it, vi } from 'vitest'
import { enqueue, flushQueue, readQueue, type QueuedScan, type ScanOutcome } from '../src/lib/attendanceQueue'
class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
const scan = (id: string, userId = 'teacher-a', scannedAt = '2026-10-12T00:00:00Z'): QueuedScan => ({ id, userId, scannedAt, classroomId: 'class-a', token: 'token-a' })
const outcome: ScanOutcome = { attendance_id: 'attendance-a', student_name: 'Alice', status: 'P', scan_time: '2026-10-12T00:00:00Z', duplicate: false }
describe('offline attendance queue', () => {
  it('isolates accounts and deduplicates only within the same classroom and Manila date', () => {
    const storage = new MemoryStorage()
    enqueue(storage, scan('a')); enqueue(storage, scan('duplicate'))
    enqueue(storage, scan('b', 'teacher-b')); enqueue(storage, scan('next-day', 'teacher-a', '2026-10-12T17:00:00Z'))
    expect(readQueue(storage, 'teacher-a').map(s => s.id)).toEqual(['a', 'next-day'])
    expect(readQueue(storage, 'teacher-b').map(s => s.id)).toEqual(['b'])
  })
  it('retains notification failures and retries delivery without recording attendance again', async () => {
    const storage = new MemoryStorage(); enqueue(storage, scan('a'))
    const record = vi.fn().mockResolvedValue(outcome)
    const notify = vi.fn().mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce(undefined)
    const actions = { isCurrentUser: async () => true, record, notify }
    await flushQueue(storage, 'teacher-a', actions)
    expect(readQueue(storage, 'teacher-a')[0]).toMatchObject({ attendanceId: 'attendance-a', error: 'Provider unavailable' })
    await flushQueue(storage, 'teacher-a', actions)
    expect(record).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(readQueue(storage, 'teacher-a')).toEqual([])
  })
  it('does not drop scans added while synchronization is in progress', async () => {
    const storage = new MemoryStorage(); enqueue(storage, scan('a'))
    await flushQueue(storage, 'teacher-a', { isCurrentUser: async () => true, record: async () => { enqueue(storage, { ...scan('b'), token: 'other-student' }); return outcome }, notify: async () => {} })
    expect(readQueue(storage, 'teacher-a').map(s => s.id)).toEqual(['b'])
  })
  it('stops before submitting if the signed-in account changed', async () => {
    const storage = new MemoryStorage(); enqueue(storage, scan('a'))
    const record = vi.fn()
    await flushQueue(storage, 'teacher-a', { isCurrentUser: async () => false, record, notify: async () => {} })
    expect(record).not.toHaveBeenCalled()
    expect(readQueue(storage, 'teacher-a')).toHaveLength(1)
  })
  it('keeps scans that conflict with already-finalized absence records for review', async () => {
    const storage = new MemoryStorage(); enqueue(storage, scan('a'))
    const notify = vi.fn()
    await flushQueue(storage, 'teacher-a', { isCurrentUser: async () => true, record: async () => ({ ...outcome, status: 'A', duplicate: true }), notify })
    expect(readQueue(storage, 'teacher-a')[0].error).toContain('Review and correct')
    expect(notify).not.toHaveBeenCalled()
  })
})
