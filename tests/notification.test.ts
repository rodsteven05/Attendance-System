import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const classId = '33333333-3333-4333-8333-333333333333'
const attendanceId = '44444444-4444-4444-8444-444444444444'
const source = readFileSync('supabase/functions/send-notification/index.ts', 'utf8').replace(/^import .*\r?\n/, '')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function handler(createClient: ReturnType<typeof vi.fn>) {
  let run: (req: Request) => Promise<Response>
  const deno = { env: { get: (key: string) => key }, serve: (callback: typeof run) => { run = callback } }
  new Function('createClient', 'Deno', compiled)(createClient, deno)
  return (body: object) => run(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}
function builder(response: object) {
  const value: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'in', 'order', 'limit', 'is', 'update']) value[name] = vi.fn(() => value)
  value.maybeSingle = vi.fn(async () => response)
  value.single = vi.fn(async () => response)
  value.then = (resolve: (response: object) => unknown) => Promise.resolve(resolve(response))
  return value
}
function caller(allowed: boolean) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'teacher-a' } }, error: null })) }, rpc: vi.fn(async () => ({ data: allowed, error: null })), from: vi.fn(() => builder({ data: { classroom_id: classId }, error: null })) }
}
const notification = { id: 'message', attendance_id: attendanceId, classroom_id: classId, notification_type: 'ATTENDANCE_PRESENT', channel: 'email', parent_contact: 'parent@example.test', message: 'Attendance recorded', processing_at: null }
afterEach(() => vi.unstubAllGlobals())
describe('notification Edge Function', () => {
  it('rejects foreign classroom access before creating a privileged client', async () => {
    const createClient = vi.fn(() => caller(false))
    const response = await handler(createClient)({ classroom_id: classId })
    expect(response.status).toBe(403)
    expect(createClient).toHaveBeenCalledTimes(1)
  })
  it('rejects requests containing both IDs', async () => {
    const createClient = vi.fn(() => caller(true))
    const response = await handler(createClient)({ classroom_id: classId, attendance_id: attendanceId })
    expect(response.status).toBe(400)
    expect(createClient).toHaveBeenCalledTimes(1)
  })
  it('does not send a message already claimed by another request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const responses = [builder({ data: [notification], error: null }), builder({ data: null, error: null })]
    const admin = { from: vi.fn(() => responses.shift()) }
    const createClient = vi.fn().mockReturnValueOnce(caller(true)).mockReturnValueOnce(admin)
    expect(await (await handler(createClient)({ attendance_id: attendanceId })).json()).toMatchObject({ sent: 0, processing: 1 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('delivers a claimed message and records provider acceptance', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch)
    const saved = builder({ data: null, error: null })
    const responses = [builder({ data: [notification], error: null }), builder({ data: { id: 'message' }, error: null }), builder({ data: { status: 'P' }, error: null }), saved]
    const createClient = vi.fn().mockReturnValueOnce(caller(true)).mockReturnValueOnce({ from: vi.fn(() => responses.shift()) })
    expect(await (await handler(createClient)({ attendance_id: attendanceId })).json()).toMatchObject({ sent: 1, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(saved.update).toHaveBeenCalledWith(expect.objectContaining({ delivery_status: 'sent', processing_at: null }))
  })
  it('skips a queued message if attendance was corrected before delivery', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const responses = [builder({ data: [notification], error: null }), builder({ data: { id: 'message' }, error: null }), builder({ data: { status: 'E' }, error: null }), builder({ data: null, error: null })]
    const createClient = vi.fn().mockReturnValueOnce(caller(true)).mockReturnValueOnce({ from: vi.fn(() => responses.shift()) })
    expect(await (await handler(createClient)({ attendance_id: attendanceId })).json()).toMatchObject({ sent: 0, skipped: 1 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves the claim after ambiguous network delivery failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network error') }))
    const saved = builder({ data: null, error: null })
    const responses = [builder({ data: [notification], error: null }), builder({ data: { id: 'message' }, error: null }), builder({ data: { status: 'P' }, error: null }), saved]
    const createClient = vi.fn().mockReturnValueOnce(caller(true)).mockReturnValueOnce({ from: vi.fn(() => responses.shift()) })
    expect(await (await handler(createClient)({ attendance_id: attendanceId })).json()).toMatchObject({ sent: 0, failed: 1 })
    expect(saved.update).toHaveBeenCalledWith({ delivery_status: 'failed', error_message: 'Delivery outcome uncertain; administrator review required before retrying' })
  })
})
