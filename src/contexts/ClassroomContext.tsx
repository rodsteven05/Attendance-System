import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Classroom } from '../types/database'
import { useAuth } from './AuthContext'

interface ClassroomValue { classrooms: Classroom[]; selected: Classroom | null; loading: boolean; select: (id: string) => void; refresh: () => Promise<void> }
const ClassroomContext = createContext<ClassroomValue | null>(null)
export function ClassroomProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth(); const [classrooms, setClassrooms] = useState<Classroom[]>([]); const [selected, setSelected] = useState<Classroom | null>(null); const [loading, setLoading] = useState(true)
  const refresh = async () => { if (!session) { setClassrooms([]); setLoading(false); return }; setLoading(true); const { data } = await supabase.from('classrooms').select('*').order('created_at'); const rows = (data || []) as Classroom[]; setClassrooms(rows); const saved = localStorage.getItem('selected-classroom'); setSelected((current) => rows.find((c) => c.id === (current?.id || saved)) || rows[0] || null); setLoading(false) }
  useEffect(() => { void refresh() }, [session?.user.id])
  const select = (id: string) => { const next = classrooms.find((c) => c.id === id) || null; setSelected(next); if (next) localStorage.setItem('selected-classroom', next.id) }
  return <ClassroomContext.Provider value={{ classrooms, selected, loading, select, refresh }}>{children}</ClassroomContext.Provider>
}
export function useClassroom() { const value = useContext(ClassroomContext); if (!value) throw new Error('useClassroom must be used inside ClassroomProvider'); return value }
