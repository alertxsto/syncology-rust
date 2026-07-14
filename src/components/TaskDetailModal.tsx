import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task, Member, TaskComment, TaskStatus } from "@/types";
import { cx, formatDate, formatRelative, formatTime, initials, openExternalUrl } from "@/lib/utils";
import { FiZap } from "react-icons/fi";
import "./TaskDetailModal.css";

interface TaskDetailModalProps {
  task: Task;
  members: Record<string, Member>;
  currentUser: { uid: string };
  isLeader: boolean;
  roomId: string;
  onClose: () => void;
  onRefresh: () => void;
}

const STATUS_INFO: Record<TaskStatus, { label: string; color: string }> = {
  proposed:     { label: "Proposed",  color: "var(--accent-light)" },
  todo:         { label: "Todo",      color: "var(--accent)" },
  under_review: { label: "In Review", color: "var(--amber)" },
  completed:    { label: "Done",      color: "var(--green)" },
  disputed:     { label: "Disputed",  color: "var(--red)" },
};

interface TimelineEntry {
  label: string;
  timestamp: string | null;
  done: boolean;
}

export default function TaskDetailModal({
  task,
  members,
  currentUser,
  isLeader: _isLeader,
  roomId,
  onClose,
  onRefresh: _onRefresh,
}: TaskDetailModalProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const commentListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    loadComments();
  }, [task.id, roomId]);

  useEffect(() => {
    // Scroll to bottom when comments change
    if (commentListRef.current) {
      commentListRef.current.scrollTop = commentListRef.current.scrollHeight;
    }
  }, [comments]);

  const toErrorMessage = (err: unknown, fallback: string) => {
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
    return fallback;
  };

  const loadComments = async () => {
    setLoadingComments(true);
    setCommentError(null);
    try {
      const data = await invoke<TaskComment[]>("get_task_comments", { taskId: task.id, roomId });
      setComments(data);
    } catch (e) {
      console.error("Failed to load comments:", e);
      setCommentError(toErrorMessage(e, "Gagal memuat komentar."));
    } finally {
      setLoadingComments(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    setCommentError(null);
    try {
      await invoke("add_task_comment", { taskId: task.id, roomId, text: newComment.trim() });
      setNewComment("");
      await loadComments();
    } catch (e) {
      console.error(e);
      setCommentError(toErrorMessage(e, "Gagal mengirim komentar."));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setCommentError(null);
    try {
      await invoke("delete_task_comment", { taskId: task.id, roomId, commentId });
      await loadComments();
    } catch (e) {
      console.error(e);
      setCommentError(toErrorMessage(e, "Gagal menghapus komentar."));
    }
  };

  const statusInfo = STATUS_INFO[task.status] ?? { label: task.status, color: "var(--text-3)" };
  const assignee = members[task.assigned_to_id];
  const proposer = members[task.proposed_by_id];
  const reviewer = members[task.assigned_reviewer_id];

  const evidenceMeta = task.evidence_meta;
  const evidenceGithub = evidenceMeta?.github_url || "";
  const evidenceImages = evidenceMeta?.image_urls || [];
  const evidenceNotes = evidenceMeta?.notes || "";

  // Build timeline
  const timeline: TimelineEntry[] = [
    { label: "Proposed",    timestamp: task.proposed_at,  done: !!task.proposed_at },
    { label: "Approved",    timestamp: task.approved_at,  done: !!task.approved_at },
    { label: "Submitted",   timestamp: task.submitted_at, done: !!task.submitted_at },
    { label: "Completed",   timestamp: task.completed_at, done: !!task.completed_at },
  ];

  return (
    <div className="modal-overlay task-detail-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="task-detail-modal fade-in">
        {/* Header */}
        <div className="task-detail-header">
          <div className="task-detail-idline">
            <span className="task-detail-id">#{task.id?.substring(0, 6)}</span>
            <span className="task-detail-status-badge" style={{ background: `${statusInfo.color}1a`, color: statusInfo.color, border: `1px solid ${statusInfo.color}33` }}>
              {statusInfo.label}
            </span>
            {task.is_rescue && (
              <span className="task-detail-badge rescue">RESCUE +50%</span>
            )}
            {task.escalation_level === 3 && (
              <span className="task-detail-badge ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <FiZap /> GHOST POOL
              </span>
            )}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Title */}
        <h2 className="task-detail-title">{task.title}</h2>

        {/* Description */}
        {task.description && (
          <div className="task-detail-section">
            <div className="task-detail-section-label">Description</div>
            <p className="task-detail-desc">{task.description}</p>
          </div>
        )}

        {/* Backup message */}
        {task.escalation_level === 3 && task.backup_message && (
          <div className="task-detail-backup">
            <strong>🆘 Help Wanted:</strong> "{task.backup_message}"
          </div>
        )}

        {/* Evidence */}
        {(task.evidence_url || evidenceGithub || evidenceImages.length > 0 || evidenceNotes) && (
          <div className="task-detail-section">
            <div className="task-detail-section-label">Evidence</div>

            {task.evidence_url && (
              <button
                className="btn-secondary"
                style={{ width: "fit-content", marginBottom: "8px" }}
                onClick={() => openExternalUrl(task.evidence_url).catch(console.error)}
              >
                🔗 Lihat bukti utama
              </button>
            )}

            {evidenceGithub && (
              <button
                className="btn-secondary"
                style={{ width: "fit-content", marginBottom: "8px", marginLeft: "8px" }}
                onClick={() => openExternalUrl(evidenceGithub).catch(console.error)}
              >
                🐙 Buka GitHub Evidence
              </button>
            )}

            {evidenceImages.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "8px", marginTop: "8px" }}>
                {evidenceImages.map((img) => (
                  <button
                    key={img}
                    style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: 0, overflow: "hidden", background: "var(--bg-elevated)", cursor: "pointer" }}
                    onClick={() => openExternalUrl(img).catch(console.error)}
                    title={img}
                  >
                    <img src={img} alt="Evidence" style={{ width: "100%", height: "96px", objectFit: "cover", display: "block" }} />
                  </button>
                ))}
              </div>
            )}

            {evidenceNotes && (
              <div style={{ marginTop: "10px", color: "var(--text-2)", fontSize: "12px", lineHeight: 1.6 }}>
                <strong>Catatan:</strong> {evidenceNotes}
              </div>
            )}
          </div>
        )}

        {/* Rejection reason */}
        {task.rejection_reason && (
          <div className="task-detail-rejection">
            <strong>Rejection reason:</strong> {task.rejection_reason}
          </div>
        )}

        {/* People grid */}
        <div className="task-detail-people-grid">
          <div className="people-cell">
            <div className="people-label">Assignee</div>
            <div className="people-value">
              {assignee ? (
                <>
                  <div className="people-avatar">{initials(assignee.display_name)}</div>
                  <span>{assignee.display_name}</span>
                </>
              ) : (
                <span className="people-empty">Open Pool</span>
              )}
            </div>
          </div>
          <div className="people-cell">
            <div className="people-label">Proposed by</div>
            <div className="people-value">
              {proposer ? (
                <>
                  <div className="people-avatar">{initials(proposer.display_name)}</div>
                  <span>{proposer.display_name}</span>
                </>
              ) : <span className="people-empty">—</span>}
            </div>
          </div>
          {task.assigned_reviewer_id && reviewer && (
            <div className="people-cell">
              <div className="people-label">Reviewer</div>
              <div className="people-value">
                <div className="people-avatar">{initials(reviewer.display_name)}</div>
                <span>{reviewer.display_name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Metadata grid */}
        <div className="task-detail-meta-grid">
          <div className="meta-cell">
            <div className="meta-label">Difficulty</div>
            <div className="meta-value">{task.difficulty}</div>
          </div>
          <div className="meta-cell">
            <div className="meta-label">Points</div>
            <div className="meta-value">{task.weight}pt</div>
          </div>
          <div className="meta-cell">
            <div className="meta-label">Deadline</div>
            <div className="meta-value">{formatDate(task.internal_deadline)}</div>
          </div>
          <div className="meta-cell">
            <div className="meta-label">Category</div>
            <div className="meta-value">{task.category}</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">Timeline</div>
          <div className="timeline">
            {timeline.map((entry, i) => (
              <div key={i} className={cx("timeline-step", entry.done && "done")}>
                <div className="timeline-dot" />
                <div className="timeline-content">
                  <div className="timeline-label">{entry.label}</div>
                  {entry.timestamp && (
                    <div className="timeline-time">{formatRelative(entry.timestamp)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dependencies */}
        {task.blocked_by && task.blocked_by.length > 0 && (
          <div className="task-detail-section">
            <div className="task-detail-section-label">Blocked by</div>
            <div className="blocked-by-list">
              {task.blocked_by.map(id => (
                <span key={id} className="blocked-by-chip">#{id.substring(0, 6)}</span>
              ))}
            </div>
          </div>
        )}

        {/* Comments thread */}
        <div className="task-detail-comments-section">
          <div className="task-detail-section-label">
            Comments ({comments.length})
          </div>
          <div className="comments-list" ref={commentListRef}>
            {loadingComments ? (
              <div className="comments-empty">Memuat komentar...</div>
            ) : comments.length === 0 ? (
              <div className="comments-empty">
                Belum ada komentar. Mulai diskusi tugas ini di bawah.
              </div>
            ) : (
              comments.map(c => {
                const isSelf = c.author_uid === currentUser.uid;
                return (
                  <div key={c.id} className={cx("comment-item", isSelf && "self")}>
                    <div className="comment-avatar">{initials(c.author_name)}</div>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <span className="comment-author">{c.author_name}</span>
                        <span className="comment-time">{formatRelative(c.timestamp)} · {formatTime(c.timestamp)}</span>
                        {isSelf && (
                          <button
                            className="comment-delete"
                            onClick={() => handleDeleteComment(c.id)}
                            aria-label="Delete comment"
                          >✕</button>
                        )}
                      </div>
                      <div className="comment-text">{c.comment_text}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {commentError && (
            <div className="task-detail-rejection" style={{ marginBottom: "8px" }}>
              <strong>Comment error:</strong> {commentError}
            </div>
          )}
          <form className="comment-input-form" onSubmit={handleAddComment}>
            <input
              type="text"
              className="comment-input"
              placeholder="Tulis komentar atau pertanyaan..."
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
            />
            <button type="submit" className="comment-submit" disabled={loading || !newComment.trim()}>
              Kirim
            </button>
          </form>
        </div>

        {/* Action bar */}
        <div className="task-detail-actions">
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}
