import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import { enqueue, flushQueue, readQueue, removeRejectedScan, type QueuedScan, type ScanOutcome } from '../lib/attendanceQueue'

type SyncResult = { saved: number; outcomes: Record<string, ScanOutcome> }
interface SyncValue {
  queue: QueuedScan[]
  online: boolean
  syncing: boolean
  error: string | null
  message: string
  legacyQueue: boolean
  add: (classroomId: string, token: string) => QueuedScan
  sync: () => Promise<SyncResult>
  removeRejected: (id: string) => void
}
const SyncContext = createContext<SyncValue | null>(null)
export function AttendanceSyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [queue, setQueue] = useState<QueuedScan[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [legacyQueue, setLegacyQueue] = useState(false)
  const running = useRef<{ userId: string; promise: Promise<SyncResult> } | null>(null)
  const addedDuringSync = useRef(new Set<string>())
  const currentUser = useRef(userId)
  useEffect(() => { currentUser.current = userId }, [userId])

  const refresh = useCallback(() => {
    try {
      setQueue(userId ? readQueue(localStorage, userId) : [])
      const legacy = localStorage.getItem('attendance-queue')
      setLegacyQueue(!!legacy && legacy !== '[]')
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Cannot access saved scans.') }
  }, [userId])
  const add = useCallback((classroomId: string, token: string) => {
    if (!userId) throw new Error('Sign in before scanning.')
    const item = enqueue(localStorage, { id: crypto.randomUUID(), userId, classroomId, token, scannedAt: new Date().toISOString() })
    if (running.current?.userId === userId) addedDuringSync.current.add(userId)
    refresh()
    return item
  }, [userId, refresh])
  const removeRejected = (id: string) => {
    if (!userId || syncing) return
    removeRejectedScan(localStorage, userId, id)
    refresh()
  }

  const sync = useCallback((): Promise<SyncResult> => {
    if (!userId || !navigator.onLine) return Promise.resolve({ saved: 0, outcomes: {} })
    if (running.current?.userId === userId) return running.current.promise
    const execute = async () => {
      setSyncing(true)
      try {
        const flush = () => flushQueue(localStorage, userId, {
          isCurrentUser: async () => {
            const { data } = await supabase.auth.getSession()
            return currentUser.current === userId && data.session?.user.id === userId && navigator.onLine
          },
          record: async item => {
            const { data, error } = await supabase.rpc('record_qr_attendance', { p_classroom_id: item.classroomId, p_qr_token: item.token, p_scanned_at: item.scannedAt })
            if (error) throw new Error(error.message)
            if (!data?.[0]) throw new Error('No attendance result was returned.')
            return data[0] as ScanOutcome
          },
          notify: async attendanceId => {
            const { data, error } = await supabase.functions.invoke('send-notification', { body: { attendance_id: attendanceId } })
            if (error || data?.failed || data?.processing) throw new Error('Attendance saved; parent notification is pending. Retry synchronization.')
          },
        })
        const result: SyncResult = { saved: 0, outcomes: {} }
        do {
          addedDuringSync.current.delete(userId)
          const batch = navigator.locks ? await navigator.locks.request(`attendance-sync:${userId}`, flush) : await flush()
          result.saved += batch.saved
          Object.assign(result.outcomes, batch.outcomes)
        } while (addedDuringSync.current.has(userId) && currentUser.current === userId && navigator.onLine)
        if (currentUser.current === userId) {
          const remaining = readQueue(localStorage, userId).length
          setMessage(`${result.saved} scan(s) synchronized. ${remaining} pending.`)
          refresh()
          window.dispatchEvent(new Event('attendance-synced'))
        }
        return result
      } catch (e) {
        if (currentUser.current === userId) setError(e instanceof Error ? e.message : 'Synchronization failed.')
        return { saved: 0, outcomes: {} }
      } finally {
        if (currentUser.current === userId) setSyncing(false)
        if (running.current?.userId === userId) running.current = null
      }
    }
    const promise = execute()
    running.current = { userId, promise }
    return promise
  }, [userId, refresh])

  useEffect(() => {
    refresh()
    setMessage('')
    setSyncing(false)
    void sync()
    const onOnline = () => { setOnline(true); void sync() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh, sync])
  return <SyncContext.Provider value={{ queue: queue.filter(q => q.userId === userId), online, syncing, error, message, legacyQueue, add, sync, removeRejected }}>{children}</SyncContext.Provider>
}
export function useAttendanceSync() {
  const context = useContext(SyncContext)
  if (!context) throw new Error('AttendanceSyncProvider is required')
  return context
}
