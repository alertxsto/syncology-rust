# Syncology — Changelog v2.2.0

> Major overhaul: 3 critical bug fixes + 27 feature/UI improvements across Rust backend and React frontend.

---

## 🛠️ Critical Fixes (Phase 1)

### Fix #1 — Difficulty mapping bug
**File:** `src-tauri/src/database/manager.rs`

Backend previously matched difficulty case-sensitively (`"easy"` / `"hard"`), but frontend sends CamelCase (`"Easy"` / `"Very Hard"`). All "Very Hard" tasks were silently stored as `weight: 10` (same as Medium).

**Fix:** New `weight_for_difficulty()` helper using `.to_lowercase()` with explicit case for `"very hard" => 35`.

### Fix #2 — Nudge field mismatch
**File:** `src-tauri/src/database/manager.rs`

Backend wrote `from_id` / `to_id`, frontend filtered by `to_uid`. Result: nudge notifications never reached the recipient — the entire feature was dead code from the recipient's perspective.

**Fix:** Aligned field names. Now writes `from_uid` / `to_uid` (Auth UIDs) + `from_member_id` (Firestore doc ID) + `read: false` flag for unread tracking.

### Fix #3 — Server-side authorization (security hole)
**Files:** `src-tauri/src/database/manager.rs`, `src-tauri/src/commands/api.rs`

Backend had **zero authorization checks**. Any authenticated user could `endRoom` any room, `removeMember` to kick leaders, `reviewTask` to approve their own work, etc.

**Fix:** Added `assert_leader()` and `assert_member()` helpers. Applied to:
- `submit_evidence_local` — only assignee
- `review_task_local` — only assigned reviewer
- `rescue_task_local` — only non-assignee members, task must be in ghost pool
- `call_for_backup_local` — only assignee or leader
- `remove_member_local` — only leader, cannot remove another leader
- `end_room_local` — only leader
- `update_room_local` — only leader

---

## 🏗️ Foundation (Phase 2)

- **TypeScript types** (`src/types/index.ts`) — Full typed models for `Room`, `Member`, `Task`, `ChatMessage`, `Nudge`, `ActivityEvent`, `TaskComment`, `MemberStats`, `BadgeId`, etc. Matches Firestore schemas.
- **API client wrapper** (`src/lib/api.ts`) — Typed `api.auth.*`, `api.room.*`, `api.task.*`, `api.member.*`, `api.chat.*`, `api.nudge.*`. Import this instead of calling `invoke()` directly.
- **Utility helpers** (`src/lib/utils.ts`) — Date formatting, audio chime (4 variants: nudge/backup/success/error), class names, local storage prefs, ID generation.
- **Path alias** `@/` configured in `vite.config.ts` and `tsconfig.json`.
- **Token refresh** (`src-tauri/src/services/auth.rs`) — Stores `refresh_token`, `expires_at`. `ensure_valid_token()` auto-refreshes 5 min before expiry. Background task spawned on login refreshes every 50 minutes.

---

## 🚀 Backend New Commands (Phase 3)

Added 14 new `#[tauri::command]` handlers in `commands/api.rs`:

| Command | Purpose |
|---------|---------|
| `get_events` | Fetch activity log (audit trail) |
| `get_task_comments`, `add_task_comment`, `delete_task_comment` | Task-level comment threads |
| `set_typing`, `get_typing` | Chat typing indicator (3s TTL) |
| `edit_room_message` | Edit sent message (sender-only, sets `edited: true`) |
| `mark_nudge_read`, `mark_all_nudges_read` | Unread tracking |
| `set_task_blocked_by` | Task dependencies |
| `get_member_stats` | Member profile: streaks, badges, completion stats |

**Activity log:** All key actions now emit audit events to `rooms/{roomId}/events`:
- `room_created`, `room_updated`, `room_ended`
- `member_joined`, `member_removed`
- `task_proposed`, `task_approved`, `task_rejected`, `task_rescued`
- `evidence_submitted`, `nudge_sent`, `backup_called`

**Message schema additions:** `edited`, `edited_at`, `reply_to` fields.

**Streak computation:** Walks `completed_at` dates, finds consecutive days, returns `current_streak` + `longest_streak`.

**Badge system:** Auto-awarded based on stats:
- `first_blood` (1 task), `rescuer` (1 rescue), `ghostbuster` (5 rescues)
- `mentor` (10 reviews), `streak_7`, `streak_30`
- `nudge_master` (50 nudges), `point_legend` (500 pts), `team_player` (25 tasks)

---

## 🔄 Real-Time Watcher (Phase 4)

**Files:** `src-tauri/src/commands/api.rs`, `src/hooks/useRoomWatcher.ts`

Replaces `setInterval(loadMessages, 3000)` polling with Tauri Event Bridge:
- Rust `start_room_watcher` spawns background task that polls Firestore every 2.5s
- Hash-based change detection for tasks (no false positives)
- Count-based detection for messages, nudges, events
- Emits `tasks-updated`, `messages-updated`, `nudges-updated`, `events-updated` events
- React hook `useRoomWatcher` auto-subscribes and cleans up on room change

---

## 🎯 High-Impact UI (Phase 5–6)

### Task Detail Modal (`TaskDetailModal.tsx`)
Click any task card → modal with:
- Full description, evidence link, rejection reason
- People grid (assignee, proposer, reviewer)
- Metadata grid (difficulty, points, deadline, category)
- Visual timeline (Proposed → Approved → Submitted → Completed)
- Blocked-by chips (dependencies)
- **Comments thread** — full CRUD with author-only delete, self/other visual differentiation, auto-scroll

### Activity Tab (`ActivityTab.tsx`)
New sidebar entry. Shows audit log grouped by day with:
- Filter chips (All / Task / Member / Nudge / Room)
- Per-event icon, actor name, action label, relative time
- Real-time updates via event bridge

### Cross-Room Dashboard (`CrossRoomDashboard.tsx`)
Shows on My Rooms tab when user has ≥1 room:
- Aggregate stats across all rooms (Open / Review / Done / Overdue / Ghost)
- Upcoming deadlines (top 8, sorted by date, color-coded)
- Per-room summary cards with stat chips

### Calendar View (`CalendarView.tsx`)
Toggle Kanban/Calendar in Tasks tab:
- Month grid with task dots colored by status (overdue/done/ghost)
- Click task to open Task Detail Modal
- Prev/Next month navigation + "Today" button
- Mobile: horizontal scroll, dots only

---

## 🎨 UI Polish (Phase 8–10)

### Drag-and-drop Kanban
HTML5 native (no dependency added). Drag task between columns:
- Todo → triggers `update_task` (only if proposed + leader)
- In Review → prompts for evidence URL (assignee only)
- Done → intentionally disallowed (must go through review)

Visual feedback: dragged card opacity 0.4, target column highlighted with accent-dim background.

### Mobile Responsive
- <768px: sidebar becomes bottom nav, chat/notif become full-screen modals
- 768–1024px: kanban horizontal scroll, stat cards 2-col grid
- All modals go full-screen on mobile

### Difficulty Color Coding
Task card border-left now uses difficulty color (not just escalation):
- Easy → green
- Medium → accent blue
- Hard → amber
- Very Hard → red

### Skeleton Loaders
`<SkeletonList />` component with shimmer animation replaces flash of empty state.

### Empty States with CTAs
"Belum ada room" now includes prominent "+ Buat Room" button.

### Light/Dark Theme Toggle
- 2 complete CSS variable sets (`[data-theme="dark"]` and `[data-theme="light"]`)
- Toggle button in sidebar bottom
- Preference persisted to `localStorage`
- Applies to all components automatically via CSS variables

### Confetti
Triggered on task approval / rescue success. 80 particles, 3-second animation, 3 shapes (circle/square/triangle), 6 colors.

### Toast Stacking & Dedup
- Cap at 5 visible toasts
- Dedup by `dedupKey` within 5-second window (e.g., 3 nudges from same sender on same task = 1 toast)
- 4 variants with colored left border (nudge/backup/success/error/info)

---

## ⌨️ Productivity (Phase 11)

### Command Palette (⌘K / Ctrl+K)
- Fuzzy search across navigation, rooms, quick actions
- Keyboard nav (↑↓ Enter Esc)
- Grouped results (Navigasi / Aksi Cepat / Rooms)
- Footer with keyboard hints

### Keyboard Shortcuts
- `1`–`6` — switch tabs (when not typing in input)
- `⌘K` / `Ctrl+K` — command palette
- `Esc` — close any modal (already existed, now consistent)

### Onboarding Tour
First-time users get an 8-step overlay tour:
1. Welcome
2. Create/Join room
3. Propose & assign task
4. Submit evidence & review
5. Ghost pool & rescue
6. Nudge & chat
7. Command palette hint
8. Done

Skips persist `onboarding_done: true` to localStorage.

---

## 👤 Member Profile (Phase 12)

Click any member avatar/name → modal with:
- Hero section: avatar, name, role, current/longest streak, total points
- 6-cell stats grid: completed, assigned, overdue, rescues, nudges sent/received
- 12-week activity heatmap (placeholder — needs backend aggregation for real data)
- 9-badge grid with earned/locked states and tooltips

### Export CSV
Ledger tab now has "Export CSV" button. Downloads `ledger-{roomId}.csv` with rank, name, role, points, completed, nudge pts, ghost status.

### Desktop Notifications (partial)
Toast system now uses 4 distinct chime variants. Native OS notifications via `tauri-plugin-notification` are documented in `DOCUMENTATION.md` but require adding the Cargo dependency — left as a documented next step.

---

## 📦 Files Added

```
src/types/index.ts                       (new — typed models)
src/lib/api.ts                           (new — typed API client)
src/lib/utils.ts                         (new — helpers)
src/hooks/useRoomWatcher.ts              (new — real-time listener)
src/components/TaskDetailModal.tsx       (new)
src/components/TaskDetailModal.css       (new)
src/components/ActivityTab.tsx           (new)
src/components/Activity.css              (new)
src/components/CrossRoomDashboard.tsx    (new)
src/components/CrossRoomDashboard.css    (new)
src/components/CalendarView.tsx          (new)
src/components/CalendarView.css          (new)
src/components/CommandPalette.tsx        (new)
src/components/CommandPalette.css        (new)
src/components/MemberProfileModal.tsx    (new)
src/components/MemberProfileModal.css    (new)
src/components/Confetti.tsx              (new)
src/components/Confetti.css              (new)
src/components/OnboardingTour.tsx        (new)
src/components/OnboardingTour.css        (new)
src/components/Skeleton.tsx              (new)
src/components/Skeleton.css              (new)
```

## 📝 Files Modified

```
src/App.tsx                              (unchanged)
src/pages/Dashboard.tsx                  (rewritten — real-time, chat UX, theme, command palette, onboarding, profile)
src/components/TaskCard.tsx              (rewritten — opens detail modal, difficulty color, blocked badge)
src/components/TasksTab.tsx              (rewritten — calendar toggle, drag-and-drop, real-time subscription)
src/components/OverviewTab.tsx           (rewritten — member capacity, skeleton, onMemberClick)
src/components/LedgerTab.tsx             (rewritten — CSV export, onMemberClick)
src/components/RoomInfoTab.tsx           (patched — onMemberClick)
src/styles/index.css                     (added light theme + dark/light variable groups)
src/pages/Dashboard.css                  (added toast variants, chat UX, mobile responsive)
src/components/Tasks.css                 (added view toggle, drag-and-drop, blocked badge, mobile)
src/components/Overview.css              (added capacity chips, overloaded state)
index.html                               (title fix)
vite.config.ts                           (path alias @/)
tsconfig.json                            (path alias @/)
src-tauri/src/lib.rs                     (registered 14 new commands)
src-tauri/src/commands/api.rs            (added 14 commands + start/stop_room_watcher)
src-tauri/src/services/auth.rs           (token refresh logic)
src-tauri/src/database/manager.rs        (3 fixes + 9 new methods + audit logging)
```

---

## ✅ What to Test After Pulling

1. **Difficulty mapping** — propose a "Very Hard" task → check Firestore `weight: 35` (not 10)
2. **Nudge flow** — user A nudges user B → user B sees toast within 2.5s
3. **Authorization** — try `invoke("call_function", { functionName: "endRoom", data: { roomId: "<other-room>" } })` as non-leader → expect 403-like error
4. **Token refresh** — keep app open >1 hour → verify no 401 errors
5. **Task Detail Modal** — click task card → modal opens with timeline + comments
6. **Drag-and-drop** — drag todo task to "In Review" → evidence prompt appears (assignee only)
7. **Calendar view** — toggle in Tasks tab → month grid renders with task dots
8. **Command palette** — press ⌘K → search rooms / nav
9. **Onboarding** — clear `localStorage.onboarding_done` → tour appears on next login
10. **Theme toggle** — click sun/moon in sidebar → all components re-theme instantly
11. **Mobile** — resize window <768px → sidebar moves to bottom, chat goes fullscreen
12. **Member profile** — click any member in Ledger/Overview → profile modal with badges

---

## ⏭️ Known Limitations / Next Steps

1. **Firestore rules** — backend authz is in Rust, but Firestore itself still allows direct read/write to anyone with the API key. Add proper Firestore Security Rules.
2. **Native desktop notifications** — add `tauri-plugin-notification = "2.0.0"` to `Cargo.toml` and wire up `sendNotification()` calls in the toast handler.
3. **File upload for evidence** — currently URL-only. Next: integrate Firebase Storage REST upload.
4. **Recurring tasks** — schema has `recurrence` field but no background job creates instances yet. Needs a cron-like task in Rust.
5. **Activity heatmap in Member Profile** — placeholder only. Real implementation needs daily aggregation in Firestore.
6. **N+1 in `list_my_rooms`** — still scans all rooms then queries each member subcollection. Use Firestore structured query on `members` filtered by `uid` instead.
7. **Race conditions on counters** — nudge limit + reaction toggle still use read-modify-write. Wrap in Firestore transactions or use `FieldValue.arrayUnion/arrayRemove`.
