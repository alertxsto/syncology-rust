import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task, Member, TaskDifficulty } from "@/types";
import { DIFFICULTY_WEIGHT } from "@/types";
import { cx, playChime, openExternalUrl } from "@/lib/utils";
import ConfirmModal from "./ConfirmModal";
import InputModal from "./InputModal";
import TaskDetailModal from "./TaskDetailModal";
import SubmitEvidenceModal from "./SubmitEvidenceModal";
import "./Tasks.css";

interface TaskCardProps {
  task: Task;
  members: Record<string, Member>;
  currentUser: { uid: string };
  isLeader: boolean;
  roomId: string;
  onRefresh: () => void;
  highlightedTaskId: string | null;
  onClearHighlight: () => void;
  allTasks: Task[];
  onSelectTask?: (t: Task) => void;
}

const ESC: Record<number, { borderColor: string; badgeBg: string; badgeFg: string; label: string }> = {
  0: { borderColor: "transparent",   badgeBg: "",                  badgeFg: "",              label: "" },
  1: { borderColor: "var(--amber)",  badgeBg: "var(--amber-dim)",  badgeFg: "var(--amber)",  label: "Warning" },
  2: { borderColor: "var(--red)",    badgeBg: "var(--red-dim)",    badgeFg: "var(--red)",    label: "Critical" },
  3: { borderColor: "var(--purple)", badgeBg: "var(--purple-dim)", badgeFg: "var(--purple)", label: "Ghost" },
};

const STATUS: Record<string, { label: string; color: string }> = {
  proposed:     { label: "Proposed",  color: "var(--accent-light)" },
  todo:         { label: "Todo",      color: "var(--accent)" },
  under_review: { label: "In Review", color: "var(--amber)" },
  completed:    { label: "Done",      color: "var(--green)" },
  disputed:     { label: "Disputed",  color: "var(--red)" },
};

const DIFFICULTY_COLOR: Record<TaskDifficulty, string> = {
  "Easy":      "var(--green)",
  "Medium":    "var(--accent)",
  "Hard":      "var(--amber)",
  "Very Hard": "var(--red)",
};

type ModalState =
  | { type: "none" }
  | { type: "confirm"; title: string; message: string; danger?: boolean; onConfirm: () => void }
  | { type: "input";  title: string; label: string; placeholder?: string; inputType?: "text" | "textarea" | "url"; onConfirm: (v: string) => void };

export default function TaskCard({
  task, members, currentUser, isLeader, roomId, onRefresh, highlightedTaskId, onClearHighlight, allTasks, onSelectTask,
}: TaskCardProps) {
  const [modal, setModal]   = useState<ModalState>({ type: "none" });
  const [actionErr, setErr] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [showSubmitEvidence, setShowSubmitEvidence] = useState(false);
  const [nudgeSuccess, setNudgeSuccess] = useState(false);
  const [kudosSuccess, setKudosSuccess] = useState(false);

  const escLevel   = task.escalation_level || 0;
  const esc        = ESC[escLevel] || ESC[0];
  const statusInfo = STATUS[task.status] || { label: task.status, color: "var(--text-3)" };
  const assignee   = members[task.assigned_to_id];
  const reviewer   = task.assigned_reviewer_id ? members[task.assigned_reviewer_id] : undefined;
  const isAssignee = task.assigned_to_id === currentUser.uid;
  const isReviewer = task.assigned_reviewer_id === currentUser.uid;
  const isUnassigned = !task.assigned_to_id || task.assigned_to_id === "";
  const weight     = task.weight ?? DIFFICULTY_WEIGHT[task.difficulty] ?? 10;
  const diffColor  = DIFFICULTY_COLOR[task.difficulty] ?? "var(--text-3)";
  const isBlocked  = task.blocked_by && task.blocked_by.length > 0;
  const totalSubtasks = task.subtasks?.length ?? 0;
  const doneSubtasks = task.subtasks?.filter(s => s.done).length ?? 0;
  const subtaskProgress = totalSubtasks > 0 ? Math.round((doneSubtasks / totalSubtasks) * 100) : 0;

  const dismiss = () => setModal({ type: "none" });

  const run = async (fn: () => Promise<void>) => {
    setErr("");
    try { await fn(); onRefresh(); }
    catch (e: any) { setErr(typeof e === "string" ? e : JSON.stringify(e)); }
  };

  useEffect(() => {
    if (highlightedTaskId === task.id) {
      const el = document.getElementById(`task-card-${task.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const timer = setTimeout(() => {
        onClearHighlight();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [highlightedTaskId]);

  /* ── Action Handlers ────────────────────────── */
  const handleApprove = () =>
    setModal({ type: "confirm", title: "Approve Task", message: `Approve task "${task.title}" dan pindahkan ke Todo?`, onConfirm: () => { dismiss(); run(() => invoke("update_task", { taskId: task.id, data: { status: "todo" }, roomId })); } });

  const handleClaim = () =>
    setModal({ type: "confirm", title: "Ambil Tugas", message: `Kamu yakin ingin mengambil tugas "${task.title}"?`, onConfirm: () => { dismiss(); run(() => invoke("call_function", { functionName: "claimTask", data: { taskId: task.id, roomId } })); playChime("success"); } });

  const handleDelete = () =>
    setModal({ type: "confirm", title: "Hapus Task", message: `Yakin hapus task "${task.title}"? Tindakan ini tidak bisa dibatalkan.`, danger: true, onConfirm: () => { dismiss(); run(() => invoke("delete_task", { taskId: task.id, roomId })); } });

  const handleSubmitEvidence = () => setShowSubmitEvidence(true);

  const handleDispute = () =>
    setModal({ type: "confirm", title: "Ajukan Dispute", message: "Ajukan dispute? Ini akan eskalasi ke leader untuk ditinjau ulang.", danger: true,
      onConfirm: () => { dismiss(); run(() => invoke("call_function", { functionName: "disputeTask", data: { taskId: task.id, roomId } })); } });

  const handleRescue = () =>
    setModal({ type: "confirm", title: "Rescue Task", message: "Kamu akan mengambil alih task ini dan mendapat bonus +50% poin. Lanjutkan?",
      onConfirm: () => { dismiss(); run(() => invoke("call_function", { functionName: "rescueTask", data: { taskId: task.id, roomId } })); playChime("success"); } });

  const handleCallBackup = () =>
    setModal({
      type: "input",
      title: "Panggil Bantuan (Call Backup)",
      label: "Deskripsi Bantuan",
      placeholder: "Contoh: Butuh bantuan debug query SQL, stuck di layout CSS...",
      inputType: "textarea",
      onConfirm: message => {
        if (!message.trim()) return;
        dismiss();
        run(() => invoke("call_function", {
          functionName: "callForBackup",
          data: { taskId: task.id, message: message.trim(), roomId }
        }));
      }
    });

  const handleReviewApprove = () =>
    setModal({
      type: "input",
      title: "Approve Review",
      label: "Catatan Persetujuan (opsional)",
      placeholder: "Tulis catatan persetujuan opsional (misal: Code clean, test passed!)...",
      inputType: "textarea",
      onConfirm: reason => {
        dismiss();
        run(() => invoke("call_function", {
          functionName: "reviewTask",
          data: {
            taskId: task.id,
            reviewerId: currentUser.uid,
            decision: "approve",
            reason: reason || "",
            roomId,
          }
        }));
        playChime("success");
      }
    });

  const handleReviewReject = () =>
    setModal({ type: "input", title: "Tolak Submission", label: "Alasan Penolakan", placeholder: "Tulis alasan penolakan...", inputType: "textarea",
      onConfirm: reason => { dismiss(); run(() => invoke("call_function", { functionName: "reviewTask", data: { taskId: task.id, reviewerId: currentUser.uid, decision: "reject", reason, roomId } })); } });

  const handleNudge = () => {
    if (!task.assigned_to_id) { setErr("Task belum di-assign, tidak bisa nudge."); return; }
    run(async () => {
      await invoke("call_function", { functionName: "sendNudge", data: { toId: task.assigned_to_id, taskId: task.id, roomId } });
      setNudgeSuccess(true);
      playChime("success");
      setTimeout(() => setNudgeSuccess(false), 2500);
    });
  };

  const handleKudos = () => {
    run(async () => {
      await invoke("call_function", { functionName: "giveKudos", data: { taskId: task.id, toId: task.assigned_to_id, roomId } });
      setKudosSuccess(true);
      playChime("success");
      setTimeout(() => setKudosSuccess(false), 2500);
    });
  };

  return (
    <>
      <div
        id={`task-card-${task.id}`}
        className={cx(
          "task-card",
          escLevel === 3 && "escalated-backup",
          highlightedTaskId === task.id && "highlight-glow",
          isBlocked && "task-card-blocked",
        )}
        style={{ borderLeft: `3px solid ${escLevel > 0 ? esc.borderColor : diffColor}` }}
      >
        {/* ID + title — clickable to open detail */}
        <div
          className="task-top task-top-clickable"
          onClick={() => setShowDetail(true)}
        >
          <span className="task-id">#{task.id?.substring(0, 6)}</span>
          <span className="task-title">{task.title}</span>
          {escLevel > 0 && <span className="task-badge" style={{ background: esc.badgeBg, color: esc.badgeFg }}>{esc.label}</span>}
        </div>
        {escLevel === 3 && <span className="task-card-backup-badge">🔧 HELP WANTED</span>}
        {isBlocked && (
          <div className="task-blocked-badge" title={task.blocked_by?.map(id => `#${id.substring(0,6)}`).join(", ")}>
            🚫 Blocked by {task.blocked_by!.length} task
          </div>
        )}

        {/* Status + difficulty */}
        <div className="task-meta">
          <span className="task-badge" style={{ background: `${statusInfo.color}1a`, color: statusInfo.color, border: `1px solid ${statusInfo.color}33` }}>
            {statusInfo.label}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: diffColor, fontWeight: 700 }}>
            {task.difficulty || "Medium"} · {weight}pt
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)" }}>
            {task.category || "technical"}
          </span>
          {task.is_rescue && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--green)", fontWeight: 700 }}>RESCUE +50%</span>
          )}
        </div>

        {/* Assignee + deadline */}
        <div className="task-meta" style={{ gap: "10px" }}>
          <span style={{ fontSize: "11px", color: assignee ? "var(--text-2)" : "var(--accent-light)" }}>
            {assignee ? assignee.display_name : "Open Pool"}
          </span>
          {task.internal_deadline && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)" }}>
              {task.internal_deadline.substring(0, 10)}
            </span>
          )}
        </div>

        {task.status === "under_review" && (() => {
          const isOverdue = task.review_due_at && new Date(task.review_due_at) < new Date();
          const backupReviewer = task.reviewer_backup_id ? members[task.reviewer_backup_id] : undefined;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "4px" }}>
              <div style={{ fontSize: "11px", color: "var(--amber)", fontWeight: 600 }}>
                Reviewer: {reviewer?.display_name || "Belum ditentukan"}
              </div>
              {backupReviewer && (
                <div style={{ fontSize: "10px", color: "var(--text-3)" }}>
                  Backup: {backupReviewer.display_name}
                </div>
              )}
              {task.review_due_at && (
                <div style={{ fontSize: "10px", color: isOverdue ? "var(--red)" : "var(--text-3)", fontWeight: isOverdue ? 700 : 400 }}>
                  Review Due: {task.review_due_at.substring(0, 10)} {task.review_due_at.substring(11, 16)} {isOverdue && "⚠️ OVERDUE"}
                </div>
              )}
            </div>
          );
        })()}

        {/* Description */}
        {task.description && (
          <div className="task-desc">
            {task.description.length > 100 ? task.description.substring(0, 100) + "…" : task.description}
          </div>
        )}

        {/* Subtask progress */}
        {totalSubtasks > 0 && (
          <div className="task-subtask-progress">
            <div className="task-subtask-progress-head">
              <span>Checklist</span>
              <span>{doneSubtasks}/{totalSubtasks}</span>
            </div>
            <div className="task-subtask-progress-track" aria-label={`Subtask progress ${subtaskProgress}%`}>
              <div className="task-subtask-progress-fill" style={{ width: `${subtaskProgress}%` }} />
            </div>
          </div>
        )}

        {/* Backup message */}
        {escLevel === 3 && task.backup_message && (
          <div className="task-card-backup-msg">
            <strong>Bantuan: </strong>"{task.backup_message}"
          </div>
        )}

        {/* Evidence link */}
        {task.evidence_url && (
          <button
            className="action-btn action-ghost"
            style={{ fontSize: "11px", width: "fit-content", padding: "4px 8px" }}
            onClick={(e) => {
              e.stopPropagation();
              openExternalUrl(task.evidence_url).catch(console.error);
            }}
          >
            Lihat bukti →
          </button>
        )}

        {/* Rejection reason */}
        {task.rejection_reason && (
          <div style={{ background: "var(--red-dim)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--red)", padding: "6px 8px", borderRadius: "var(--r-sm)", fontSize: "11px" }}>
            Ditolak: {task.rejection_reason}
          </div>
        )}

        {/* Inline error */}
        {actionErr && (
          <div style={{ background: "var(--red-dim)", color: "var(--red)", padding: "5px 8px", borderRadius: "var(--r-sm)", fontSize: "11px" }}>
            {actionErr}
          </div>
        )}

        {/* Action buttons */}
        <div className="task-actions" onClick={e => e.stopPropagation()}>
          {isLeader && task.status === "proposed" && (
            <button className="action-btn" style={{ background: "var(--accent)" }} onClick={handleApprove}>Approve</button>
          )}
          {isAssignee && ["todo", "disputed"].includes(task.status) && (
            <>
              <button className="action-btn" style={{ background: "var(--green)" }} onClick={handleSubmitEvidence}>Submit Bukti</button>
              <button className="action-btn action-ghost" onClick={handleCallBackup}>Call Backup</button>
              {task.rejection_reason && (
                <button className="action-btn" style={{ background: "var(--red)" }} onClick={handleDispute}>Dispute</button>
              )}
            </>
          )}
          {isUnassigned && ["todo", "disputed"].includes(task.status) && (
            <button className="action-btn" style={{ background: "var(--accent)" }} onClick={handleClaim}>Ambil Tugas</button>
          )}
          {isReviewer && task.status === "under_review" && (
            <>
              <button className="action-btn" style={{ background: "var(--green)" }} onClick={handleReviewApprove}>Approve</button>
              <button className="action-btn" style={{ background: "var(--red)" }} onClick={handleReviewReject}>Reject</button>
            </>
          )}
          {escLevel === 3 && !isAssignee && task.status !== "completed" && (
            <button className="action-btn" style={{ background: "var(--amber)" }} onClick={handleRescue}>Rescue</button>
          )}
          {task.status !== "completed" && !isAssignee && task.assigned_to_id && (
            <button
              className="action-btn action-ghost"
              onClick={handleNudge}
              disabled={nudgeSuccess}
              style={nudgeSuccess ? { color: "var(--green)", borderColor: "var(--green)" } : undefined}
            >
              {nudgeSuccess ? "Nudge Terkirim! 🚀" : "Nudge"}
            </button>
          )}
          {task.status === "completed" && !isAssignee && task.assigned_to_id && (() => {
            const hasGivenKudos = task.kudos_by?.includes(currentUser.uid) || kudosSuccess;
            return (
              <button
                className="action-btn action-ghost"
                onClick={handleKudos}
                disabled={hasGivenKudos}
                style={hasGivenKudos ? { color: "var(--green)", borderColor: "var(--green)" } : undefined}
              >
                {hasGivenKudos ? "Kudos Diberikan ✓" : "Kudos"}
              </button>
            );
          })()}
          {isLeader && task.status !== "completed" && (
            <button className="action-btn action-ghost" style={{ marginLeft: "auto", color: "var(--red)", borderColor: "var(--red)" }} onClick={handleDelete}>Hapus</button>
          )}
        </div>
      </div>

      {/* Modals rendered outside card */}
      {modal.type === "confirm" && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          danger={modal.danger}
          confirmLabel={modal.danger ? "Ya, lanjutkan" : "Konfirmasi"}
          onConfirm={modal.onConfirm}
          onCancel={dismiss}
        />
      )}
      {modal.type === "input" && (
        <InputModal
          title={modal.title}
          label={modal.label}
          placeholder={modal.placeholder}
          inputType={modal.inputType}
          onConfirm={modal.onConfirm}
          onCancel={dismiss}
        />
      )}
      {showDetail && (
        <TaskDetailModal
          task={task}
          members={members}
          currentUser={currentUser}
          isLeader={isLeader}
          roomId={roomId}
          onClose={() => setShowDetail(false)}
          onRefresh={onRefresh}
          allTasks={allTasks}
          onSelectTask={onSelectTask}
        />
      )}
      {showSubmitEvidence && (
        <SubmitEvidenceModal
          taskTitle={task.title}
          taskId={task.id}
          onCancel={() => setShowSubmitEvidence(false)}
          onConfirm={(payload) => {
            setShowSubmitEvidence(false);
            run(() => invoke("call_function", {
              functionName: "submitEvidence",
              data: {
                taskId: task.id,
                roomId,
                evidenceUrl: payload.evidenceUrl,
                // Kirim evidenceMeta terstruktur ke backend
                ...payload.evidenceMeta,
              },
            }));
          }}
        />
      )}
    </>
  );
}
