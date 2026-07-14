/**
 * Syncology — Shared TypeScript Models
 *
 * These types MUST stay in sync with the Rust backend in
 * `src-tauri/src/models/` and the Firestore schemas in DOCUMENTATION.md.
 * Any field-name change here must also be reflected in:
 *   - Rust manager.rs (field insertions)
 *   - Firestore documents (existing docs need migration)
 */

// ── Auth ───────────────────────────────────────────────────────
export interface FirebaseUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  idToken?: string;
  refreshToken?: string;
}

// ── Rooms ──────────────────────────────────────────────────────
export interface Room {
  id: string;
  room_code: string;
  project_name: string;
  global_deadline: string;       // ISO 8601
  created_at: string;            // ISO 8601
  is_active: boolean;
  external_chat_url: string;
  archived_at: string;
  // Joined fields (set by backend in list_my_rooms)
  my_role?: "leader" | "member";
  my_member_id?: string;
}

// ── Members ────────────────────────────────────────────────────
export interface Member {
  id: string;                    // Firestore doc ID
  uid: string;                   // Firebase Auth UID
  display_name: string;
  role: "leader" | "member";
  joined_at: string;             // ISO 8601
  nudge_pts: number;
  total_pts: number;
  nudge_sent_today: number;
  nudge_reset_date: string;      // YYYY-MM-DD
}

// ── Tasks ──────────────────────────────────────────────────────
export type TaskDifficulty = "Easy" | "Medium" | "Hard" | "Very Hard";
export type TaskStatus = "proposed" | "todo" | "under_review" | "completed" | "disputed";
export type EscalationLevel = 0 | 1 | 2 | 3;

export const DIFFICULTY_WEIGHT: Record<TaskDifficulty, number> = {
  "Easy":      5,
  "Medium":    10,
  "Hard":      20,
  "Very Hard": 35,
};

export interface TaskEvidenceMeta {
  github_url?: string;
  image_urls?: string[];
  notes?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigned_to_id: string;        // Firebase Auth UID
  proposed_by_id: string;        // Firestore member doc ID
  weight: number;                // 5 | 10 | 20 | 35
  difficulty: TaskDifficulty;
  category: "technical" | "management";
  status: TaskStatus;
  internal_deadline: string;     // ISO 8601
  evidence_url: string;
  evidence_meta?: TaskEvidenceMeta;
  approved_by_id: string;        // Firebase Auth UID
  rejection_reason: string;
  is_rescue: boolean;
  proposed_at: string;
  approved_at: string;
  submitted_at: string;
  completed_at: string;
  escalation_level: EscalationLevel;
  escalated_at: string;
  assigned_reviewer_id: string;  // Firebase Auth UID
  backup_message?: string;       // present when escalation_level === 3
  // Optional — task dependencies (Phase 7)
  blocked_by?: string[];
  recurrence?: "none" | "daily" | "weekly" | "monthly";
}

// ── Messages (Chat) ────────────────────────────────────────────
export interface ChatMessage {
  id: string;
  sender_id: string;             // Firebase Auth UID or "system"
  sender_name: string;
  message_body: string;
  timestamp: string;             // ISO 8601
  edited?: boolean;
  reply_to?: string;             // message ID being replied to
  reactions?: Record<string, string[]>; // { emoji: [uid1, uid2] }
}

// ── Nudges ─────────────────────────────────────────────────────
export interface Nudge {
  id: string;
  from_member_id: string;        // Firestore member doc ID
  from_uid: string;              // Firebase Auth UID
  from_name: string;
  to_uid: string;                // Firebase Auth UID — used by frontend filter
  task_id: string;
  task_title: string;
  timestamp: string;             // ISO 8601
  read: boolean;
}

// ── Activity / Audit Events ────────────────────────────────────
export type EventType =
  | "room_created"
  | "room_updated"
  | "room_ended"
  | "member_joined"
  | "member_rejoined"
  | "member_removed"
  | "task_proposed"
  | "task_approved"
  | "task_rejected"
  | "task_rescued"
  | "evidence_submitted"
  | "nudge_sent"
  | "backup_called";

export interface ActivityEvent {
  id: string;
  actor_uid: string;
  actor_name: string;
  event_type: EventType;
  payload: Record<string, any>;
  timestamp: string;             // ISO 8601
}

// ── Task Comments (Phase 5) ────────────────────────────────────
export interface TaskComment {
  id: string;
  author_uid: string;
  author_name: string;
  comment_text: string;
  timestamp: string;             // ISO 8601
}

// ── Typing Indicator (Phase 9) ─────────────────────────────────
export interface TypingState {
  uid: string;
  display_name: string;
  timestamp: number;             // epoch millis
}

// ── Streaks & Badges (Phase 12) ────────────────────────────────
export interface MemberStats {
  uid: string;
  display_name: string;
  role: "leader" | "member";
  total_pts: number;
  tasks_completed: number;
  tasks_assigned: number;
  tasks_overdue: number;
  nudges_sent: number;
  nudges_received: number;
  rescues: number;
  current_streak: number;        // consecutive days with ≥1 completed task
  longest_streak: number;
  badges: string[];              // badge IDs
  last_completed_at?: string;
}

export type BadgeId =
  | "first_blood"        // first task completed
  | "rescuer"            // 1 rescue
  | "ghostbuster"        // 5 rescues
  | "mentor"             // 10 reviews approved
  | "streak_7"           // 7-day streak
  | "streak_30"          // 30-day streak
  | "nudge_master"       // 50 nudges sent
  | "point_legend"       // 500+ total points
  | "team_player";       // 25 tasks completed

// ── Toast / Notification ───────────────────────────────────────
export type ToastType = "nudge" | "backup" | "info" | "success" | "error";

export interface Toast {
  id: number;
  title: string;
  message: string;
  type: ToastType;
  taskId?: string;
  senderName?: string;
  dedupKey?: string;             // for stacking identical toasts
}
