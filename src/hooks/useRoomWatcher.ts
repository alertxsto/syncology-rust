/**
 * useRoomWatcher — subscribe to real-time updates from the Rust backend.
 *
 * Replaces the polling-based setInterval pattern in Dashboard.tsx.
 * Watches 4 channels: tasks, messages, nudges, events.
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Task, ChatMessage, Nudge, ActivityEvent } from "@/types";

interface UseRoomWatcherOptions {
  roomId: string | null;
  onTasks?: (tasks: Task[]) => void;
  onMessages?: (messages: ChatMessage[]) => void;
  onNudges?: (nudges: Nudge[]) => void;
  onEvents?: (events: ActivityEvent[]) => void;
}

export function useRoomWatcher({
  roomId,
  onTasks,
  onMessages,
  onNudges,
  onEvents,
}: UseRoomWatcherOptions) {
  const unlisteners = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    if (!roomId) return;

    // Start the backend watcher for this room
    invoke("start_room_watcher", { roomId }).catch(console.error);

    const setupListeners = async () => {
      // Tasks
      if (onTasks) {
        const u = await listen<Task[]>("tasks-updated", (e) => {
          onTasks(e.payload);
        });
        unlisteners.current.push(u);
      }
      // Messages
      if (onMessages) {
        const u = await listen<ChatMessage[]>("messages-updated", (e) => {
          onMessages(e.payload);
        });
        unlisteners.current.push(u);
      }
      // Nudges
      if (onNudges) {
        const u = await listen<Nudge[]>("nudges-updated", (e) => {
          onNudges(e.payload);
        });
        unlisteners.current.push(u);
      }
      // Events / Activity
      if (onEvents) {
        const u = await listen<ActivityEvent[]>("events-updated", (e) => {
          onEvents(e.payload);
        });
        unlisteners.current.push(u);
      }
    };
    setupListeners();

    return () => {
      // Stop the watcher
      invoke("stop_room_watcher", { roomId }).catch(console.error);
      // Unsubscribe all listeners
      unlisteners.current.forEach((u) => u());
      unlisteners.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);
}
