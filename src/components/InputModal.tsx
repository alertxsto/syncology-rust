import { useEffect, useRef, useState } from "react";
import "./Modal.css";

interface InputModalProps {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: "text" | "textarea" | "date" | "url";
  confirmLabel?: string;
  required?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function InputModal({
  title,
  label,
  placeholder = "",
  defaultValue = "",
  inputType = "text",
  confirmLabel = "Simpan",
  required = true,
  onConfirm,
  onCancel,
}: InputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (required && !value.trim()) { setError("Field ini tidak boleh kosong."); return; }
    onConfirm(value.trim());
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-box modal-sm fade-in">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onCancel}>&#x2715;</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">{label}{required && <span className="req"> *</span>}</label>
            {inputType === "textarea" ? (
              <textarea
                ref={inputRef as any}
                className="form-input form-textarea"
                placeholder={placeholder}
                value={value}
                onChange={e => { setValue(e.target.value); setError(""); }}
                rows={4}
              />
            ) : (
              <input
                ref={inputRef}
                type={inputType}
                className="form-input"
                placeholder={placeholder}
                value={value}
                onChange={e => { setValue(e.target.value); setError(""); }}
              />
            )}
            {error && <span className="form-error-inline">{error}</span>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onCancel}>Batal</button>
            <button type="submit" className="btn-primary">{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
