import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const T = '55555555-5555-4555-8555-555555555555'
let db: PGlite
async function asTeacher(id = A) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;`)
}
async function rejected(sql: string) {
  await db.exec('savepoint expected_error')
  let error: unknown
  try { await db.exec(sql) } catch (e) { error = e }
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error')
  return error
}
async function scalar(sql: string) { return (await db.query<Record<string, unknown>>(sql)).rows[0]?.value }
const yesterday = "((now() at time zone 'Asia/Manila')::date - 1)"
const scanTime = `(${yesterday} + time '08:00') at time zone 'Asia/Manila'`
describe('PostgreSQL migrations and authorization', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
      alter default privileges in schema public grant usage, select on sequences to authenticated;
      create publication supabase_realtime;
    `)
    for (const file of readdirSync(resolve('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
      // PGlite provides gen_random_uuid natively; pgcrypto isn't needed by these migrations.
      const sql = readFileSync(resolve('supabase/migrations', file), 'utf8').replace('create extension if not exists pgcrypto;', '')
      try { await db.exec(sql) } catch (e) { throw new Error(`Migration ${file}: ${String(e)}`) }
    }
    await db.exec(`
      insert into auth.users(id,email) values ('${A}','teacher-a@example.test'),('${B}','teacher-b@example.test');
      insert into public.classrooms(id,teacher_id,classroom_name,subject,grade_level,section,school_year,semester,start_time,late_threshold,attendance_cutoff,teaching_days,created_at,absence_warning_threshold)
      values ('${C}','${A}','Test class','Math','4','A','2026','First','00:00','23:58','23:59',array[0,1,2,3,4,5,6],now()-interval '40 days',1);
      insert into public.students(id,student_number,first_name,last_name,grade_level,section,parent_name,parent_phone,qr_token,created_by)
      values ('${S}','001','Alice','Student','4','A','Parent','+639000000000','${T}','${A}');
      insert into public.classroom_students(classroom_id,student_id,enrolled_at) values ('${C}','${S}',now()-interval '30 days');
    `)
  })
  beforeEach(async () => { await db.exec('begin'); await asTeacher() })
  afterEach(async () => { await db.exec('rollback; reset role;') })
  afterAll(async () => { await db?.close() })
  it('removes subscriptions and blocks teacher self-promotion', async () => {
    expect(await scalar("select count(*)::integer as value from information_schema.columns where table_name='profiles' and column_name like 'subscription_%'")).toBe(0)
    expect(String(await rejected(`update public.profiles set role='admin' where id='${A}'`))).toContain('Only administrators')
    await db.exec(`update public.profiles set full_name='Updated Teacher' where id='${A}'`)
    expect(await scalar(`select full_name as value from public.profiles where id='${A}'`)).toBe('Updated Teacher')
  })
  it('rejects access to another teacher’s class, students, scans, and finalization', async () => {
    await asTeacher(B)
    expect(await scalar(`select count(*)::integer as value from public.students where id='${S}'`)).toBe(0)
    await db.exec(`update public.students set first_name='Wrong' where id='${S}'`)
    expect(await rejected(`select public.record_qr_attendance('${C}','${T}',${scanTime})`)).toBeTruthy()
    expect(await rejected(`select public.mark_classroom_absences('${C}',${yesterday})`)).toBeTruthy()
    expect(await rejected(`insert into public.students(student_number,first_name,last_name,grade_level,section,parent_name,parent_phone,created_by) values('002','Bad','Creator','4','A','Parent','123','${A}')`)).toBeTruthy()
  })
  it('records a scan once and queues one notification even on duplicate retry', async () => {
    const first = await db.query(`select * from public.record_qr_attendance('${C}','${T}',${scanTime})`)
    expect(first.rows[0]).toMatchObject({ duplicate: false, status: 'P' })
    const second = await db.query(`select * from public.record_qr_attendance('${C}','${T}',${scanTime})`)
    expect(second.rows[0]).toMatchObject({ duplicate: true, status: 'P' })
    expect(await scalar('select count(*)::integer as value from public.attendance')).toBe(1)
    expect(await scalar('select count(*)::integer as value from public.notifications')).toBe(1)
  })
  it('allows owned student creation, enrollment, and edits without changing ownership', async () => {
    const studentId = await scalar(`insert into public.students(student_number,first_name,last_name,grade_level,section,parent_name,parent_phone,created_by) values('002','New','Student','4','A','Parent','123','${A}') returning id as value`)
    await db.exec(`insert into public.classroom_students(classroom_id,student_id) values('${C}','${studentId}')`)
    await db.exec(`update public.students set first_name='Edited' where id='${studentId}'`)
    expect(await scalar(`select first_name as value from public.students where id='${studentId}'`)).toBe('Edited')
    expect(String(await rejected(`update public.students set created_by='${B}' where id='${studentId}'`))).toContain('creator cannot be changed')
  })
  it('rejects non-teaching dates and future finalization', async () => {
    await db.exec(`update public.classrooms set no_class_dates=array[${yesterday}] where id='${C}'`)
    expect(String(await rejected(`select public.mark_classroom_absences('${C}',${yesterday})`))).toContain('not a scheduled class day')
    expect(String(await rejected(`select public.record_qr_attendance('${C}','${T}',${scanTime})`))).toContain('not a scheduled class day')
    expect(String(await rejected(`select public.mark_classroom_absences('${C}',(now() at time zone 'Asia/Manila')::date+1)`))).toContain('future')
    await db.exec(`update public.classrooms set teaching_days='{}' where id='${C}'`)
    expect(String(await rejected(`select public.mark_classroom_absences('${C}',${yesterday})`))).toContain('Set teaching days')
  })
  it('finalizes once, audits corrections, and files excuses atomically', async () => {
    expect(await scalar(`select public.mark_classroom_absences('${C}',${yesterday}) as value`)).toBe(1)
    expect(await scalar(`select public.mark_classroom_absences('${C}',${yesterday}) as value`)).toBe(0)
    const id = await scalar('select id as value from public.attendance limit 1')
    expect(await rejected(`update public.attendance set status='P' where id='${id}'`)).toBeTruthy()
    expect(await rejected(`select public.correct_attendance('${id}','P','','A')`)).toBeTruthy()
    await db.exec(`select public.correct_attendance('${id}','E','Medical appointment','A','Document reviewed')`)
    expect(await scalar('select count(*)::integer as value from public.excuses')).toBe(1)
    const history = await db.query('select old_status,new_status,reason,actor_id from public.attendance_history')
    expect(history.rows[0]).toMatchObject({ old_status: 'A', new_status: 'E', reason: 'Medical appointment', actor_id: A })
    expect(String(await rejected(`select public.correct_attendance('${id}','P','Stale correction','A')`))).toContain('Attendance changed')
    expect(await scalar("select count(*)::integer as value from public.notifications where delivery_status='skipped'")).toBe(1)
    await db.exec(`select public.correct_attendance('${id}','A','Excuse withdrawn','E')`)
    expect(await scalar('select count(*)::integer as value from public.excuses')).toBe(0)
    expect(await scalar("select count(*)::integer as value from public.notifications where delivery_status='queued'")).toBe(1)
    await asTeacher(B)
    expect(await scalar('select count(*)::integer as value from public.attendance_history')).toBe(0)
    expect(await rejected(`select public.correct_attendance('${id}','P','Other teacher','E')`)).toBeTruthy()
  })
  it('does not mark future enrollments or inactive students absent', async () => {
    await db.exec(`update public.classroom_students set enrolled_at=now() where classroom_id='${C}'`)
    expect(await scalar(`select public.mark_classroom_absences('${C}',${yesterday}) as value`)).toBe(0)
    await db.exec(`update public.classroom_students set enrolled_at=now()-interval '30 days' where classroom_id='${C}'; update public.students set status='inactive' where id='${S}'`)
    expect(await scalar(`select public.mark_classroom_absences('${C}',${yesterday}) as value`)).toBe(0)
  })
})
