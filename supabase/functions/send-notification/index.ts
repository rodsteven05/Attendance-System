import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
async function deliver(channel: string, contact: string, subject: string, message: string) {
  if (channel === 'email') {
    const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('RESEND_FROM_EMAIL')
    if (!key || !from) throw new Error('Email delivery is not configured')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: contact, subject, text: message }),
    })
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`)
  } else {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID'), token = Deno.env.get('TWILIO_AUTH_TOKEN'), from = Deno.env.get('TWILIO_FROM_NUMBER')
    if (!sid || !token || !from) throw new Error('SMS delivery is not configured')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: contact, From: from, Body: message }),
    })
    if (!res.ok) throw new Error(`SMS provider rejected the message (${res.status})`)
  }
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Unauthorized' }, 401)
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)
  let payload: { classroom_id?: string; attendance_id?: string }
  try { payload = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!payload || (!!payload.classroom_id === !!payload.attendance_id) || !uuid.test(payload.classroom_id || payload.attendance_id || '')) return json({ error: 'Provide one classroom or attendance ID' }, 400)
  let classroomId = payload.classroom_id
  if (payload.attendance_id) {
    const { data, error } = await client.from('attendance').select('classroom_id').eq('id', payload.attendance_id).single()
    if (error || !data) return json({ error: 'Attendance unavailable' }, 404)
    classroomId = data.classroom_id
  }
  // Authorize the caller before using privileged database credentials.
  const { data: allowed, error: accessError } = await client.rpc('owns_classroom', { classroom: classroomId })
  if (accessError || allowed !== true) return json({ error: 'Classroom unavailable' }, 403)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let query = admin.from('notifications').select('*').eq('classroom_id', classroomId).in('delivery_status', ['queued', 'failed']).order('created_at').limit(100)
  if (payload.attendance_id) query = query.eq('attendance_id', payload.attendance_id)
  const { data: pending, error } = await query
  if (error) return json({ error: 'Could not load notifications' }, 500)
  let sent = 0, failed = 0, processing = 0, skipped = 0
  for (const notification of pending || []) {
    if (notification.processing_at) { processing++; continue }
    const { data: claimed, error: claimError } = await admin.from('notifications')
      .update({ processing_at: new Date().toISOString(), error_message: null })
      .eq('id', notification.id).is('processing_at', null).in('delivery_status', ['queued', 'failed']).select('id').maybeSingle()
    if (claimError || !claimed) { processing++; continue }
    if (notification.notification_type === 'THREE_ABSENCES_WARNING') {
      const { count, error: countError } = await admin.from('attendance').select('id', { count: 'exact', head: true }).eq('classroom_id', classroomId).eq('student_id', notification.student_id).eq('status', 'A')
      if (countError) {
        await admin.from('notifications').update({ processing_at: null, error_message: 'Unable to verify absence count' }).eq('id', notification.id)
        failed++; continue
      }
      if ((count || 0) < notification.threshold_count) {
        await admin.from('notifications').update({ delivery_status: 'skipped', processing_at: null, error_message: 'Absence count changed after a correction' }).eq('id', notification.id)
        skipped++; continue
      }
    }
    if (notification.notification_type === 'ATTENDANCE_PRESENT' || notification.notification_type === 'ATTENDANCE_LATE') {
      const { data: attendance, error: attendanceError } = await admin.from('attendance').select('status').eq('id', notification.attendance_id).maybeSingle()
      if (attendanceError) {
        await admin.from('notifications').update({ processing_at: null, error_message: 'Unable to verify attendance' }).eq('id', notification.id)
        failed++; continue
      }
      const expected = notification.notification_type === 'ATTENDANCE_LATE' ? 'L' : 'P'
      if (attendance?.status !== expected) {
        await admin.from('notifications').update({ delivery_status: 'skipped', processing_at: null, error_message: 'Attendance was corrected before delivery' }).eq('id', notification.id)
        skipped++; continue
      }
    }
    let accepted = false
    try {
      await deliver(notification.channel, notification.parent_contact, notification.notification_type === 'THREE_ABSENCES_WARNING' ? 'Absence warning' : 'Attendance update', notification.message)
      accepted = true
      const { error: saveError } = await admin.from('notifications').update({ delivery_status: 'sent', sent_at: new Date().toISOString(), processing_at: null, error_message: null }).eq('id', notification.id)
      if (saveError) throw new Error('Delivery status needs administrator review')
      sent++
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Delivery failed'
      // Preserve ambiguous claims instead of automatically duplicating a message.
      const uncertain = accepted || e instanceof TypeError
      await admin.from('notifications').update({ delivery_status: 'failed', error_message: uncertain ? 'Delivery outcome uncertain; administrator review required before retrying' : message, ...(uncertain ? {} : { processing_at: null }) }).eq('id', notification.id)
      failed++
    }
  }
  return json({ sent, failed, processing, skipped, attempted: (pending || []).length })
})
