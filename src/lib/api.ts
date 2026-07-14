/**
 * Syncology — Typed API Client
 *
 * Wraps all `invoke()` calls with proper TypeScript signatures.
 * Import from this module instead of calling `invoke()` directly:
 *
 *   import { api } from "@/lib/api";
 *   const tasks = await api.getTasks(roomId);
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityEvent,
  ChatMessage,
  FirebaseUser,
  Member,
  Nudge,
  Room,
  Task,
  TaskComment,
  TaskDifficulty,
  TypingState,
  MemberStats,
} from "@/types";

// ── Auth ───────────────────────────────────────────────────────
export const authApi = {
  signInWithGoogle: () =>
    invoke<FirebaseUser>("sign_in_with_google"),

  signOut: () =>
    invoke<void>("sign_out"),
};

// ── Rooms ──────────────────────────────────────────────────────
export const roomApi = {
  create: (input: {
    projectName: string;
    globalDeadline: string | null;
    externalChatUrl: string | null;
  }) =>
    invoke<Record<string, any>>("create_room", input),

  join: (roomCode: string) =>
    invoke<Record<string, any>>("join_room", { roomCode }),

  listMyRooms: () =>
    invoke<Room[]>("list_my_rooms"),

  update: (input: {
    roomId: string;
    projectName: string;
    globalDeadline: string;
    externalChatUrl: string;
  }) =>
    invoke<any>("call_function", {
      functionName: "updateRoom",
      data: input,
    }),

  end: (roomId: string) =>
    invoke<any>("call_function", {
      functionName: "endRoom",
      data: { roomId },
    }),

  removeMember: (roomId: string, memberId: string) =>
    invoke<any>("call_function", {
      functionName: "removeMember",
      data: { roomId, memberId },
    }),

  getEvents: (roomId: string, limit?: number) =>
    invoke<ActivityEvent[]>("get_events", { roomId, limit }),
};

// ── Tasks ──────────────────────────────────────────────────────
export const taskApi = {
  list: (roomId: string) =>
    invoke<Task[]>("get_tasks", { roomId }),

  add: (input: {
    title: string;
    description: string;
    assignedToId: string;
    difficulty: TaskDifficulty;
    internalDeadline: string;
    roomId: string;
  }) =>
    invoke<string>("add_task", input),

  update: (taskId: string, data: Partial<Task>, roomId: string) =>
    invoke<void>("update_task", { taskId, data, roomId }),

  delete: (taskId: string, roomId: string) =>
    invoke<void>("delete_task", { taskId, roomId }),

  // Cloud-function-routed actions (now run locally in Rust)
  submitEvidence: (
    taskId: string,
    evidenceUrl: string,
    roomId: string,
    extra?: { githubUrl?: string; imageUrls?: string[]; notes?: string }
  ) =>
    invoke<any>("call_function", {
      functionName: "submitEvidence",
      data: {
        taskId,
        evidenceUrl,
        roomId,
        githubUrl: extra?.githubUrl ?? "",
        imageUrls: extra?.imageUrls ?? [],
        notes: extra?.notes ?? "",
      },
    }),

  review: (input: {
    taskId: string;
    reviewerId: string;
    decision: "approve" | "reject";
    reason: string;
    roomId: string;
  }) =>
    invoke<any>("call_function", {
      functionName: "reviewTask",
      data: input,
    }),

  rescue: (taskId: string, roomId: string) =>
    invoke<any>("call_function", {
      functionName: "rescueTask",
      data: { taskId, roomId },
    }),

  dispute: (taskId: string, roomId: string) =>
    invoke<any>("call_function", {
      functionName: "disputeTask",
      data: { taskId, roomId },
    }),

  callForBackup: (taskId: string, message: string, roomId: string) =>
    invoke<any>("call_function", {
      functionName: "callForBackup",
      data: { taskId, message, roomId },
    }),

  giveKudos: (taskId: string, toId: string, roomId: string) =>
    invoke<any>("call_function", {
      functionName: "giveKudos",
      data: { taskId, toId, roomId },
    }),

  // Phase 5 — Task Detail
  getComments: (taskId: string, roomId: string) =>
    invoke<TaskComment[]>("get_task_comments", { taskId, roomId }),

  addComment: (taskId: string, roomId: string, text: string) =>
    invoke<any>("add_task_comment", { taskId, roomId, text }),

  // Phase 7 — Dependencies
  setBlockedBy: (taskId: string, roomId: string, blockedBy: string[]) =>
    invoke<any>("set_task_blocked_by", { taskId, roomId, blockedBy }),
};

// ── Members ────────────────────────────────────────────────────
export const memberApi = {
  list: (roomId: string) =>
    invoke<Member[]>("get_members", { roomId }),

  sendNudge: (toId: string, taskId: string, roomId: string) =>
    invoke<any>("call_function", {
      functionName: "sendNudge",
      data: { toId, taskId, roomId },
    }),

  // Phase 12 — Profile stats
  getStats: (roomId: string, uid: string) =>
    invoke<MemberStats>("get_member_stats", { roomId, uid }),
};

// ── Chat ───────────────────────────────────────────────────────
export const chatApi = {
  list: (roomId: string) =>
    invoke<ChatMessage[]>("get_room_messages", { roomId }),

  send: (roomId: string, body: string, replyTo?: string) =>
    invoke<any>("send_room_message", { roomId, body, replyTo: replyTo ?? "" }),

  edit: (roomId: string, messageId: string, body: string) =>
    invoke<any>("edit_room_message", { roomId, messageId, body }),

  react: (roomId: string, messageId: string, emoji: string) =>
    invoke<any>("add_message_reaction", { roomId, messageId, emoji }),

  // Phase 9 — Typing indicator
  setTyping: (roomId: string) =>
    invoke<void>("set_typing", { roomId }),

  getTyping: (roomId: string) =>
    invoke<TypingState[]>("get_typing", { roomId }),
};

// ── Nudges ─────────────────────────────────────────────────────
export const nudgeApi = {
  list: (roomId: string) =>
    invoke<Nudge[]>("get_nudges", { roomId }),

  markRead: (nudgeId: string, roomId: string) =>
    invoke<void>("mark_nudge_read", { nudgeId, roomId }),

  markAllRead: (roomId: string) =>
    invoke<void>("mark_all_nudges_read", { roomId }),
};

// ── Aggregate export ───────────────────────────────────────────
export const api = {
  auth: authApi,
  room: roomApi,
  task: taskApi,
  member: memberApi,
  chat: chatApi,
  nudge: nudgeApi,
};
