import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./Modal.css";

interface ProposeTaskModalProps {
  roomId: string;
  members: any[];
  onClose: () => void;
  onSuccess: () => void;
}

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Very Hard"];
const CATEGORIES = [
  { value: "technical", label: "Technical" },
  { value: "management", label: "Management" },
];

export default function ProposeTaskModal({ roomId, members, onClose, onSuccess }: ProposeTaskModalProps) {
  const [title, setTitle]           = useState("");
  const [description, setDesc]      = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [category, setCategory]     = useState("technical");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline]     = useState(new Date().toISOString().substring(0, 10));
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Judul task tidak boleh kosong."); return; }
    setLoading(true);
    setError("");
    try {
      await invoke("add_task", {
        title: title.trim(),
        description: description.trim(),
        assignedToId: assignedTo,
        difficulty,
        category,
        internalDeadline: deadline,
        roomId,
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
          <span className="modal-title">Propose Task</span>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">&#x2715;</button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          {/* Title */}
          <div className="form-field">
            <label className="form-label">Judul Task <span className="req">*</span></label>
            <input
              className="form-input"
              type="text"
              placeholder="cth: Buat endpoint login"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="form-field">
            <label className="form-label">Deskripsi</label>
            <textarea
              className="form-input form-textarea"
              placeholder="Konteks, acceptance criteria, referensi..."
              value={description}
              onChange={e => setDesc(e.target.value)}
              rows={3}
            />
          </div>

          {/* Difficulty + Assigned — 2 col */}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Difficulty</label>
              <div className="diff-group">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`diff-btn ${difficulty === d ? "active" : ""}`}
                    onClick={() => setDifficulty(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">Assign ke (opsional)</label>
              <select className="form-input" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">Open Pool</option>
                {members.map(m => (
                  <option key={m.id} value={m.uid}>{m.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category */}
          <div className="form-field">
            <label className="form-label">Kategori</label>
            <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Deadline */}
          <div className="form-field">
            <label className="form-label">Deadline</label>
            <input
              className="form-input"
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Batal
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Menyimpan..." : "Propose Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
