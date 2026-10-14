import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Spinner } from '../components/UI'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/utils'
import type { Profile } from '../types/database'

export default function AdminPage() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (profile?.role !== 'admin') return
    let cancelled = false
    supabase.from('profiles').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        setUsers((data || []) as Profile[])
        setError(error ? 'Unable to load users. Please reload to try again.' : null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profile?.role])
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  if (loading) return <Spinner />
  return (
    <div className="page">
      <PageHeader eyebrow="ADMIN" title="Users" description="View registered teachers and administrators." />
      {error ? <p role="alert">{error}</p> : !users.length ? (
        <EmptyState title="No users yet" description="Registered users will appear here." />
      ) : (
        <div className="table-card"><div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>{users.map(user => (
            <tr key={user.id}>
              <td><strong>{user.full_name}</strong><span>{user.email}</span></td>
              <td><span className="badge">{user.role}</span></td>
              <td>{formatDate(user.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  )
}
