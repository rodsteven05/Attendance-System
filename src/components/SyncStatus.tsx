import { useAttendanceSync } from '../contexts/AttendanceSyncContext'
import { useClassroom } from '../contexts/ClassroomContext'
import { promptDialog, toast } from '../lib/feedback'
import { formatDate, formatTime } from '../lib/utils'

export function SyncStatus() {
  const { queue, online, syncing, error, message, legacyQueue, sync, removeRejected } = useAttendanceSync()
  const { classrooms } = useClassroom()
  const remove = async (id: string) => {
    const answer = await promptDialog({ title: 'Remove rejected scan from this device?', label: 'Only remove it after checking the student’s attendance. Type REMOVE to continue.', required: true })
    if (answer !== 'REMOVE') return
    try { removeRejected(id) } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove scan.') }
  }
  return <section className="sync-status" aria-label="Attendance synchronization">
    <div className="toolbar"><strong>{online ? 'Online' : 'Offline'} · {queue.length} pending scan(s)</strong>
      <button className="btn secondary" disabled={!online || syncing || !queue.length} onClick={() => void sync()}>{syncing ? 'Synchronizing…' : 'Retry synchronization'}</button>
    </div>
    <p role="status">{message || 'Saved scans synchronize when this account reconnects.'}</p>
    {error && <p role="alert" className="text-red">{error}</p>}
    {queue.length > 0 && <details><summary>Review pending scans</summary><ul>{queue.map(q => <li key={q.id}>
      <strong>{classrooms.find(c => c.id === q.classroomId)?.classroom_name || 'Classroom unavailable'}</strong> · {formatDate(q.scannedAt)} {formatTime(q.scannedAt)}
      <p>{q.attendanceId ? 'Attendance saved; notification pending.' : 'Attendance not yet synchronized.'} {q.error}</p>
      {q.error && !q.attendanceId && <button className="btn secondary" disabled={syncing} onClick={() => void remove(q.id)}>Remove rejected scan</button>}
    </li>)}</ul></details>}
    {legacyQueue && <p role="alert">This browser has scans from an older version without an account owner. They have been preserved but will not sync automatically. Review them with your administrator before finalizing attendance.</p>}
  </section>
}
