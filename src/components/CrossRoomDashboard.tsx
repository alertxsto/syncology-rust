import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Room, Task } from "@/types";
import { cx, formatDate, daysUntil } from "@/lib/utils";
import "./CrossRoomDashboard.css";

interface CrossRoomDashboardProps {
  currentUser: { uid: string; displayName: string };
  onSelectRoom: (room: Room) => void;
  onRefreshRooms: () => void;
  rooms: Room[];
}

interface RoomSummary {
  room: Room;
  myTasks: Task[];
  myOpen: number;
  myReview: number;
  myDone: number;
  myGhostAlerts: number;
  myOverdue: number;
}

export default function CrossRoomDashboard({ currentUser, onSelectRoom, rooms }: CrossRoomDashboardProps) {
  const [summaries, setSummaries] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (rooms.length === 0) {
      setSummaries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results: RoomSummary[] = [];
      for (const room of rooms) {
        try {
          const tasks = await invoke<Task[]>("get_tasks", { roomId: room.id });
          const myTasks = tasks.filter(t => t.assigned_to_id === currentUser.uid || t.assigned_reviewer_id === currentUser.uid);
          results.push({
            room,
            myTasks,
            myOpen:   myTasks.filter(t => ["todo", "proposed", "disputed"].includes(t.status)).length,
            myReview: myTasks.filter(t => t.status === "under_review" && t.assigned_reviewer_id === currentUser.uid).length,
            myDone:   myTasks.filter(t => t.status === "completed").length,
            myGhostAlerts: tasks.filter(t => t.escalation_level === 3).length,
            myOverdue: myTasks.filter(t => {
              const dl = t.internal_deadline;
              return dl && t.status !== "completed" && dl < new Date().toISOString();
            }).length,
          });
        } catch (e) { console.error(e); }
      }
      if (!cancelled) setSummaries(results);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [rooms, currentUser.uid]);

  // Aggregate stats
  const totalMyOpen    = summaries.reduce((s, r) => s + r.myOpen, 0);
  const totalMyReview  = summaries.reduce((s, r) => s + r.myReview, 0);
  const totalMyDone    = summaries.reduce((s, r) => s + r.myDone, 0);
  const totalOverdue   = summaries.reduce((s, r) => s + r.myOverdue, 0);
  const totalGhostAlerts = summaries.reduce((s, r) => s + r.myGhostAlerts, 0);

  // All upcoming deadlines across rooms
  const upcomingDeadlines = summaries
    .flatMap(s => s.myTasks
      .filter(t => t.status !== "completed" && t.internal_deadline)
      .map(t => ({
        room: s.room,
        task: t,
        days: daysUntil(t.internal_deadline) ?? 999,
      }))
    )
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  return (
    <div className="crd-container fade-in">
      <div className="crd-header">
        <div>
          <h2>Halo, {currentUser.displayName}</h2>
          <p className="crd-sub">
            {rooms.length === 0
              ? "Kamu belum punya room. Buat atau gabung untuk mulai."
              : `Kamu tergabung di ${rooms.length} room.`}
          </p>
        </div>
      </div>

      {/* Aggregate stat cards */}
      <div className="crd-stats-row">
        <div className="stat-card">
          <div className="stat-label">Open Tasks</div>
          <div className="stat-value" style={{ color: "var(--accent)" }}>{totalMyOpen}</div>
          <div className="stat-sub">tugasku aktif</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">In Review</div>
          <div className="stat-value" style={{ color: "var(--amber)" }}>{totalMyReview}</div>
          <div className="stat-sub">perlu review</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Done</div>
          <div className="stat-value" style={{ color: "var(--green)" }}>{totalMyDone}</div>
          <div className="stat-sub">selesai</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overdue</div>
          <div className="stat-value" style={{ color: "var(--red)" }}>{totalOverdue}</div>
          <div className="stat-sub">telat</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ghost Pool</div>
          <div className="stat-value" style={{ color: "var(--purple)" }}>{totalGhostAlerts}</div>
          <div className="stat-sub">perlu rescue</div>
        </div>
      </div>

      {/* Upcoming deadlines */}
      {upcomingDeadlines.length > 0 && (
        <div className="crd-section">
          <div className="overview-section-title">DEADLINE TERDEKAT</div>
          <div className="crd-deadlines">
            {upcomingDeadlines.map(({ room, task, days }) => (
              <div
                key={task.id}
                className={cx("crd-deadline-row", days < 0 && "overdue", days >= 0 && days <= 2 && "urgent")}
                onClick={() => onSelectRoom(room)}
              >
                <div className="crd-deadline-room">{room.project_name}</div>
                <div className="crd-deadline-title">{task.title}</div>
                <div className="crd-deadline-when">
                  {days < 0 ? `${Math.abs(days)}h telat` : days === 0 ? "Hari ini" : `${days}h lagi`}
                  <span className="crd-deadline-date">· {formatDate(task.internal_deadline)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-room summaries */}
      <div className="crd-section">
        <div className="overview-section-title">RINGKASAN PER ROOM</div>
        {loading ? (
          <div className="crd-loading">Memuat data...</div>
        ) : summaries.length === 0 ? (
          <div className="empty-state">
            <h3>Belum ada room</h3>
            <p>Buat room baru atau minta kode dari leader tim.</p>
          </div>
        ) : (
          <div className="crd-room-list">
            {summaries.map(s => (
              <div key={s.room.id} className="crd-room-card" onClick={() => onSelectRoom(s.room)}>
                <div className="crd-room-header">
                  <span className="crd-room-name">{s.room.project_name}</span>
                  <span className={`role-badge ${s.room.my_role}`}>{s.room.my_role}</span>
                </div>
                <div className="crd-room-stats">
                  <span className="crd-stat-chip open">{s.myOpen} open</span>
                  <span className="crd-stat-chip review">{s.myReview} review</span>
                  <span className="crd-stat-chip done">{s.myDone} done</span>
                  {s.myOverdue > 0 && <span className="crd-stat-chip overdue">{s.myOverdue} overdue</span>}
                  {s.myGhostAlerts > 0 && <span className="crd-stat-chip ghost">{s.myGhostAlerts} ghost</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
