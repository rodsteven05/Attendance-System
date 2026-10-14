import { ChevronDown } from 'lucide-react'
import { useClassroom } from '../contexts/ClassroomContext'
export function ClassroomSelect() { const { classrooms, selected, select } = useClassroom(); return <div className="classroom-select"><select value={selected?.id || ''} onChange={(e) => select(e.target.value)} aria-label="Selected classroom"><option value="" disabled>Select classroom</option>{classrooms.map((c) => <option key={c.id} value={c.id}>{c.subject} – {c.classroom_name} ({c.section})</option>)}</select><ChevronDown size={16} /></div> }
