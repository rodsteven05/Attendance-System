import type { ReactNode } from 'react'
import { useClassroom } from '../contexts/ClassroomContext'
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { const { selected } = useClassroom(); return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="header-actions">{selected && <span className="context-pill">{selected.subject} · {selected.section}</span>}{actions}</div></header> }
