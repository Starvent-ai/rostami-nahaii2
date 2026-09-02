import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useNotificationBridge } from '../lib/useClubEvent';
import './ToastHost.css';

export function ToastHost() {
  useNotificationBridge();
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} title={t.title} body={t.body} level={t.level} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  title,
  body,
  level,
  onDismiss,
}: {
  id: number;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'danger';
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), 6000);
    return () => clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div className={`toast toast-${level}`}>
      <div className="toast-title">{title}</div>
      <div className="toast-body">{body}</div>
      <button className="toast-close" onClick={() => onDismiss(id)}>
        ×
      </button>
    </div>
  );
}
