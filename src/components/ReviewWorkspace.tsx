import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task, Member } from "@/types";
import { cx, openExternalUrl } from "@/lib/utils";
import { FiCheckSquare, FiClock, FiInbox } from "react-icons/fi";
import ImageViewerModal from "./ImageViewerModal";
import "./ReviewWorkspace.css";

interface ReviewWorkspaceProps {
  tasks: Task[];
  members: Record<string, Member>;
  currentUser: { uid: string };
  isLeader: boolean;
  roomId: string;
  onRefresh: () => void;
}

export default function ReviewWorkspace({
  tasks,
  members,
  currentUser,
  isLeader,
  roomId,
  onRefresh,
}: ReviewWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<"needs_mine" | "recent" | "all_open">("needs_mine");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState("");
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  // SLA Time Helper: Hitung waktu tunggu dalam format jam / hari
  const getSLAInfo = (submittedAtStr?: string) => {
    if (!submittedAtStr) return { text: "-", isOverdue: false };
    const submittedAt = new Date(submittedAtStr);
    const now = new Date();
    const diffMs = now.getTime() - submittedAt.getTime();
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    
    // SLA limit adalah 24 jam
    const isOverdue = diffHrs >= 24;
    
    if (diffHrs < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return { text: `${diffMins}m yang lalu`, isOverdue };
    }
    if (diffHrs < 24) {
      return { text: `${diffHrs}j yang lalu`, isOverdue };
    }
    const diffDays = Math.floor(diffHrs / 24);
    return { text: `${diffDays}h yang lalu`, isOverdue };
  };

  // Filter Tasks berdasarkan Tab
  const queueTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (activeTab === "needs_mine") {
        if (t.status !== "under_review") return false;
        return t.assigned_reviewer_id === currentUser.uid || t.reviewer_backup_id === currentUser.uid;
      }
      if (activeTab === "recent") {
        if (t.status !== "completed") return false;
        return t.assigned_reviewer_id === currentUser.uid || t.reviewer_backup_id === currentUser.uid;
      }
      if (activeTab === "all_open") {
        return t.status === "under_review";
      }
      return false;
    });
  }, [tasks, activeTab, currentUser.uid]);

  const activeTask = useMemo(() => {
    return tasks.find((t) => t.id === activeTaskId) || null;
  }, [tasks, activeTaskId]);

  // Handle Multi-Select Checkbox
  const handleSelectTask = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.length === queueTasks.length) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(queueTasks.map((t) => t.id));
    }
  };

  // Batch Approval
  const handleBatchApprove = async () => {
    if (selectedTaskIds.length === 0) return;
    setProcessing(true);
    setErr("");
    try {
      // Jalankan approve berurutan untuk semua yang dipilih
      for (const id of selectedTaskIds) {
        await invoke("call_function", {
          functionName: "reviewTask",
          data: {
            taskId: id,
            reviewerId: currentUser.uid,
            decision: "approve",
            reason: "",
            roomId,
          },
        });
      }
      setSelectedTaskIds([]);
      setActiveTaskId(null);
      onRefresh();
    } catch (e: any) {
      setErr(typeof e === "string" ? e : "Gagal menyetujui tugas secara massal.");
    } finally {
      setProcessing(false);
    }
  };

  // Single Action: Approve
  const handleApprove = async (taskId: string, reason: string) => {
    setProcessing(true);
    setErr("");
    try {
      await invoke("call_function", {
        functionName: "reviewTask",
        data: {
          taskId,
          reviewerId: currentUser.uid,
          decision: "approve",
          reason,
          roomId,
        },
      });
      setApproveReason("");
      setShowApproveForm(false);
      setActiveTaskId(null);
      onRefresh();
    } catch (e: any) {
      setErr(typeof e === "string" ? e : "Gagal menyetujui tugas.");
    } finally {
      setProcessing(false);
    }
  };

  // Single Action: Reject
  const handleReject = async (taskId: string) => {
    if (!rejectReason.trim()) {
      setErr("Tuliskan alasan penolakan.");
      return;
    }
    setProcessing(true);
    setErr("");
    try {
      await invoke("call_function", {
        functionName: "reviewTask",
        data: {
          taskId,
          reviewerId: currentUser.uid,
          decision: "reject",
          reason: rejectReason.trim(),
          roomId,
        },
      });
      setRejectReason("");
      setShowRejectForm(false);
      setActiveTaskId(null);
      onRefresh();
    } catch (e: any) {
      setErr(typeof e === "string" ? e : "Gagal menolak submission.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="review-workspace-container fade-in">
      
      {/* Panel Kiri - Antrean */}
      <div className="review-queue-panel">
        <div className="review-queue-header">
          <div className="review-queue-tabs">
            <button
              className={cx("review-tab-btn", activeTab === "needs_mine" && "active")}
              onClick={() => {
                setActiveTab("needs_mine");
                setSelectedTaskIds([]);
                setActiveTaskId(null);
              }}
            >
              Needs My Review ({tasks.filter(t => t.status === "under_review" && (t.assigned_reviewer_id === currentUser.uid || t.reviewer_backup_id === currentUser.uid)).length})
            </button>
            <button
              className={cx("review-tab-btn", activeTab === "recent" && "active")}
              onClick={() => {
                setActiveTab("recent");
                setSelectedTaskIds([]);
                setActiveTaskId(null);
              }}
            >
              Recently Reviewed
            </button>
            {isLeader && (
              <button
                className={cx("review-tab-btn", activeTab === "all_open" && "active")}
                onClick={() => {
                  setActiveTab("all_open");
                  setSelectedTaskIds([]);
                  setActiveTaskId(null);
                }}
              >
                All Open ({tasks.filter(t => t.status === "under_review").length})
              </button>
            )}
          </div>
        </div>

        {/* Batch Actions Bar */}
        {selectedTaskIds.length > 0 && (
          <div className="review-batch-actions">
            <span className="review-batch-text">
              📦 {selectedTaskIds.length} tugas terpilih
            </span>
            <button
              className="btn-primary"
              onClick={handleBatchApprove}
              disabled={processing}
              style={{ padding: "5px 12px", fontSize: "12px" }}
            >
              {processing ? "Memproses..." : "Batch Approve ✅"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setSelectedTaskIds([])}
              style={{ padding: "5px 10px", fontSize: "12px" }}
            >
              Batal
            </button>
          </div>
        )}

        {/* List Antrean */}
        <div className="review-queue-list">
          {queueTasks.length === 0 ? (
            <div className="review-preview-placeholder">
              <FiInbox size={32} />
              <span>Tidak ada tugas dalam antrean tab ini.</span>
            </div>
          ) : (
            <>
              {activeTab === "needs_mine" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 6px 6px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.length === queueTasks.length}
                    onChange={handleSelectAll}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 600 }}>Pilih Semua</span>
                </div>
              )}
              {queueTasks.map((t) => {
                const sla = getSLAInfo(t.submitted_at);
                const assignee = members[t.assigned_to_id];
                return (
                  <div
                    key={t.id}
                    className={cx(
                      "review-queue-item",
                      activeTaskId === t.id && "selected"
                    )}
                    onClick={() => {
                      setActiveTaskId(t.id);
                      setShowRejectForm(false);
                      setRejectReason("");
                      setShowApproveForm(false);
                      setApproveReason("");
                      setErr("");
                    }}
                  >
                    {activeTab === "needs_mine" && (
                      <input
                        type="checkbox"
                        className="review-item-checkbox"
                        checked={selectedTaskIds.includes(t.id)}
                        onClick={(e) => handleSelectTask(t.id, e)}
                        onChange={() => {}}
                      />
                    )}
                    <div className="review-item-content">
                      <div className="review-item-title-row">
                        <span className="review-item-title">{t.title}</span>
                        {t.status === "under_review" && (
                          <span
                            className={cx(
                              "review-sla-badge",
                              sla.isOverdue ? "overdue" : "pending"
                            )}
                          >
                            <FiClock style={{ marginRight: 3, verticalAlign: "middle" }} />
                            {sla.text}
                          </span>
                        )}
                      </div>
                      <div className="review-item-meta">
                        <span>#{(t.id).substring(0, 6)}</span>
                        <span>·</span>
                        <span>Assignee: {assignee?.display_name || "Open Pool"}</span>
                        <span>·</span>
                        <span>Points: {t.weight}pt</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Panel Kanan - Preview Detail */}
      <div className="review-preview-panel">
        {!activeTask ? (
          <div className="review-preview-placeholder">
            <FiCheckSquare size={36} />
            <span>Pilih salah satu tugas dari antrean untuk meninjau bukti pengerjaan.</span>
          </div>
        ) : (
          <>
            <div className="review-preview-header">
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 700 }}>PR-#{activeTask.id.substring(0, 6)}</span>
                <h3 className="review-preview-title">{activeTask.title}</h3>
              </div>
              <button
                className="modal-close"
                onClick={() => setActiveTaskId(null)}
                style={{ position: "static" }}
              >
                ✕
              </button>
            </div>

            <div className="review-preview-body">
              {/* Deskripsi */}
              {activeTask.description && (
                <div>
                  <h4 className="people-label" style={{ marginBottom: 4 }}>Deskripsi Tugas</h4>
                  <p className="task-detail-desc" style={{ fontSize: "13px" }}>{activeTask.description}</p>
                </div>
              )}

              {/* Bukti Pengerjaan (Evidence Rich Render) */}
              <div>
                <h4 className="people-label" style={{ marginBottom: 6 }}>Bukti Pengerjaan (Evidence)</h4>
                {(() => {
                  const meta = activeTask.evidence_meta;
                  if (!meta) {
                    return (
                      <button
                        className="btn-secondary"
                        onClick={() => openExternalUrl(activeTask.evidence_url).catch(console.error)}
                      >
                        🔗 Buka Link Bukti Utama
                      </button>
                    );
                  }

                  const { type, primary_url, notes, github_pr_num, github_commit_hash, image_urls } = meta;

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {type === "github_pr" && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-elevated)", padding: "10px", borderRadius: "8px" }}>
                          <span style={{ fontSize: "20px" }}>🐙</span>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: "10px", color: "var(--text-3)", fontWeight: 700 }}>GITHUB PULL REQUEST</span>
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
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-elevated)", padding: "10px", borderRadius: "8px" }}>
                          <span style={{ fontSize: "20px" }}>💻</span>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: "10px", color: "var(--text-3)", fontWeight: 700 }}>GITHUB COMMIT</span>
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
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-elevated)", padding: "10px", borderRadius: "8px" }}>
                          <span style={{ fontSize: "20px" }}>📄</span>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: "10px", color: "var(--text-3)", fontWeight: 700 }}>DOKUMEN KONTRAK</span>
                            <a
                              href="#"
                              onClick={(e) => { e.preventDefault(); openExternalUrl(primary_url).catch(console.error); }}
                              style={{ color: "var(--accent-light)", fontSize: "13px", fontWeight: 600, textDecoration: "underline" }}
                            >
                              Buka Dokumen Proyek →
                            </a>
                          </div>
                        </div>
                      )}

                      {type === "image" && image_urls && image_urls.length > 0 && (
                        <div>
                          <span style={{ fontSize: "10px", color: "var(--text-3)", fontWeight: 700, display: "block", marginBottom: "4px" }}>SCREENSHOT BUKTI</span>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "8px" }}>
                            {image_urls.map((img, idx) => (
                              <button
                                key={img}
                                style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: 0, overflow: "hidden", background: "var(--bg-elevated)", cursor: "pointer" }}
                                onClick={() => {
                                  setViewerImages(image_urls);
                                  setViewerIndex(idx);
                                }}
                              >
                                <img src={img} alt="Evidence" style={{ width: "100%", height: "80px", objectFit: "cover", display: "block" }} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {notes && (
                        <div style={{ marginTop: "4px", color: "var(--text-2)", fontSize: "12px", background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "6px", borderLeft: "3px solid var(--accent)" }}>
                          <strong>Catatan Pengirim:</strong> {notes}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Subtask Checklist */}
              {activeTask.subtasks && activeTask.subtasks.length > 0 && (
                <div>
                  <h4 className="people-label" style={{ marginBottom: 6 }}>Granular Checklist</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {activeTask.subtasks.map((s) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", padding: "4px 8px", background: "var(--bg-elevated)", borderRadius: "4px" }}>
                        <span style={{ color: s.done ? "var(--green)" : "var(--text-3)" }}>
                          {s.done ? "✓" : "○"}
                        </span>
                        <span style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--text-3)" : "var(--text-2)" }}>
                          {s.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status Timings */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", background: "var(--bg-elevated)", padding: "12px", borderRadius: "8px" }}>
                <div>
                  <span className="people-label" style={{ fontSize: "9px" }}>Disubmit Oleh</span>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>
                    {members[activeTask.assigned_to_id]?.display_name || "Unknown"}
                  </div>
                </div>
                <div>
                  <span className="people-label" style={{ fontSize: "9px" }}>Reviewer Utama</span>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>
                    {members[activeTask.assigned_reviewer_id]?.display_name || "-"}
                  </div>
                </div>
              </div>

              {err && (
                <div className="task-detail-rejection" style={{ margin: "10px 0 0" }}>
                  <strong>Error:</strong> {err}
                </div>
              )}
            </div>

            {/* Actions Bar */}
            <div className="review-preview-actions">
              {activeTask.status === "under_review" && !showRejectForm && !showApproveForm && (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => setShowRejectForm(true)}
                    disabled={processing}
                    style={{ color: "var(--red)", borderColor: "rgba(239,68,68,0.3)" }}
                  >
                    ✕ Reject Submission
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setShowApproveForm(true)}
                    disabled={processing}
                    style={{ background: "var(--green)" }}
                  >
                    ✓ Approve & Complete
                  </button>
                </>
              )}

              {/* Form Input Catatan Persetujuan (Approve) */}
              {showApproveForm && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", animation: "slideDown 0.2s ease-out" }}>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Tuliskan catatan persetujuan opsional (misal: Code clean, test passed!)..."
                    value={approveReason}
                    onChange={(e) => setApproveReason(e.target.value)}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                    <button
                      className="btn-secondary"
                      onClick={() => { setShowApproveForm(false); setApproveReason(""); }}
                      disabled={processing}
                    >
                      Batal
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleApprove(activeTask.id, approveReason)}
                      disabled={processing}
                      style={{ background: "var(--green)" }}
                    >
                      Konfirmasi Approve
                    </button>
                  </div>
                </div>
              )}

              {/* Form Input Alasan Penolakan (Reject) */}
              {showRejectForm && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", animation: "slideDown 0.2s ease-out" }}>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Tuliskan feedback alasan penolakan agar assignee bisa merevisi..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                    <button
                      className="btn-secondary"
                      onClick={() => { setShowRejectForm(false); setRejectReason(""); }}
                      disabled={processing}
                    >
                      Batal
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleReject(activeTask.id)}
                      disabled={processing || !rejectReason.trim()}
                      style={{ background: "var(--red)" }}
                    >
                      Kirim Penolakan
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {viewerImages && (
        <ImageViewerModal
          imageUrls={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
          title={`Bukti Foto · ${activeTask ? activeTask.title : 'Review'}`}
        />
      )}
    </div>
  );
}
