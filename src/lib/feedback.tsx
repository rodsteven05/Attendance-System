import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; text: string }
type PromptRequest = { title: string; label?: string; placeholder?: string; required?: boolean; resolve: (v: string | null) => void }

let pushToast: ((kind: ToastKind, text: string) => void) | null = null
let openPrompt: ((req: PromptRequest) => void) | null = null
let nextId = 1

export const toast = {
  success: (text: string) => pushToast?.('success', text),
  error: (text: string) => pushToast?.('error', text),
  info: (text: string) => pushToast?.('info', text),
}

export function promptDialog(opts: { title: string; label?: string; placeholder?: string; required?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    if (openPrompt) openPrompt({ ...opts, resolve })
    else resolve(window.prompt(opts.title))
  })
}

const icons = { success: CheckCircle2, error: TriangleAlert, info: Info }

export function FeedbackProvider() {
  const [items, setItems] = useState<ToastItem[]>([])
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId++
    setItems((list) => [...list, { id, kind, text }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500)
  }, [])

  useEffect(() => {
    pushToast = push
    openPrompt = (req) => { setValue(''); setPrompt(req) }
    return () => { pushToast = null; openPrompt = null }
  }, [push])

  useEffect(() => { if (prompt) setTimeout(() => inputRef.current?.focus(), 60) }, [prompt])

  const close = (v: string | null) => { prompt?.resolve(v); setPrompt(null) }

  return (
    <>
      <div className="toast-stack">
        {items.map((t) => {
          const Icon = icons[t.kind]
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon size={18} />
              <span>{t.text}</span>
              <button className="icon-btn" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><X size={15} /></button>
            </div>
          )
        })}
      </div>
      {prompt && (
        <div className="modal-backdrop" onMouseDown={() => close(null)}>
          <form className="modal prompt-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (prompt.required && !value.trim()) return; close(value.trim() || null) }}>
            <div className="modal-header"><h2>{prompt.title}</h2></div>
            {prompt.label && <span className="field">{prompt.label}</span>}
            <input ref={inputRef} className="prompt-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={prompt.placeholder} />
            <div className="form-actions">
              <button type="button" className="btn secondary" onClick={() => close(null)}>Cancel</button>
              <button type="submit" className="btn primary">Confirm</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
