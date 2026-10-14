import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Spinner, StatusBadge } from '../components/UI'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import { formatDate, formatTime } from '../lib/utils'
import { toast } from '../lib/feedback'
import { allRows } from '../lib/query'
import type { Notification } from '../types/database'
export default function NotificationsPage() {
  const { selected } = useClassroom()
  const [rows, setRows] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    setRows([]); setError(null)
    if (!selected) { setLoading(false); return }
    setLoading(true)
    allRows<Notification>((from, to) => supabase.from('notifications').select('*,student:students(*)').eq('classroom_id', selected.id).order('created_at', { ascending: false }).order('id').range(from, to))
      .then(data => { if (!cancelled) setRows(data) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected, revision])
  const retry = useCallback(async () => {
    if (!selected) return
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke('send-notification', { body: { classroom_id: selected.id } })
      if (error) throw new Error(error.message)
      toast.info(`${data?.sent || 0} sent; ${data?.failed || 0} failed; ${data?.processing || 0} in progress or awaiting review. Up to 100 messages are attempted per batch.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to retry messages.') }
    finally { setSending(false); setRevision(value => value + 1) }
  }, [selected])
  return <div className="page">
    <PageHeader eyebrow="PARENT COMMUNICATION" title="Notifications" description="Review queued messages and provider delivery results. Sent means accepted by the provider; it does not confirm the parent has read it."
      actions={<><button className="btn secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button><button className="btn primary" disabled={!selected || sending || !rows.some(n => ['queued', 'failed'].includes(n.delivery_status) && !n.processing_at)} onClick={() => void retry()}>{sending ? 'Sending…' : 'Retry pending messages'}</button></>} />
    {loading ? <Spinner /> : error ? <p role="alert">{error}</p> : !rows.length ? <EmptyState title="No notifications yet" description="Attendance messages and absence warnings will appear here." /> : <div className="table-card"><div className="table-wrap"><table>
      <thead><tr><th>Student</th><th>Type</th><th>Channel</th><th>Status</th><th>Created</th><th>Message</th></tr></thead>
      <tbody>{rows.map(n => <tr key={n.id}><td><strong>{n.student?.full_name}</strong></td><td>{n.notification_type.replaceAll('_', ' ')}</td><td>{n.channel.toUpperCase()}</td><td><StatusBadge status={n.delivery_status} />{n.processing_at && <span>In progress / administrator review required if stalled</span>}{n.error_message && <span>{n.error_message}</span>}</td><td>{formatDate(n.created_at)} {formatTime(n.created_at)}</td><td className="message-cell">{n.message}</td></tr>)}</tbody>
    </table></div></div>}
  </div>
}
