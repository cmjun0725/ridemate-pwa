import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function SelectMenu({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="select-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button type="button" ref={trigger} className="select-trigger" aria-label={`${label}: ${options.find(o => o.value === value)?.label ?? "선택"}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      }}>
      <span>{options.find(o => o.value === value)?.label ?? "선택"}</span><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && <div id={id} role="listbox" aria-label={label} className="select-options" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1) % items.length;
      else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else return;
      event.preventDefault(); items[next]?.focus();
    }}>
      {options.map(option => <button type="button" role="option" key={option.value} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}>
        <span>{option.label}</span>{value === option.value && <Check size={17} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
