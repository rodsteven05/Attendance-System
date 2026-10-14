import { useAttendanceSync } from '../contexts/AttendanceSyncContext'
import { SyncStatus } from '../components/SyncStatus'
import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CheckCircle2, MessageSquare, RefreshCw, TriangleAlert, WifiOff, XCircle } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, EmptyState, StatusBadge } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { attendanceMessage, formatTime } from '../lib/utils'

type Result = {
  kind: 'success' | 'duplicate' | 'error' | 'queued' | 'camera'
  student?: string
  status?: string
  time?: string
  message?: string
  smsLink?: string
}

export default function ScanPage() {
  const { profile } = useAuth()
  const { selected } = useClassroom()
  const { add, sync, online } = useAttendanceSync()
  const [active, setActive] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const busy = useRef(false)

  const process = async (token: string) => {
    if (!selected || busy.current) return
    busy.current = true
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) throw new Error('This is not a student QR code.')
      const item = add(selected.id, token)
      setResult({ kind: 'queued', message: 'Scan saved on this device and waiting to synchronize.' })
      if (!navigator.onLine) return
      const { outcomes } = await sync()
      const row = outcomes[item.id]
      if (!row) return
      let smsLink: string | undefined
      const { data: student } = await supabase.from('students').select('parent_phone').eq('qr_token', token).maybeSingle()
      if (student?.parent_phone && !row.duplicate) {
        const body = attendanceMessage(profile?.full_name || 'Teacher', row.student_name, selected.subject, row.status as 'P' | 'L', row.scan_time)
        smsLink = 'sms:' + student.parent_phone + '?body=' + encodeURIComponent(body)
      }
      setResult({ kind: row.duplicate ? 'duplicate' : 'success', student: row.student_name, status: row.status, time: row.scan_time, smsLink })
    } catch (e) {
      setResult({ kind: 'error', message: e instanceof Error ? e.message : 'Unable to save this scan. Please try again.' })
    } finally {
      setTimeout(() => { busy.current = false }, 1800)
    }
  }
  const processRef = useRef(process)
  useEffect(() => { processRef.current = process })
  useEffect(() => {
    setActive(false)
    setResult(null)

  }, [selected?.id])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const camera = new Html5Qrcode('qr-reader')
    const run = async () => {
      try {
        const onScan = (token: string) => { if (!cancelled) void processRef.current(token) }
        try {
          await camera.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScan, () => {})
        } catch {
          if (cancelled) return
          await camera.start({ facingMode: 'user' }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScan, () => {})
        }
        if (cancelled && camera.isScanning) await camera.stop()
      } catch {
        if (!cancelled) {
          setResult({ kind: 'camera', message: 'Camera unavailable. Allow camera access, close other apps using it, and try again.' })
          setActive(false)
        }
      }
    }
    void run()
    return () => { cancelled = true; if (camera.isScanning) void camera.stop().catch(() => {}) }
  }, [active, selected?.id])
  const start = () => { setResult(null); setActive(true) }
  const stop = () => setActive(false)

  if (!selected) return (
    <div className="page">
      <PageHeader title="Scan attendance" />
      <EmptyState title="Select a classroom first" description="The scanner verifies that every student belongs to the active classroom." />
    </div>
  )

  const titles: Record<Result['kind'], string> = {
    success: 'Attendance recorded',
    duplicate: 'Already recorded',
    queued: 'Waiting to sync',
    camera: 'Camera unavailable',
    error: 'Attendance not recorded',
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="LIVE ATTENDANCE"
        title="Scan attendance"
        description={`Scanning for ${selected.classroom_name} — Late after ${selected.late_threshold.slice(0, 5)}`}
        actions={<span className={`online-state ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>}
      />
      <SyncStatus />
      <div className="scanner-layout">
        <Card className="scanner-card">
          <div className={`scanner-frame ${active ? 'active' : ''}`}>
            {active ? <div id="qr-reader" /> : (
              <div className="camera-placeholder">
                <Camera size={48} />
                <h2>Camera is ready</h2>
                <p>Position the student QR code inside the frame.</p>
              </div>
            )}
          </div>
          <div className="scanner-actions">
            {active
              ? <button className="btn secondary" onClick={stop}>Stop camera</button>
              : <button className="btn primary" onClick={start}><Camera size={18} />Start camera</button>}
          </div>
        </Card>
        <Card className="scan-result">
          <span className="eyebrow">SCAN FEEDBACK</span>
          {!result ? (
            <div className="result-idle">
              <div className="pulse"><Camera /></div>
              <h2>Waiting for a scan</h2>
              <p>Attendance details will appear here after a valid QR code is detected.</p>
            </div>
          ) : (
            <div className={`result-content ${result.kind}`}>
              {result.kind === 'success' ? <CheckCircle2 /> : result.kind === 'queued' ? <WifiOff /> : result.kind === 'duplicate' ? <TriangleAlert /> : <XCircle />}
              <h2>{result.kind === 'error' && result.message?.includes('cutoff') ? 'Cutoff passed' : titles[result.kind]}</h2>
              {result.student && <>
                <strong className="student-name">{result.student}</strong>
                {result.status && <StatusBadge status={result.status} />}
                <p>{result.kind === 'duplicate' ? 'First scan:' : 'Scan time:'} {formatTime(result.time)}</p>
                <p>{selected.subject} · {selected.section}</p>
              </>}
              {result.message && <p>{result.message}</p>}
              {result.smsLink && (
                <a className="btn primary" href={result.smsLink}>
                  <MessageSquare size={16} />Text parent via SMS
                </a>
              )}
              <button className="btn secondary" onClick={() => setResult(null)}><RefreshCw size={16} />Scan another</button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
