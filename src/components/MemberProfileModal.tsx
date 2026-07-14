import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MemberStats, BadgeId } from "@/types";
import { cx } from "@/lib/utils";
import { 
  FiTrendingUp, 
  FiDroplet, 
  FiZap, 
  FiTarget, 
  FiBookOpen, 
  FiActivity, 
  FiBell, 
  FiAward, 
  FiUsers 
} from "react-icons/fi";
import "./MemberProfileModal.css";

interface MemberProfileModalProps {
  uid: string;
  roomId: string;
  onClose: () => void;
}

const BADGE_META: Record<BadgeId, { label: string; icon: React.ReactNode; desc: string }> = {
  first_blood:    { label: "First Blood",    icon: <FiDroplet />, desc: "Selesaikan task pertamamu" },
  rescuer:        { label: "Rescuer",        icon: <FiTarget />, desc: "Rescue 1 task dari ghost pool" },
  ghostbuster:    { label: "Ghostbuster",    icon: <FiZap />, desc: "Rescue 5 task dari ghost pool" },
  mentor:         { label: "Mentor",         icon: <FiBookOpen />, desc: "Approve 10 review task" },
  streak_7:       { label: "7-Day Streak",   icon: <FiTrendingUp />, desc: "7 hari beruntun selesaikan task" },
  streak_30:      { label: "30-Day Streak",  icon: <FiActivity />, desc: "30 hari beruntun selesaikan task" },
  nudge_master:   { label: "Nudge Master",   icon: <FiBell />, desc: "Kirim 50 nudge" },
  point_legend:   { label: "Point Legend",   icon: <FiAward />, desc: "Akumulasi 500+ poin" },
  team_player:    { label: "Team Player",    icon: <FiUsers />, desc: "Selesaikan 25 task" },
};

export default function MemberProfileModal({ uid, roomId, onClose }: MemberProfileModalProps) {
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const data = await invoke<MemberStats>("get_member_stats", { roomId, uid });
        setStats(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [uid, roomId]);

  // Build a 52-week heatmap placeholder (would need backend aggregation for real data)
  // For now, show last 12 weeks as placeholder
  const weeks = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="member-profile-modal fade-in">
        <div className="mp-header">
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="mp-loading">Memuat profil...</div>
        ) : !stats ? (
          <div className="mp-loading">Gagal memuat profil.</div>
        ) : (
          <>
            {/* Profile hero */}
            <div className="mp-hero">
              <div className="mp-avatar">{stats.display_name.charAt(0).toUpperCase()}</div>
              <div className="mp-info">
                <h2 className="mp-name">{stats.display_name}</h2>
                <div className="mp-role">{stats.role}</div>
                <div className="mp-streak" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <FiTrendingUp style={{ color: 'var(--amber)' }} /> {stats.current_streak} hari beruntun · terbaik {stats.longest_streak} hari
                </div>
              </div>
              <div className="mp-pts">
                <div className="mp-pts-value">{stats.total_pts}</div>
                <div className="mp-pts-label">poin</div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="mp-stats-grid">
              <div className="mp-stat">
                <div className="mp-stat-value">{stats.tasks_completed}</div>
                <div className="mp-stat-label">Selesai</div>
              </div>
              <div className="mp-stat">
                <div className="mp-stat-value">{stats.tasks_assigned}</div>
                <div className="mp-stat-label">Ditugaskan</div>
              </div>
              <div className="mp-stat">
                <div className="mp-stat-value" style={{ color: "var(--red)" }}>{stats.tasks_overdue}</div>
                <div className="mp-stat-label">Telat</div>
              </div>
              <div className="mp-stat">
                <div className="mp-stat-value" style={{ color: "var(--amber)" }}>{stats.rescues}</div>
                <div className="mp-stat-label">Rescue</div>
              </div>
              <div className="mp-stat">
                <div className="mp-stat-value">{stats.nudges_sent}</div>
                <div className="mp-stat-label">Nudge Kirim</div>
              </div>
              <div className="mp-stat">
                <div className="mp-stat-value">{stats.nudges_received}</div>
                <div className="mp-stat-label">Nudge Terima</div>
              </div>
            </div>

            {/* Activity heatmap (placeholder) */}
            <div className="mp-section">
              <div className="mp-section-label">Aktivitas 12 minggu terakhir</div>
              <div className="mp-heatmap">
                {weeks.map(w => (
                  <div key={w} className="mp-heatmap-col">
                    {Array.from({ length: 7 }, (_, d) => (
                      <div
                        key={d}
                        className={cx("mp-heatmap-cell", Math.random() > 0.7 && "active")}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Badges */}
            <div className="mp-section">
              <div className="mp-section-label">
                Badges ({stats.badges.length}/{Object.keys(BADGE_META).length})
              </div>
              <div className="mp-badges-grid">
                {(Object.entries(BADGE_META) as [BadgeId, typeof BADGE_META[BadgeId]][]).map(([id, meta]) => {
                  const earned = stats.badges.includes(id);
                  return (
                    <div
                      key={id}
                      className={cx("mp-badge", earned && "earned")}
                      title={meta.desc}
                    >
                      <div className="mp-badge-icon">{meta.icon}</div>
                      <div className="mp-badge-label">{meta.label}</div>
                      {!earned && <div className="mp-badge-locked">🔒</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
