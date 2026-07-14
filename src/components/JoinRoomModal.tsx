import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./Modal.css";

interface JoinRoomModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function JoinRoomModal({ onClose, onSuccess }: JoinRoomModalProps) {
  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError("Kode room tidak boleh kosong."); return; }
    if (trimmed.length !== 6) { setError("Kode room harus 6 karakter."); return; }
    setLoading(true); setError("");
    try {
      await invoke("join_room", { roomCode: trimmed });
      onSuccess();
    } catch (e: any) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box modal-sm fade-in">
        <div className="modal-header">
          <span className="modal-title">Gabung Room</span>
          <button className="modal-close" onClick={onClose}>&#x2715;</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Kode Room <span className="req">*</span></label>
            <input
              ref={inputRef}
              type="text"
              className="form-input"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.15em", textTransform: "uppercase", fontSize: "18px", textAlign: "center" }}
              placeholder="XXXXXX"
              maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(""); }}
            />
            <span style={{ fontSize: "11px", color: "var(--text-3)" }}>6 karakter, huruf kapital &amp; angka</span>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Bergabung..." : "Gabung"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
