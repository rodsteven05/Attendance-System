import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface AuthValue { session: Session | null; profile: Profile | null; loading: boolean; signOut: () => Promise<void>; refreshProfile: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const [profile, setProfile] = useState<Profile | null>(null); const [loading, setLoading] = useState(true)
  const loadProfile = async (id?: string) => { if (!id) { setProfile(null); return }; const { data } = await supabase.from('profiles').select('*').eq('id', id).single(); setProfile(data as Profile | null) }
  useEffect(() => { supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); await loadProfile(data.session?.user.id); setLoading(false) }); const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); void loadProfile(next?.user.id) }); return () => data.subscription.unsubscribe() }, [])
  return <AuthContext.Provider value={{ session, profile, loading, signOut: async () => { await supabase.auth.signOut() }, refreshProfile: () => loadProfile(session?.user.id) }}>{children}</AuthContext.Provider>
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value }
