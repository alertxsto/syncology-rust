import { useState, useEffect, useMemo } from "react";
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
  const [tasks, setTasks]           = useState<any[]>([]);

  // Fetch tasks in room to calculate workloads
  useEffect(() => {
    invoke<any[]>("get_tasks", { roomId })
      .then(setTasks)
      .catch(console.error);
  }, [roomId]);

  // Deduplicate members list
  const uniqueMembers = useMemo(() => {
    return members.reduce<any[]>((acc, current) => {
      if (!acc.some((item) => item.uid === current.uid)) {
        acc.push(current);
      }
      return acc;
    }, []);
  }, [members]);

  // Calculate workloads (active points) per member
  const memberWorkloads = useMemo(() => {
    const map: Record<string, number> = {};
    uniqueMembers.forEach((m) => {
      map[m.uid] = 0;
    });
    tasks.forEach((t) => {
      if (t.status !== "completed" && t.assigned_to_id) {
        map[t.assigned_to_id] = (map[t.assigned_to_id] || 0) + (t.weight || 10);
      }
    });
    return map;
  }, [uniqueMembers, tasks]);

  // Get member with the lowest workload
  const recommendation = useMemo(() => {
    if (uniqueMembers.length === 0) return null;
    let minPoints = Infinity;
    let bestMember: any = null;

    uniqueMembers.forEach((m) => {
      const pts = memberWorkloads[m.uid] || 0;
      if (pts < minPoints) {
        minPoints = pts;
        bestMember = m;
      }
    });

    return bestMember ? { member: bestMember, points: minPoints } : null;
  }, [uniqueMembers, memberWorkloads]);

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
      <div className="modal-box fade-in" style={{ maxWidth: 580 }}>
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
                <option value="">Open Pool (Unassigned)</option>
                {uniqueMembers.map(m => {
                  const pts = memberWorkloads[m.uid] || 0;
                  const indicator = pts > 25 ? "🔴 Overload" : pts > 12 ? "🟡 Normal" : "🟢 Ringan";
                  return (
                    <option key={m.id} value={m.uid}>
                      {m.display_name} ({indicator}: {pts} pt aktif)
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Smart Recommendation Banner */}
          {recommendation && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px dashed var(--green)",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "12px",
                color: "var(--text-1)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "16px",
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontSize: "16px" }}>🟢</span>
              <span>
                <strong>Saran Load Balancer:</strong> Direkomendasikan ditugaskan ke <strong>{recommendation.member.display_name}</strong> karena memiliki beban kerja paling ringan saat ini (<strong>{recommendation.points} pt</strong> aktif).
              </span>
            </div>
          )}

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
