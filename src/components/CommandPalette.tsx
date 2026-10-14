import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import { useClassroom } from '../contexts/ClassroomContext'
import { supabase } from '../lib/supabase'
import type { Student } from '../types/database'

const PAGES = [
  { to: '/', label: 'Dashboard', group: 'Pages' },
  { to: '/classrooms', label: 'My Classrooms', group: 'Pages' },
  { to: '/scan', label: 'Scan Attendance', group: 'Pages' },
  { to: '/students', label: 'Students', group: 'Pages' },
  { to: '/attendance', label: 'Attendance Records', group: 'Pages' },
  { to: '/qr-codes', label: 'QR Codes', group: 'Pages' },
  { to: '/excuses', label: 'Excuses', group: 'Pages' },
  { to: '/notifications', label: 'Notifications', group: 'Pages' },
  { to: '/reports', label: 'Reports', group: 'Pages' },
  { to: '/analytics', label: 'Analytics', group: 'Pages' },
  { to: '/settings', label: 'Settings', group: 'Pages' },
  { to: '/profile', label: 'Teacher Profile', group: 'Pages' },
]

type Item = { key: string; label: string; hint: string; group: string; run: () => void }

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [students, setStudents] = useState<Student[]>([])
  const { classrooms, selected, select } = useClassroom()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setTimeout(() => inputRef.current?.focus(), 40)
    if (!selected) { setStudents([]); return }
    supabase.from('classroom_students').select('student:students(*)').eq('classroom_id', selected.id).eq('enrollment_status', 'active')
      .then(({ data }) => setStudents(((data || []) as unknown as { student: Student }[]).map((r) => r.student)))
  }, [open, selected?.id])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const list: Item[] = [
      ...PAGES.map((p) => ({ key: `p${p.to}`, label: p.label, hint: 'Go to page', group: 'Pages', run: () => navigate(p.to) })),
      ...classrooms.map((c) => ({ key: `c${c.id}`, label: `${c.subject} – ${c.classroom_name}`, hint: `Switch classroom · ${c.section}`, group: 'Classrooms', run: () => select(c.id) })),
      ...students.map((s) => ({ key: `s${s.id}`, label: s.full_name, hint: `Student · ${s.student_number}`, group: 'Students', run: () => navigate('/students', { state: { search: s.student_number } }) })),
    ]
    return q ? list.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q)) : list
  }, [query, classrooms, students, navigate, select])

  const groups = useMemo(() => {
    const out: { name: string; rows: { item: Item; index: number }[] }[] = []
    items.forEach((item, index) => {
      const g = out.find((x) => x.name === item.group)
      if (g) g.rows.push({ item, index })
      else out.push({ name: item.group, rows: [{ item, index }] })
    })
    return out
  }, [items])

  const pick = (item: Item) => { setOpen(false); item.run() }

  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Search size={18} /><input ref={inputRef} value={query} placeholder="Search pages, classrooms, students…" onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === 'Enter' && items[cursor]) pick(items[cursor])
          }} />
          <kbd>ESC</kbd>
        </div>
        <div className="palette-list">
          {!items.length && <p className="palette-empty">No results for “{query}”.</p>}
          {groups.map((g) => (
            <div key={g.name}>
              <span className="palette-group">{g.name}</span>
              {g.rows.map(({ item, index }) => (
                <button key={item.key} className={`palette-item ${index === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(index)} onClick={() => pick(item)}>
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
