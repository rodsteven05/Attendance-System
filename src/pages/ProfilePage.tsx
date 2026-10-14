import { useState, type FormEvent } from 'react'
import { KeyRound, Save } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, Field } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/utils'

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [pwMessage, setPwMessage] = useState('')

  const saveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    setMessage('')
    const f = Object.fromEntries(new FormData(e.currentTarget))
    const { error } = await supabase.from('profiles').update({
      full_name: String(f.full_name),
      teacher_id: f.teacher_id ? String(f.teacher_id) : null,
      department: f.department ? String(f.department) : null,
      contact: f.contact ? String(f.contact) : null,
    }).eq('id', profile.id)
    setSaving(false)
    setMessage(error ? error.message : 'Profile updated.')
    if (!error) await refreshProfile()
  }

  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setPwMessage('')
    if (f.get('password') !== f.get('confirm')) { setPwMessage('Passwords do not match.'); return }
    const { error } = await supabase.auth.updateUser({ password: String(f.get('password')) })
    setPwMessage(error ? error.message : 'Password changed.')
    if (!error) e.currentTarget.reset()
  }

  return (
    <div className="page">
      <PageHeader eyebrow="ACCOUNT" title="Teacher profile" description="Manage your account details and password." />
      <div className="dashboard-grid">
        <Card className="chart-card">
          <div className="profile-head">
            <div className="avatar large">{initials(profile?.full_name)}</div>
            <div><h2>{profile?.full_name}</h2><span className="muted">{profile?.email} · {profile?.role}</span></div>
          </div>
          <form className="form-grid" onSubmit={saveProfile} key={profile?.id}>
            <Field label="Full name"><input name="full_name" required defaultValue={profile?.full_name} /></Field>
            <Field label="Teacher ID"><input name="teacher_id" defaultValue={profile?.teacher_id ?? ''} /></Field>
            <Field label="Department"><input name="department" defaultValue={profile?.department ?? ''} /></Field>
            <Field label="Contact number"><input name="contact" type="tel" defaultValue={profile?.contact ?? ''} /></Field>
            <div className="form-actions">
              {message && <span className="muted">{message}</span>}
              <button className="btn primary" disabled={saving}><Save size={17} />{saving ? 'Saving…' : 'Save profile'}</button>
            </div>
          </form>
        </Card>
        <Card className="chart-card">
          <div className="card-heading"><div><span className="eyebrow">SECURITY</span><h2>Change password</h2></div><KeyRound /></div>
          <form className="form-grid" onSubmit={changePassword}>
            <Field label="New password"><input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <Field label="Confirm password"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
            <div className="form-actions">
              {pwMessage && <span className="muted">{pwMessage}</span>}
              <button className="btn primary">Update password</button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}
