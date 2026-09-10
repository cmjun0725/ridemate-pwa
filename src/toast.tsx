/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string; duration: number };

let push: ((item: ToastItem) => void) | null = null;
let nextId = 1;

export function toast(
  text: string,
  kind: ToastKind = "success",
  duration = 2800,
) {
  push?.({ id: nextId++, kind, text, duration });
}

const icons: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    push = (item) => {
      setItems((rows) => [...rows.slice(-3), item]);
      window.setTimeout(() => {
        setItems((rows) => rows.filter((row) => row.id !== item.id));
      }, item.duration);
    };
    return () => {
      push = null;
    };
  }, []);
  const dismiss = (id: number) =>
    setItems((rows) => rows.filter((row) => row.id !== id));
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map((item) => {
        const Icon = icons[item.kind];
        return (
          <div key={item.id} className={`toast ${item.kind}`}>
            <Icon size={17} className="toast-icon" aria-hidden="true" />
            <p>{item.text}</p>
            <button
              type="button"
              aria-label="알림 닫기"
              onClick={() => dismiss(item.id)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
