import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, X } from 'lucide-react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon">◇</div><h3>{title}</h3><p>{description}</p>{action}</div> }
export function Spinner() { return <div className="page-loader"><LoaderCircle className="spin" /></div> }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></div>{children}</div></div> }
export function StatusBadge({ status }: { status: string }) { const labels: Record<string, string> = { P: 'Present', L: 'Late', A: 'Absent', E: 'Excused', active: 'Active', inactive: 'Inactive', queued: 'Queued', sent: 'Sent', failed: 'Failed' }; return <span className={`badge status-${status.toLowerCase()}`}>{labels[status] || status}</span> }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }

export function AnimatedNumber({ value, duration = 600 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    const diff = value - start
    if (!diff) return
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min((t - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(start + diff * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{display}</>
}

export function ChartTip({ active, payload, label, unit = '' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <span className="chart-tip-label">{label}</span>
      {payload.map((p: any) => (
        <span key={p.dataKey} className="chart-tip-row">
          <i style={{ background: p.color || p.fill }} />
          {p.name}: <strong>{p.value}{unit}</strong>
        </span>
      ))}
    </div>
  )
}
