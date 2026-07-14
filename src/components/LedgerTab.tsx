import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Member, Task } from "@/types";
import { cx } from "@/lib/utils";
import "./Ledger.css";

interface LedgerTabProps {
  roomId: string | null;
  onMemberClick?: (uid: string) => void;
}

export default function LedgerTab({ roomId, onMemberClick }: LedgerTabProps) {
  const [viewMode, setViewMode] = useState<"contribution" | "leaderboard">("leaderboard");
  const [members, setMembers]   = useState<Member[]>([]);
  const [tasks, setTasks]       = useState<Task[]>([]);

  const loadData = async () => {
    if (!roomId) return;
    try {
      const [fetchedMembers, fetchedTasks] = await Promise.all([
        invoke<Member[]>("get_members", { roomId }),
        invoke<Task[]>("get_tasks",   { roomId }),
      ]);
      setMembers(fetchedMembers);
      setTasks(fetchedTasks);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadData(); }, [roomId]);

  if (!roomId) {
    return <div style={{ color: "var(--text-3)", padding: "40px 0", textAlign: "center", fontSize: "13px" }}>Pilih room dari My Rooms.</div>;
  }

  const totalPts  = members.reduce((s, m) => s + (m.total_pts || 0), 0);
  const ghostIds  = new Set(tasks.filter(t => t.escalation_level === 3).map(t => t.assigned_to_id));
  const completedBy: Record<string, number> = {};
  tasks.filter(t => t.status === "completed").forEach(t => {
    completedBy[t.assigned_to_id] = (completedBy[t.assigned_to_id] || 0) + 1;
  });
  const sorted = [...members].sort((a, b) => (b.total_pts || 0) - (a.total_pts || 0));

  const exportCSV = () => {
    const headers = ["Rank", "Name", "Role", "Total Points", "Tasks Completed", "Nudge Points", "Is Ghost"];
    const rows = sorted.map((m, i) => [
      i + 1,
      m.display_name,
      m.role,
      m.total_pts || 0,
      completedBy[m.uid] || 0,
      m.nudge_pts || 0,
      ghostIds.has(m.uid) ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-${roomId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ledger-container fade-in">
      {/* Header */}
      <div className="ledger-header">
        <h2>Accountability Ledger</h2>
        <div className="ledger-toggle">
          <button
            className={cx("ledger-toggle-btn", viewMode === "leaderboard" && "active")}
            onClick={() => setViewMode("leaderboard")}
          >
            Leaderboard
          </button>
          <button
            className={cx("ledger-toggle-btn", viewMode === "contribution" && "active")}
            onClick={() => setViewMode("contribution")}
          >
            Kontribusi
          </button>
          <button
            className="ledger-toggle-btn"
            onClick={exportCSV}
            title="Export to CSV"
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="summary-lbl">Total poin tim: {totalPts} pts · {sorted.length} member</div>

      {sorted.length === 0 && (
        <div className="empty-state">Belum ada anggota.</div>
      )}

      {/* ── Leaderboard ── */}
      {viewMode === "leaderboard" && sorted.length > 0 && (
        <div className="leaderboard-list">
          {sorted.map((m, idx) => {
            const rank  = idx + 1;
            const isTop = rank === 1;
            return (
              <div
                key={m.id}
                className={cx("leaderboard-row", isTop && "top-rank")}
                onClick={() => onMemberClick?.(m.uid)}
                style={{ cursor: onMemberClick ? "pointer" : "default" }}
              >
                <span className={cx("rank-num", isTop && "top")}>{rank < 10 ? `0${rank}` : rank}</span>
                <div className="lb-avatar">{m.display_name.charAt(0).toUpperCase()}</div>
                <div className="ledger-info">
                  <div className="name-row">
                    <span className={cx("name", isTop && "top")}>{m.display_name}</span>
                    {m.role === "leader"  && <span className="badge leader">Leader</span>}
                    {ghostIds.has(m.uid) && <span className="badge ghost">Ghost</span>}
                  </div>
                  <div className="sub-info">{completedBy[m.uid] || 0} task selesai</div>
                </div>
                <div className={cx("rank-pts", isTop && "top")}>{m.total_pts || 0} pts</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Contribution ── */}
      {viewMode === "contribution" && sorted.length > 0 && (
        <div className="ledger-content">
          {sorted.map(m => {
            const pct = totalPts > 0 ? ((m.total_pts || 0) / totalPts) * 100 : 0;
            return (
              <div
                key={m.id}
                className="ledger-row"
                onClick={() => onMemberClick?.(m.uid)}
                style={{ cursor: onMemberClick ? "pointer" : "default" }}
              >
                <div className="ledger-avatar">{m.display_name.charAt(0).toUpperCase()}</div>
                <div className="ledger-info">
                  <div className="name-row">
                    <span className="name">{m.display_name}</span>
                    {m.role === "leader"  && <span className="badge leader">Leader</span>}
                    {ghostIds.has(m.uid) && <span className="badge ghost">Ghost</span>}
                  </div>
                  <div className="sub-info">{m.total_pts || 0} pts · {completedBy[m.uid] || 0} selesai</div>
                </div>
                <div className="progress-col">
                  <div className="progress-bar">
                    <div className="progress-chunk" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pct">{pct.toFixed(1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
