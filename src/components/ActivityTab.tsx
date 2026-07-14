import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, EventType } from "@/types";
import { cx, formatRelative } from "@/lib/utils";
import { 
  FiTarget, 
  FiEdit3, 
  FiStopCircle, 
  FiUserPlus, 
  FiRefreshCw, 
  FiLogOut, 
  FiFileText, 
  FiCheckCircle, 
  FiXCircle, 
  FiZap, 
  FiPaperclip, 
  FiBell, 
  FiAlertCircle,
  FiInbox
} from "react-icons/fi";
import "./Activity.css";

interface ActivityTabProps {
  roomId: string | null;
}

const EVENT_META: Record<EventType, { label: string; icon: React.ReactNode; color: string }> = {
  room_created:      { label: "Room dibuat",          icon: <FiTarget />, color: "var(--accent)" },
  room_updated:      { label: "Room diupdate",        icon: <FiEdit3 />, color: "var(--accent)" },
  room_ended:        { label: "Room diakhiri",        icon: <FiStopCircle />, color: "var(--text-3)" },
  member_joined:     { label: "Anggota bergabung",    icon: <FiUserPlus />, color: "var(--green)" },
  member_rejoined:   { label: "Anggota kembali",      icon: <FiRefreshCw />, color: "var(--green)" },
  member_removed:    { label: "Anggota dikeluarkan",  icon: <FiLogOut />, color: "var(--red)" },
  task_proposed:     { label: "Task diusulkan",       icon: <FiFileText />, color: "var(--accent-light)" },
  task_approved:     { label: "Task disetujui",       icon: <FiCheckCircle />, color: "var(--green)" },
  task_rejected:     { label: "Task ditolak",         icon: <FiXCircle />, color: "var(--red)" },
  task_rescued:      { label: "Task di-rescue",       icon: <FiZap />, color: "var(--amber)" },
  task_updated:      { label: "Task diupdate",        icon: <FiEdit3 />, color: "var(--accent-light)" },
  task_deleted:      { label: "Task dihapus",         icon: <FiXCircle />, color: "var(--red)" },
  evidence_submitted:{ label: "Bukti dikirim",        icon: <FiPaperclip />, color: "var(--amber)" },
  nudge_sent:        { label: "Nudge terkirim",       icon: <FiBell />, color: "var(--purple)" },
  kudos_sent:        { label: "Kudos diberikan",      icon: <FiZap />, color: "var(--green)" },
  backup_called:     { label: "Bantuan diminta",      icon: <FiAlertCircle />, color: "var(--red)" },
};

export default function ActivityTab({ roomId }: ActivityTabProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const data = await invoke<ActivityEvent[]>("get_events", { roomId, limit: 100 });
      setEvents(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [roomId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!roomId) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ActivityEvent[]>("events-updated", (e) => {
        setEvents(e.payload);
      }).then(u => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [roomId]);

  if (!roomId) {
    return (
      <div style={{ color: "var(--text-3)", padding: "40px 0", textAlign: "center", fontSize: "13px" }}>
        Pilih room dari My Rooms terlebih dahulu.
      </div>
    );
  }

  const filtered = filter === "all"
    ? events
    : events.filter(e => e.event_type.startsWith(filter));

  // Group by day
  const groups: Record<string, ActivityEvent[]> = {};
  filtered.forEach(e => {
    const day = (e.timestamp || "").substring(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(e);
  });

  const sortedDays = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  return (
    <div className="activity-container fade-in">
      {/* Header */}
      <div className="activity-header">
        <h2>Activity Log</h2>
        <div className="activity-filter-group">
          {[
            { id: "all",     label: "Semua" },
            { id: "task",    label: "Task" },
            { id: "member",  label: "Member" },
            { id: "nudge",   label: "Nudge" },
            { id: "room",    label: "Room" },
          ].map(f => (
            <button
              key={f.id}
              className={cx("filter-btn", filter === f.id && "active")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && events.length === 0 ? (
        <div className="activity-loading">Memuat aktivitas...</div>
      ) : filtered.length === 0 ? (
        <div className="activity-empty">
          <div className="activity-empty-icon"><FiInbox /></div>
          <h3>Belum ada aktivitas</h3>
          <p>Aktivitas room akan muncul di sini secara real-time.</p>
        </div>
      ) : (
        <div className="activity-list">
          {sortedDays.map(day => (
            <div key={day} className="activity-day-group">
              <div className="activity-day-header">
                <span>{new Date(day).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}</span>
                <span className="activity-day-count">{groups[day].length} event</span>
              </div>
              {groups[day].map(e => {
                const meta = EVENT_META[e.event_type] ?? { label: e.event_type, icon: "•", color: "var(--text-3)" };
                return (
                  <div key={e.id} className="activity-item">
                    <div className="activity-icon" style={{ background: `${meta.color}1a`, color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className="activity-body">
                      <div className="activity-line">
                        <span className="activity-actor">{e.actor_name}</span>
                        <span className="activity-action">{meta.label}</span>
                      </div>
                      <div className="activity-time">{formatRelative(e.timestamp)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
