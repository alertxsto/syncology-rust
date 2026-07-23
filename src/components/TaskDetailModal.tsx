import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task, Member, TaskComment, TaskStatus, TaskSubtask } from "@/types";
import { cx, formatDate, formatRelative, formatTime, initials, openExternalUrl } from "@/lib/utils";
import { FiZap } from "react-icons/fi";
import ImageViewerModal from "./ImageViewerModal";
import "./TaskDetailModal.css";

interface TaskDetailModalProps {
  task: Task;
  members: Record<string, Member>;
  currentUser: { uid: string };
  isLeader: boolean;
  roomId: string;
  onClose: () => void;
  onRefresh: () => void;
  allTasks: Task[];
  onSelectTask?: (t: Task) => void;
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
  onRefresh,
  allTasks,
  onSelectTask,
}: TaskDetailModalProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>(task.subtasks ?? []);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [savingSubtasks, setSavingSubtasks] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const [selectedBlockerId, setSelectedBlockerId] = useState("");
  const [savingBlockers, setSavingBlockers] = useState(false);
  const [blockerError, setBlockerError] = useState<string | null>(null);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
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

  useEffect(() => {
    setSubtasks(task.subtasks ?? []);
    setSubtaskError(null);
  }, [task.id, task.subtasks]);

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

  const persistSubtasks = async (nextSubtasks: TaskSubtask[]) => {
    setSavingSubtasks(true);
    setSubtaskError(null);
    try {
      await invoke("update_task", {
        taskId: task.id,
        roomId,
        data: { subtasks: nextSubtasks },
      });
      setSubtasks(nextSubtasks);
      onRefresh();
    } catch (e) {
      console.error(e);
      setSubtaskError(toErrorMessage(e, "Gagal menyimpan checklist task."));
    } finally {
      setSavingSubtasks(false);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSubtaskTitle.trim();
    if (!title) return;

    const now = new Date().toISOString();
    const item: TaskSubtask = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      done: false,
      created_at: now,
    };

    const next = [...subtasks, item];
    setNewSubtaskTitle("");
    await persistSubtasks(next);
  };

  const handleToggleSubtask = async (subtaskId: string) => {
    const now = new Date().toISOString();
    const next = subtasks.map((s) =>
      s.id === subtaskId
        ? { ...s, done: !s.done, completed_at: !s.done ? now : undefined }
        : s
    );
    await persistSubtasks(next);
  };

  const handleUpdateSubtaskAssignee = async (subtaskId: string, assigneeUid: string) => {
    const next = subtasks.map((s) =>
      s.id === subtaskId
        ? { ...s, assignee_uid: assigneeUid || undefined }
        : s
    );
    await persistSubtasks(next);
  };

  const handleUpdateSubtaskDueDate = async (subtaskId: string, dueDate: string) => {
    const next = subtasks.map((s) =>
      s.id === subtaskId
        ? { ...s, due_date: dueDate || undefined }
        : s
    );
    await persistSubtasks(next);
  };

  const handleAddBlocker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlockerId || !roomId) return;

    setSavingBlockers(true);
    setBlockerError(null);
    try {
      const currentBlockedBy = task.blocked_by ?? [];
      if (currentBlockedBy.includes(selectedBlockerId)) {
        setBlockerError("Tugas ini sudah terdaftar sebagai blocker.");
        return;
      }
      const nextBlockedBy = [...currentBlockedBy, selectedBlockerId];
      await invoke("set_task_blocked_by", { roomId, taskId: task.id, blockedBy: nextBlockedBy });
      setSelectedBlockerId("");
      onRefresh();
    } catch (err) {
      console.error(err);
      setBlockerError(toErrorMessage(err, "Gagal menambahkan blocker."));
    } finally {
      setSavingBlockers(false);
    }
  };

  const handleRemoveBlocker = async (blockerId: string) => {
    if (!roomId) return;

    setSavingBlockers(true);
    setBlockerError(null);
    try {
      const currentBlockedBy = task.blocked_by ?? [];
      const nextBlockedBy = currentBlockedBy.filter(id => id !== blockerId);
      await invoke("set_task_blocked_by", { roomId, taskId: task.id, blockedBy: nextBlockedBy });
      onRefresh();
    } catch (err) {
      console.error(err);
      setBlockerError(toErrorMessage(err, "Gagal menghapus blocker."));
    } finally {
      setSavingBlockers(false);
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    const next = subtasks.filter((s) => s.id !== subtaskId);
    await persistSubtasks(next);
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
  const backupReviewer = task.reviewer_backup_id ? members[task.reviewer_backup_id] : undefined;

  const totalSubtasks = subtasks.length;
  const doneSubtasks = subtasks.filter(s => s.done).length;
  const subtaskProgress = totalSubtasks > 0 ? Math.round((doneSubtasks / totalSubtasks) * 100) : 0;

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

        {/* Scrollable Body */}
        <div className="task-detail-body">
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
        {(task.evidence_url || task.evidence_meta) && (
          <div className="task-detail-section">
            <div className="task-detail-section-label">Evidence</div>
            
            {(() => {
              const meta = task.evidence_meta;
              
              // Fallback jika task di-submit tanpa meta (format lama)
              if (!meta) {
                return (
                  <button
                    className="btn-secondary"
                    style={{ width: "fit-content", marginBottom: "8px" }}
                    onClick={() => openExternalUrl(task.evidence_url).catch(console.error)}
                  >
                    🔗 Lihat bukti utama (Link)
                  </button>
                );
              }

              const { type, primary_url, notes, github_pr_num, github_commit_hash, image_urls, file_name, file_type, file_size } = meta;

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {/* File Upload */}
                  {type === "file_upload" && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "20px" }}>📎</span>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase" }}>File Bukti Upload</span>
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>{file_name || "File"}</span>
                          {file_type && (
                            <span style={{ fontSize: "11px", color: "var(--text-2)" }}>
                              {file_type} {file_size ? `· ${(file_size / 1024).toFixed(1)} KB` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      {file_type && file_type.startsWith("image/") && (
                        <div style={{ marginTop: "8px" }}>
                          <img src={primary_url} alt={file_name || "Evidence"} style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "8px", border: "1px solid var(--border)" }} />
                        </div>
                      )}
                      <button
                        className="btn-secondary"
                        style={{ marginTop: "8px", fontSize: "12px" }}
                        onClick={() => openExternalUrl(primary_url).catch(console.error)}
                      >
                        📥 Download / Buka File →
                      </button>
                    </div>
                  )}

                  {/* Rich Render berdasarkan Tipe */}
                  {type === "github_pr" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "20px" }}>🐙</span>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase" }}>GitHub Pull Request</span>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); openExternalUrl(primary_url).catch(console.error); }}
                          style={{ color: "var(--accent-light)", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}
                        >
                          Buka PR {github_pr_num ? `#${github_pr_num}` : ""} →
                        </a>
                      </div>
                    </div>
                  )}

                  {type === "github_commit" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "20px" }}>💻</span>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase" }}>GitHub Commit</span>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); openExternalUrl(primary_url).catch(console.error); }}
                          style={{ color: "var(--accent-light)", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}
                        >
                          Commit {github_commit_hash ? `[${github_commit_hash.substring(0, 7)}]` : ""} →
                        </a>
                      </div>
                    </div>
                  )}

                  {type === "document" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "20px" }}>📄</span>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase" }}>Dokumen Proyek (Docs/Notion)</span>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); openExternalUrl(primary_url).catch(console.error); }}
                          style={{ color: "var(--accent-light)", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}
                        >
                          Buka Dokumen Bukti →
                        </a>
                      </div>
                    </div>
                  )}

                  {type === "image" && image_urls && image_urls.length > 0 && (
                    <div>
                      <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Screenshot / Gambar Bukti</span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                        {image_urls.map((img, idx) => (
                          <button
                            key={img}
                            style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: 0, overflow: "hidden", background: "var(--bg-elevated)", cursor: "pointer" }}
                            onClick={() => {
                              setViewerImages(image_urls);
                              setViewerIndex(idx);
                            }}
                            title={img}
                          >
                            <img src={img} alt="Evidence" style={{ width: "100%", height: "96px", objectFit: "cover", display: "block" }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {type === "other_url" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "20px" }}>🔗</span>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase" }}>Tautan Bukti Lainnya</span>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); openExternalUrl(primary_url).catch(console.error); }}
                          style={{ color: "var(--accent-light)", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}
                        >
                          Lihat Tautan Bukti →
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Catatan / Notes */}
                  {notes && (
                    <div style={{ marginTop: "6px", color: "var(--text-2)", fontSize: "12px", lineHeight: 1.6, background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "6px", borderLeft: "3px solid var(--accent)" }}>
                      <strong>Catatan Pengirim:</strong> {notes}
                    </div>
                  )}
                </div>
              );
            })()}
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
          {task.reviewer_backup_id && backupReviewer && (
            <div className="people-cell">
              <div className="people-label">Backup Reviewer</div>
              <div className="people-value">
                <div className="people-avatar">{initials(backupReviewer.display_name)}</div>
                <span>{backupReviewer.display_name}</span>
              </div>
            </div>
          )}
          {task.status === "under_review" && task.review_due_at && (() => {
            const isOverdue = new Date(task.review_due_at) < new Date();
            return (
              <div className="people-cell">
                <div className="people-label" style={{ color: isOverdue ? "var(--red)" : "inherit" }}>Review Deadline</div>
                <div className="people-value" style={{ color: isOverdue ? "var(--red)" : "inherit", fontWeight: isOverdue ? 700 : 400 }}>
                  {formatDate(task.review_due_at)} {isOverdue && " (OVERDUE)"}
                </div>
              </div>
            );
          })()}
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

        {/* Dependencies (Blockers) */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">Blocked by</div>
          
          {/* Chip list */}
          <div className="blocked-by-list" style={{ marginBottom: "8px" }}>
            {(!task.blocked_by || task.blocked_by.length === 0) ? (
              <span className="people-empty" style={{ fontSize: "12px" }}>Tugas ini tidak diblokir oleh tugas lain.</span>
            ) : (
              task.blocked_by.map(id => {
                const blockerTask = allTasks.find(t => t.id === id);
                return (
                  <span
                    key={id}
                    className="blocked-by-chip"
                    style={{
                      cursor: blockerTask && onSelectTask ? "pointer" : "default",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 8px",
                      borderRadius: "6px",
                    }}
                    onClick={() => {
                      if (blockerTask && onSelectTask) {
                        onSelectTask(blockerTask);
                      }
                    }}
                    title={blockerTask ? `Buka detail: ${blockerTask.title}` : `ID: ${id}`}
                  >
                    🚫 {blockerTask ? blockerTask.title : `#${id.substring(0, 6)}`}
                    <button
                      type="button"
                      disabled={savingBlockers}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveBlocker(id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        fontSize: "11px",
                        padding: "0 2px",
                      }}
                      title="Hapus dependensi ini"
                    >
                      ✕
                    </button>
                  </span>
                );
              })
            )}
          </div>

          {blockerError && (
            <div className="task-detail-rejection" style={{ margin: "8px 0" }}>
              <strong>Dependency error:</strong> {blockerError}
            </div>
          )}

          {/* Form add blocker */}
          <form className="comment-input-form" onSubmit={handleAddBlocker} style={{ marginTop: "10px" }}>
            <select
              value={selectedBlockerId}
              disabled={savingBlockers}
              onChange={(e) => setSelectedBlockerId(e.target.value)}
              className="comment-input"
              style={{ padding: "6px 8px", fontSize: "13px", height: "34px", flex: 1 }}
            >
              <option value="">-- Pilih tugas blocker untuk ditambahkan --</option>
              {allTasks
                .filter(t => t.id !== task.id) // bukan tugas ini
                .filter(t => t.status !== "completed") // belum selesai
                .filter(t => !(task.blocked_by ?? []).includes(t.id)) // belum masuk blocker
                .map(t => (
                  <option key={t.id} value={t.id}>
                    #{t.id.substring(0, 6)} - {t.title}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              className="comment-submit"
              disabled={savingBlockers || !selectedBlockerId}
              style={{ height: "34px" }}
            >
              Tambah Blocker
            </button>
          </form>
        </div>

        {/* Subtasks / checklist */}
        <div className="task-detail-section">
          <div className="task-detail-section-label">Checklist</div>
          {totalSubtasks > 0 && (
            <>
              <div className="task-detail-subtasks-progress-head">
                <span>{doneSubtasks}/{totalSubtasks} selesai</span>
                <span>{subtaskProgress}%</span>
              </div>
              <div className="task-detail-subtasks-progress-track" aria-label={`Checklist progress ${subtaskProgress}%`}>
                <div className="task-detail-subtasks-progress-fill" style={{ width: `${subtaskProgress}%` }} />
              </div>
            </>
          )}

          <div className="task-detail-subtasks-list">
            {subtasks.length === 0 ? (
              <div className="comments-empty" style={{ padding: "10px 0" }}>
                Belum ada checklist. Tambah langkah kerja supaya task lebih granular.
              </div>
            ) : subtasks.map((s) => {
              const isOverdue = s.due_date && !s.done && new Date(s.due_date) < new Date();
              return (
                <div key={s.id} className={cx("task-detail-subtask-item", s.done && "done")}>
                  <label className="task-detail-subtask-main">
                    <input
                      type="checkbox"
                      checked={s.done}
                      disabled={savingSubtasks}
                      onChange={() => handleToggleSubtask(s.id)}
                    />
                    <span>{s.title}</span>
                  </label>
                  
                  {/* Subtask Controls */}
                  <div className="subtask-controls">
                    <select
                      value={s.assignee_uid || ""}
                      disabled={savingSubtasks}
                      onChange={(e) => handleUpdateSubtaskAssignee(s.id, e.target.value)}
                      className="subtask-assignee-select"
                      title="Pilih pelaksana subtask"
                    >
                      <option value="">(No Assignee)</option>
                      {Object.values(members)
                        .reduce<Member[]>((acc, current) => {
                          if (!acc.some((item) => item.uid === current.uid)) {
                            acc.push(current);
                          }
                          return acc;
                        }, [])
                        .map((m) => (
                          <option key={m.uid} value={m.uid}>
                            {m.display_name}
                          </option>
                        ))}
                    </select>

                    <input
                      type="date"
                      value={s.due_date ? s.due_date.substring(0, 10) : ""}
                      disabled={savingSubtasks}
                      onChange={(e) => handleUpdateSubtaskDueDate(s.id, e.target.value)}
                      className={cx("subtask-due-date-input", isOverdue && "overdue")}
                      title={isOverdue ? "Subtask ini melewati deadline!" : "Pilih deadline subtask"}
                    />
                  </div>

                  <button
                    className="comment-delete"
                    disabled={savingSubtasks}
                    onClick={() => handleDeleteSubtask(s.id)}
                    aria-label="Hapus subtask"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {subtaskError && (
            <div className="task-detail-rejection" style={{ margin: "8px 0 0" }}>
              <strong>Checklist error:</strong> {subtaskError}
            </div>
          )}

          <form className="comment-input-form" onSubmit={handleAddSubtask} style={{ marginTop: "8px" }}>
            <input
              type="text"
              className="comment-input"
              placeholder="Tambah item checklist..."
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              disabled={savingSubtasks}
            />
            <button type="submit" className="comment-submit" disabled={savingSubtasks || !newSubtaskTitle.trim()}>
              Tambah
            </button>
          </form>
        </div>

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
                const isApproved = c.comment_text.startsWith("[APPROVED]");
                const isRejected = c.comment_text.startsWith("[REJECTED]");
                const isSystemLog = isApproved || isRejected;
                
                // Bersihkan tag prefiks untuk tampilan teks
                const displayText = isSystemLog 
                  ? c.comment_text.replace(/^\[(APPROVED|REJECTED)\]\s*/, "") 
                  : c.comment_text;

                return (
                  <div
                    key={c.id}
                    className={cx("comment-item", isSelf && "self")}
                    style={isSystemLog ? {
                      background: isApproved ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)",
                      borderLeft: isApproved ? "3px solid var(--green)" : "3px solid var(--red)",
                      borderRadius: "6px",
                      padding: "8px 12px",
                      margin: "4px 0",
                    } : undefined}
                  >
                    <div className="comment-avatar" style={isSystemLog ? { background: isApproved ? "var(--green)" : "var(--red)" } : undefined}>
                      {isSystemLog ? (isApproved ? "✓" : "✕") : initials(c.author_name)}
                    </div>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <span className="comment-author" style={isSystemLog ? { fontWeight: 700 } : undefined}>
                          {c.author_name}
                        </span>
                        {isApproved && (
                          <span style={{ fontSize: "9px", background: "var(--green-dim)", color: "var(--green)", padding: "1px 4px", borderRadius: "3px", fontWeight: 700, marginLeft: "6px" }}>
                            APPROVED REVIEW
                          </span>
                        )}
                        {isRejected && (
                          <span style={{ fontSize: "9px", background: "var(--red-dim)", color: "var(--red)", padding: "1px 4px", borderRadius: "3px", fontWeight: 700, marginLeft: "6px" }}>
                            REJECTED REVIEW
                          </span>
                        )}
                        <span className="comment-time" style={{ marginLeft: "auto" }}>
                          {formatRelative(c.timestamp)} · {formatTime(c.timestamp)}
                        </span>
                        {isSelf && !isSystemLog && (
                          <button
                            className="comment-delete"
                            onClick={() => handleDeleteComment(c.id)}
                            aria-label="Delete comment"
                          >✕</button>
                        )}
                      </div>
                      <div className="comment-text" style={isSystemLog ? { color: "var(--text-1)", fontWeight: 500 } : undefined}>
                        {displayText}
                      </div>
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
        </div>

        {/* Action bar */}
        <div className="task-detail-actions">
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
        </div>
      </div>

      {viewerImages && (
        <ImageViewerModal
          imageUrls={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
          title={`Bukti Foto · ${task.title}`}
        />
      )}
    </div>
  );
}
