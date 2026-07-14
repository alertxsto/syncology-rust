import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, EventType, Member } from "@/types";
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
  FiInbox,
  FiDownload
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
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const data = await invoke<ActivityEvent[]>("get_events", { roomId, limit: 200 });
      setEvents(data);

      const mems = await invoke<Member[]>("get_members", { roomId });
      setMembers(mems);
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

  // Client-side filtering logic
  const filtered = events.filter(e => {
    // 1. Filter Kategori Tab
    if (filter !== "all") {
      if (!e.event_type.startsWith(filter)) return false;
    }
    // 2. Filter Actor
    if (actorFilter && e.actor_uid !== actorFilter) return false;
    // 3. Filter Event Type spesifik
    if (eventTypeFilter && e.event_type !== eventTypeFilter) return false;

    return true;
  });

  // Export to CSV
  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ["Timestamp", "Actor UID", "Actor Name", "Event Type", "Event Label", "Payload"];
    const rows = filtered.map(e => {
      const label = EVENT_META[e.event_type]?.label || e.event_type;
      return [
        e.timestamp,
        `"${e.actor_uid}"`,
        `"${e.actor_name}"`,
        `"${e.event_type}"`,
        `"${label}"`,
        `"${JSON.stringify(e.payload).replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `activity_log_room_${roomId.substring(0, 6)}_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export to JSON
  const handleExportJSON = () => {
    if (filtered.length === 0) return;
    const jsonStr = JSON.stringify(filtered, null, 2);
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);

    const link = document.createElement("a");
    link.setAttribute("href", dataUri);
    link.setAttribute("download", `activity_log_room_${roomId.substring(0, 6)}_${new Date().toISOString().substring(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
      <div className="activity-header" style={{ marginBottom: "14px" }}>
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
              onClick={() => {
                setFilter(f.id);
                setEventTypeFilter("");
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Filters & Exports Toolbar */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--border)" }}>
        
        {/* Dropdown Filter Actor */}
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="comment-input"
          style={{ width: "160px", padding: "4px 8px", fontSize: "12px", height: "30px" }}
        >
          <option value="">-- Semua Pelaku --</option>
          {members
            // Deduplicate members list
            .reduce<Member[]>((acc, current) => {
              if (!acc.some(item => item.uid === current.uid)) acc.push(current);
              return acc;
            }, [])
            .map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.display_name}
              </option>
            ))}
        </select>

        {/* Dropdown Filter Event Type */}
        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="comment-input"
          style={{ width: "180px", padding: "4px 8px", fontSize: "12px", height: "30px" }}
        >
          <option value="">-- Tipe Aktivitas --</option>
          {Object.entries(EVENT_META)
            .filter(([key]) => filter === "all" || key.startsWith(filter))
            .map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
        </select>

        {/* Export Buttons */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <button
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
            className="btn-secondary"
            style={{ fontSize: "11px", height: "30px", display: "flex", alignItems: "center", gap: "5px", padding: "0 10px" }}
            title="Ekspor log ke CSV"
          >
            <FiDownload size={13} /> CSV
          </button>
          <button
            onClick={handleExportJSON}
            disabled={filtered.length === 0}
            className="btn-secondary"
            style={{ fontSize: "11px", height: "30px", display: "flex", alignItems: "center", gap: "5px", padding: "0 10px" }}
            title="Ekspor log ke JSON"
          >
            <FiDownload size={13} /> JSON
          </button>
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
                const payload = e.payload || {};
                
                // Rich metadata text extractor dari payload event
                const getPayloadSnippet = () => {
                  if (e.event_type === "nudge_sent") {
                    return `kepada ${members.find(m => m.uid === payload.to_uid)?.display_name || "Anggota"} untuk tugas "${payload.task_title || "tugas"}"`;
                  }
                  if (e.event_type === "evidence_submitted") {
                    return `untuk tugas "${payload.task_id?.substring(0, 6) || "tugas"}"`;
                  }
                  if (e.event_type.startsWith("task_")) {
                    return `"${payload.title || payload.task_id?.substring(0, 6) || "tugas"}"`;
                  }
                  if (e.event_type === "backup_called") {
                    return `"${payload.message || "butuh bantuan"}"`;
                  }
                  return "";
                };

                const snippet = getPayloadSnippet();

                return (
                  <div key={e.id} className="activity-item">
                    <div className="activity-icon" style={{ background: `${meta.color}1a`, color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className="activity-body">
                      <div className="activity-line" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <div>
                          <span className="activity-actor">{e.actor_name}</span>
                          <span className="activity-action">{meta.label}</span>
                        </div>
                        {snippet && (
                          <div style={{ fontSize: "11px", color: "var(--text-2)", fontStyle: "italic", background: "var(--bg-base)", padding: "2px 8px", borderRadius: "4px", width: "fit-content", marginTop: "2px" }}>
                            {snippet}
                          </div>
                        )}
                      </div>
                      <div className="activity-time" style={{ marginTop: "4px" }}>{formatRelative(e.timestamp)}</div>
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
