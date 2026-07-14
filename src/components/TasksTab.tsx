import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Task, Member, TaskStatus } from "@/types";
import TaskCard from "./TaskCard";
import ProposeTaskModal from "./ProposeTaskModal";
import TaskDetailModal from "./TaskDetailModal";
import CalendarView from "./CalendarView";
import SubmitEvidenceModal from "./SubmitEvidenceModal";
import { cx } from "@/lib/utils";
import "./Tasks.css";

interface TasksTabProps {
  currentUser: { uid: string };
  roomId: string | null;
  highlightedTaskId: string | null;
  onClearHighlight: () => void;
}

const COLUMN_STATUS: Record<string, TaskStatus[]> = {
  todo:   ["todo", "proposed", "disputed"],
  review: ["under_review"],
  done:   ["completed"],
};

export default function TasksTab({ currentUser, roomId, highlightedTaskId, onClearHighlight }: TasksTabProps) {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [members, setMembers]       = useState<Record<string, Member>>({});
  const [membersList, setMembersList] = useState<Member[]>([]);
  const [filter, setFilter]         = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch]         = useState("");
  const [isLeader, setIsLeader]     = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [view, setView]             = useState<"kanban" | "calendar">("kanban");
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [submitEvidenceTask, setSubmitEvidenceTask] = useState<Task | null>(null);

  // Drag-and-drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const loadData = async () => {
    if (!roomId) return;
    try {
      const fetchedTasks: Task[]   = await invoke("get_tasks",   { roomId });
      const fetchedMembers: Member[] = await invoke("get_members", { roomId });

      const memberMap: Record<string, Member> = {};
      let leader = false;
      fetchedMembers.forEach(m => {
        memberMap[m.uid] = m;
        if (m.uid === currentUser.uid && m.role === "leader") leader = true;
      });

      setIsLeader(leader);
      setMembers(memberMap);
      setMembersList(fetchedMembers);
      setTasks(fetchedTasks);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadData(); }, [roomId]);

  // Subscribe to real-time task updates
  useEffect(() => {
    if (!roomId) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<Task[]>("tasks-updated", (e) => {
        setTasks(e.payload);
      }).then(u => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [roomId]);

  const FILTER_LABELS: Record<string, string> = {
    all: "Semua", mine: "Tugasku", audit: "Review", pool: "Ghost Pool",
  };

  const filteredTasks = tasks.filter(t => {
    // Primary filter chips
    if (filter === "mine" && t.assigned_to_id !== currentUser.uid) return false;

    // "Review" should only show tasks that are currently waiting for my review
    if (filter === "audit") {
      if (t.status !== "under_review") return false;
      if (t.assigned_reviewer_id !== currentUser.uid) return false;
    }

    // "Ghost Pool" should show active ghosted tasks only
    if (filter === "pool") {
      if (t.escalation_level !== 3) return false;
      if (t.status === "completed") return false;
    }

    // Secondary status dropdown
    if (statusFilter && t.status !== statusFilter) return false;

    // Search
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;

    return true;
  }).sort((a, b) => (b.escalation_level || 0) - (a.escalation_level || 0));

  const todoTasks   = filteredTasks.filter(t => COLUMN_STATUS.todo.includes(t.status));
  const reviewTasks = filteredTasks.filter(t => COLUMN_STATUS.review.includes(t.status));
  const doneTasks   = filteredTasks.filter(t => COLUMN_STATUS.done.includes(t.status));

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== colId) setDragOverCol(colId);
  };

  const handleDragLeave = (colId: string) => {
    if (dragOverCol === colId) setDragOverCol(null);
  };

  const handleDrop = async (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const taskId = draggedTaskId;
    setDraggedTaskId(null);
    setDragOverCol(null);
    if (!taskId || !roomId) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Validate that the user is allowed to move this task
    const isAssignee = task.assigned_to_id === currentUser.uid;

    if (colId === "todo") {
      // Moving to todo: only allowed if currently in 'proposed' and user is leader
      if (task.status === "proposed" && isLeader) {
        try {
          await invoke("update_task", { taskId, data: { status: "todo" }, roomId });
          await loadData();
        } catch (err) { console.error(err); }
      }
    } else if (colId === "review") {
      // Moving to review = submit evidence (only assignee can do this)
      if (isAssignee && ["todo", "disputed"].includes(task.status)) {
        setSubmitEvidenceTask(task);
      }
    }
    // Drop to "done" is intentionally disallowed — must go through review.
  };

  if (!roomId) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-3)", fontSize: "13px" }}>
        Pilih room dari My Rooms terlebih dahulu.
      </div>
    );
  }

  const renderColumn = (colId: string, title: string, dotColor: string, list: Task[], emptyText: string) => (
    <div
      className={cx("kanban-column", dragOverCol === colId && "drag-over")}
      onDragOver={(e) => handleDragOver(e, colId)}
      onDragLeave={() => handleDragLeave(colId)}
      onDrop={(e) => handleDrop(e, colId)}
    >
      <div className="column-header">
        <span className="column-dot" style={{ background: dotColor }} />
        <span className="column-title">{title}</span>
        <span className="column-count">{list.length}</span>
      </div>
      <div className="column-body">
        {list.length === 0
          ? <div className="column-empty">{emptyText}</div>
          : list.map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => handleDragStart(e, t.id)}
                onDragEnd={() => { setDraggedTaskId(null); setDragOverCol(null); }}
                className={cx("task-card-drag-wrapper", draggedTaskId === t.id && "dragging")}
              >
                <TaskCard
                  task={t}
                  members={members}
                  currentUser={currentUser}
                  isLeader={isLeader}
                  roomId={roomId!}
                  onRefresh={loadData}
                  highlightedTaskId={highlightedTaskId}
                  onClearHighlight={onClearHighlight}
                />
              </div>
            ))
        }
      </div>
    </div>
  );

  return (
    <div className="tasks-container fade-in">
      {/* Toolbar */}
      <div className="tasks-toolbar">
        <div className="filter-group">
          {(["all", "mine", "audit", "pool"] as const).map(f => (
            <button
              key={f}
              className={cx("filter-btn", filter === f && "active")}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="proposed">Proposed</option>
          <option value="todo">Todo</option>
          <option value="under_review">In Review</option>
          <option value="completed">Done</option>
          <option value="disputed">Disputed</option>
        </select>

        <input
          type="text"
          placeholder="Cari task..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="tasks-count">{filteredTasks.length} task</span>

        <div className="view-toggle">
          <button
            className={cx("view-btn", view === "kanban" && "active")}
            onClick={() => setView("kanban")}
            title="Kanban view"
          >
            ▤
          </button>
          <button
            className={cx("view-btn", view === "calendar" && "active")}
            onClick={() => setView("calendar")}
            title="Calendar view"
          >
            📅
          </button>
        </div>

        <button className="btn-primary" style={{ marginLeft: "auto" }} onClick={() => setShowPropose(true)}>
          + Propose Task
        </button>
      </div>

      {/* Body */}
      {view === "calendar" ? (
        <CalendarView
          tasks={filteredTasks}
          onSelectTask={(t) => setDetailTask(t)}
        />
      ) : (
        <div className="kanban-board">
          {renderColumn("todo",   "Todo / Backlog", "var(--accent-light)", todoTasks,   "Tidak ada task")}
          {renderColumn("review", "In Review",      "var(--amber)",        reviewTasks, "Tidak ada task")}
          {renderColumn("done",   "Done",           "var(--green)",        doneTasks,   "Belum ada yang selesai")}
        </div>
      )}

      {/* Modals */}
      {showPropose && (
        <ProposeTaskModal
          roomId={roomId}
          members={membersList}
          onClose={() => setShowPropose(false)}
          onSuccess={() => { setShowPropose(false); loadData(); }}
        />
      )}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          members={members}
          currentUser={currentUser}
          isLeader={isLeader}
          roomId={roomId}
          onClose={() => setDetailTask(null)}
          onRefresh={loadData}
        />
      )}
      {submitEvidenceTask && (
        <SubmitEvidenceModal
          taskTitle={submitEvidenceTask.title}
          onCancel={() => setSubmitEvidenceTask(null)}
          onConfirm={async (payload) => {
            try {
              await invoke("call_function", {
                functionName: "submitEvidence",
                data: {
                  taskId: submitEvidenceTask.id,
                  roomId,
                  evidenceUrl: payload.evidenceUrl,
                  githubUrl: payload.githubUrl,
                  imageUrls: payload.imageUrls,
                  notes: payload.notes,
                },
              });
              setSubmitEvidenceTask(null);
              await loadData();
            } catch (err) {
              console.error(err);
            }
          }}
        />
      )}
    </div>
  );
}
