import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Room, Task, Member } from "@/types";
import { SkeletonList } from "./Skeleton";
import "./Overview.css";

interface OverviewTabProps {
  roomId: string | null;
  onMemberClick?: (uid: string) => void;
}

export default function OverviewTab({ roomId, onMemberClick }: OverviewTabProps) {
  const [room, setRoom]       = useState<Room | null>(null);
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const rooms: Room[] = await invoke("list_my_rooms");
      setRoom(rooms.find(r => r.id === roomId) ?? null);
      setTasks(await invoke("get_tasks", { roomId }));
      setMembers(await invoke("get_members", { roomId }));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [roomId]);

  if (!roomId) {
    return (
      <div style={{ color: "var(--text-3)", padding: "40px 0", textAlign: "center", fontSize: "13px" }}>
        Pilih room dari My Rooms terlebih dahulu.
      </div>
    );
  }

  if (loading && !room) {
    return <SkeletonList count={3} />;
  }

  if (!room) return null;

  const doneTasks   = tasks.filter(t => t.status === "completed");
  const reviewTasks = tasks.filter(t => t.status === "under_review");
  const ghostTasks  = tasks.filter(t => t.escalation_level === 3);

  const completePct = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  // Member capacity: tasks assigned, in review, completed, overdue
  const memberStats = members.map(m => {
    const myTasks = tasks.filter(t => t.assigned_to_id === m.uid);
    const assigned = myTasks.length;
    const completed = myTasks.filter(t => t.status === "completed").length;
    const inReview = myTasks.filter(t => t.status === "under_review").length;
    const overdue = myTasks.filter(t => {
      const dl = t.internal_deadline;
      return dl && t.status !== "completed" && dl < new Date().toISOString();
    }).length;
    const overloaded = assigned - completed > 5;
    return { member: m, assigned, completed, inReview, overdue, overloaded };
  });

  return (
    <div className="overview-container fade-in">

      {/* Stats */}
      <div>
        <div className="overview-section-title">RINGKASAN PROJECT</div>
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total Task</div>
            <div className="stat-value">{tasks.length}</div>
            <div className="stat-sub">{completePct}% selesai</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Selesai</div>
            <div className="stat-value" style={{ color: "var(--green)" }}>{doneTasks.length}</div>
            <div className="stat-sub">completed</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">In Review</div>
            <div className="stat-value" style={{ color: "var(--amber)" }}>{reviewTasks.length}</div>
            <div className="stat-sub">menunggu review</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ghost Alert</div>
            <div className="stat-value" style={{ color: "var(--red)" }}>{ghostTasks.length}</div>
            <div className="stat-sub">perlu rescue</div>
          </div>
        </div>
      </div>

      {/* Project Info */}
      <div>
        <div className="overview-section-title">INFO PROJECT</div>
        <div className="info-block">
          <div className="info-row">
            <span className="info-label">Nama Project</span>
            <span className="info-value">{room.project_name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Kode Room</span>
            <span className="info-value" style={{ fontFamily: "var(--font-mono)", color: "var(--accent-light)", fontWeight: 700 }}>
              {room.room_code}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Status</span>
            <span className="info-value" style={{ color: room.is_active ? "var(--green)" : "var(--text-3)" }}>
              {room.is_active ? "Active" : "Ended"}
            </span>
          </div>
          {room.global_deadline && (
            <div className="info-row">
              <span className="info-label">Deadline</span>
              <span className="info-value">{room.global_deadline.substring(0, 10)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Members with capacity */}
      <div>
        <div className="overview-section-title">KAPASITAS ANGGOTA ({members.length})</div>
        <div className="members-list">
          {memberStats.map(({ member: m, assigned, completed, inReview, overdue, overloaded }) => (
            <div
              key={m.id}
              className={`member-row ${overloaded ? "overloaded" : ""}`}
              onClick={() => onMemberClick?.(m.uid)}
              style={{ cursor: onMemberClick ? "pointer" : "default" }}
            >
              <div className="member-avatar">{m.display_name.charAt(0).toUpperCase()}</div>
              <span className="member-name">{m.display_name}</span>
              <span className="member-role">{m.role}</span>
              <div className="member-capacity">
                <span className="cap-chip assigned">{assigned} assigned</span>
                <span className="cap-chip review">{inReview} review</span>
                <span className="cap-chip done">{completed} done</span>
                {overdue > 0 && <span className="cap-chip overdue">{overdue} overdue</span>}
                {overloaded && <span className="cap-chip warn">⚠️ overloaded</span>}
              </div>
              <span className="member-pts">{m.total_pts || 0} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
