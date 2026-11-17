/** Стек уведомлений (правый нижний угол). */
export interface Toast {
  id: number
  kind: 'ok' | 'warn' | 'error'
  text: string
}
export type ToastKind = Toast['kind']

export default function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
