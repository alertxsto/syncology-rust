import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./Modal.css";

interface CreateRoomModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateRoomModal({ onClose, onSuccess }: CreateRoomModalProps) {
  const [name, setName]         = useState("");
  const [deadline, setDeadline] = useState("");
  const [chatUrl, setChatUrl]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Nama project tidak boleh kosong."); return; }
    setLoading(true); setError("");
    try {
      await invoke("create_room", {
        projectName: name.trim(),
        globalDeadline: deadline || null,
        externalChatUrl: chatUrl || null,
      });
      onSuccess();
    } catch (e: any) {
      setError(typeof e === "string" ? e : JSON.stringify(e));
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box fade-in">
        <div className="modal-header">
          <span className="modal-title">Buat Room Baru</span>
          <button className="modal-close" onClick={onClose}>&#x2715;</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Nama Project <span className="req">*</span></label>
            <input ref={inputRef} type="text" className="form-input" placeholder="cth: Website Redesign Q3" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Deadline Global (opsional)</label>
            <input type="date" className="form-input" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Link Grup Chat (opsional)</label>
            <input type="url" className="form-input" placeholder="https://wa.me/... atau https://discord.gg/..." value={chatUrl} onChange={e => setChatUrl(e.target.value)} />
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>Batal</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Membuat..." : "Buat Room"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
