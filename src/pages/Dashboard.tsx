import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, Member, Toast, ToastType } from "@/types";
import { useRoomWatcher } from "@/hooks/useRoomWatcher";
import { cx, playChime, formatTime, initials, loadPref, savePref } from "@/lib/utils";
import TasksTab from "../components/TasksTab";
import RoomInfoTab from "../components/RoomInfoTab";
import OverviewTab from "../components/OverviewTab";
import LedgerTab from "../components/LedgerTab";
import HomeTab from "../components/HomeTab";
import ActivityTab from "../components/ActivityTab";
import CrossRoomDashboard from "../components/CrossRoomDashboard";
import CommandPalette from "../components/CommandPalette";
import MemberProfileModal from "../components/MemberProfileModal";
import Confetti from "../components/Confetti";
import OnboardingTour from "../components/OnboardingTour";
import "./Dashboard.css";

interface DashboardProps {
  user: any;
  onSignOut: () => void;
}

/* ── SVG Icons ─────────────────────────────────────────────────── */
const IconHome = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IconGrid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
  </svg>
);
const IconTask = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
);
const IconLedger = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);
const IconRoom = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconActivity = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
  </svg>
);
const IconLogout = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
  </svg>
);
const IconSun = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
  </svg>
);
const IconMoon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
);

/* ── NavItem ───────────────────────────────────────────────────── */
function NavItem({ icon, label, active, disabled, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <div className="nav-item">
      <button
        className={cx("nav-item-btn", active && "active")}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {icon}
      </button>
      {!disabled && <span className="nav-tooltip">{label}</span>}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */
export default function Dashboard({ user, onSignOut }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<string>("home");
  const [roomId, setRoomId]       = useState<string | null>(null);
  const [roomName, setRoomName]   = useState<string | null>(null);
  const [roomCode, setRoomCode]   = useState<string | null>(null);
  const [role, setRole]           = useState("member");
  const [rooms, setRooms]         = useState<any[]>([]);
  const [toasts, setToasts]       = useState<Toast[]>([]);
  const [theme, setTheme]         = useState<"dark" | "light">(loadPref("theme", "dark"));
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(!loadPref("onboarding_done", false));
  const [showConfetti, setShowConfetti] = useState(false);
  const [profileMemberUid, setProfileMemberUid] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<{ version: string; body?: string; date?: string } | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  // Chat & Notification State
  const [showChat, setShowChat] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<any[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  const [membersMap, setMembersMap] = useState<Record<string, Member>>({});
  const chatListRef = useRef<HTMLDivElement>(null);
  const lastNotifCount = useRef(0);

  /* ── Theme management ───────────────────────────────────────── */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    savePref("theme", theme);
  }, [theme]);

  /* ── Toast system with dedup ────────────────────────────────── */
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((title: string, message: string, type: ToastType = "info", taskId?: string, senderName?: string, dedupKey?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => {
      // Dedup: if same dedupKey exists in last 5 seconds, skip
      if (dedupKey) {
        // Karena t.id berupa string, kita tidak bisa langsung kurangi dari Date.now().
        // Tapi kita bisa bandingkan dedupKey di list yang aktif saat ini.
        const existing = prev.find(t => t.dedupKey === dedupKey);
        if (existing) return prev;
      }
      const newToasts = [...prev, { id, title, message, type, taskId, senderName, dedupKey }];
      // Cap at 5 toasts visible
      return newToasts.slice(-5);
    });
    if (type === "nudge" || type === "backup") {
      playChime(type);
    } else if (type === "success") {
      playChime("success");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    } else if (type === "error") {
      playChime("error");
    }
    // Auto-dismiss after 4 seconds (safe and specific by ID)
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  /* ── Data loaders ───────────────────────────────────────────── */
  const loadData = async () => {
    try {
      const fetchedRooms: any[] = await invoke("list_my_rooms");
      setRooms(fetchedRooms);
      if (fetchedRooms && fetchedRooms.length > 0) {
        const current = fetchedRooms.find(r => r.id === roomId);
        if (current) {
          setRoomName(current.project_name);
          setRoomCode(current.room_code);
          setRole(current.my_role || "member");
        }
      } else if (!roomId) {
        setRoomId(null); setRoomName(null); setRoomCode(null);
        setActiveTab("home");
      }
    } catch (e) { console.error(e); }
  };

  const loadMembers = async () => {
    if (!roomId) return;
    try {
      const list = await invoke<Member[]>("get_members", { roomId });
      const map: Record<string, Member> = {};
      list.forEach(m => { map[m.uid] = m; });
      setMembersMap(map);
    } catch (e) { console.error("Gagal load members:", e); }
  };

  /* ── Real-time watcher (replaces polling) ───────────────────── */
  useRoomWatcher({
    roomId,
    onTasks: () => { /* TasksTab has its own listener */ },
    onMessages: (msgs) => {
      setChatMessages(msgs);
      // Auto-scroll to bottom
      setTimeout(() => {
        if (chatListRef.current) {
          chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
        }
      }, 50);
    },
    onNudges: (nudges) => {
      const myNewNudges = nudges.filter(n => n.to_uid === user.uid && n.read === false);
      if (myNewNudges.length === 0) return;

      // Dedup by nudge id
      setNotifs(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const fresh = myNewNudges.filter(n => !existingIds.has(n.id));
        if (fresh.length === 0) return prev;

        // Show toasts (deduped by sender+task)
        fresh.forEach(n => {
          const fromName = n.from_name || "Seseorang";
          addToast(
            "👉 Kamu Di-nudge!",
            `${fromName} menyenggolmu untuk merespon tugas.`,
            "nudge",
            n.task_id,
            fromName,
            `nudge-${n.from_uid}-${n.task_id}`,
          );
        });

        return [
          ...fresh.map(n => ({
            id: n.id,
            type: "nudge" as const,
            title: "👉 Senggolon (Nudge) Masuk",
            body: `Kamu disenggol oleh ${n.from_name}. Buruan selesaikan tugasmu!`,
            taskId: n.task_id,
            timestamp: n.timestamp || new Date().toISOString(),
          })),
          ...prev,
        ];
      });

      // Mark nudges as read after 5 seconds (so user has time to see them)
      setTimeout(async () => {
        try {
          await invoke("mark_all_nudges_read", { roomId });
        } catch (e) { console.error(e); }
      }, 5000);
    },
    onEvents: (events) => {
      // Detect new task approvals (for confetti)
      const newCount = events.filter(e => e.event_type === "task_approved").length;
      if (newCount > lastNotifCount.current && lastNotifCount.current > 0) {
        // Find newly approved tasks for current user
        const recent = events.slice(0, newCount - lastNotifCount.current);
        const myApproval = recent.find(e =>
          e.event_type === "task_approved" &&
          e.payload?.task_id
        );
        if (myApproval) {
          addToast("✅ Task Disetujui!", "Poin telah masuk ke akunmu.", "success");
        }
      }
      lastNotifCount.current = newCount;
    },
  });

  // Initial load
  useEffect(() => {
    loadData();
  }, []);

  // Updater check (once on startup)
  useEffect(() => {
    const run = async () => {
      try {
        const res = await invoke<any>("check_for_update");
        if (res?.available && res?.version) {
          setAvailableUpdate({ version: res.version, body: res.body, date: res.date });
          addToast("⬆ Update tersedia", `Versi ${res.version} siap diinstal.`, "info");
        }
      } catch (e) {
        console.warn("Updater check skipped:", e);
      }
    };
    run();
  }, [addToast]);

  // Load members when room changes
  useEffect(() => {
    if (roomId) {
      loadMembers();
    } else {
      setMembersMap({});
      setChatMessages([]);
      setNotifs([]);
    }
  }, [roomId]);

  /* ── Typing indicator polling ───────────────────────────────── */
  useEffect(() => {
    if (!roomId || !showChat) {
      setTypingUsers([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const typing = await invoke<any[]>("get_typing", { roomId });
        if (!cancelled) {
          setTypingUsers(typing.filter(t => t.uid !== user.uid));
        }
      } catch (e) { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [roomId, showChat, user.uid]);

  /* ── Keyboard shortcuts ─────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K — command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      // Number keys 1-6 to switch tabs (when not typing)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        if (e.key === "1") setActiveTab("home");
        if (e.key === "2" && roomId) setActiveTab("overview");
        if (e.key === "3" && roomId) setActiveTab("tasks");
        if (e.key === "4" && roomId) setActiveTab("ledger");
        if (e.key === "5" && roomId) setActiveTab("room");
        if (e.key === "6" && roomId) setActiveTab("activity");
        if (e.key === "n" && roomId) {
          // Trigger propose task — would need a global event
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roomId]);

  /* ── Handlers ───────────────────────────────────────────────── */
  const handleSignOut = async () => {
    try { await invoke("sign_out"); onSignOut(); } catch (e) { console.error(e); }
  };

  const selectRoom = (room: any) => {
    setRoomId(room.id);
    setRoomName(room.project_name);
    setRoomCode(room.room_code);
    setRole(room.my_role || "member");
    setActiveTab("overview");
    setChatMessages([]);
    setNotifs([]);
    setMembersMap({});
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !roomId) return;
    const body = chatInput.trim();
    setChatInput("");
    const replyTarget = replyTo;
    setReplyTo(null);
    setEditingMessage(null);
    try {
      if (editingMessage) {
        await invoke("edit_room_message", {
          roomId,
          messageId: editingMessage.id,
          body,
        });
      } else {
        await invoke("send_room_message", {
          roomId,
          body,
          replyTo: replyTarget?.id ?? "",
        });
      }
    } catch (e) { console.error(e); }
  };

  const handleTyping = async () => {
    if (!roomId) return;
    try { await invoke("set_typing", { roomId }); } catch (e) { /* ignore */ }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!roomId) return;
    try {
      await invoke("add_message_reaction", { roomId, messageId, emoji });
    } catch (e) { console.error("Gagal toggle reaksi:", e); }
  };

  const handleEditMessage = (msg: ChatMessage) => {
    setEditingMessage(msg);
    setChatInput(msg.message_body);
    setReplyTo(null);
  };

  const parseMessageBody = (text: string) => {
    // Highlight @mentions and #task-refs
    const parts: any[] = [];
    const regex = /(@[a-zA-Z0-9_-]+|#[a-zA-Z0-9-]{5,})/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      const token = match[1];
      if (token.startsWith("@")) {
        parts.push(
          <span key={key++} className="mention">{token}</span>
        );
      } else {
        const taskId = token.substring(1);
        parts.push(
          <button
            key={key++}
            className="task-ref-link"
            onClick={() => {
              setHighlightedTaskId(taskId);
              setActiveTab("tasks");
              setShowChat(false);
              setShowNotif(false);
            }}
          >
            #{taskId.substring(0, 6)}
          </button>
        );
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  };

  const filteredMessages = chatSearch
    ? chatMessages.filter(m =>
        m.message_body.toLowerCase().includes(chatSearch.toLowerCase()) ||
        m.sender_name.toLowerCase().includes(chatSearch.toLowerCase())
      )
    : chatMessages;

  const roomHasValue = !!roomId;

  const handleInstallUpdate = async () => {
    if (!availableUpdate || installingUpdate) return;
    const ok = window.confirm(`Update v${availableUpdate.version} tersedia. Install sekarang? Aplikasi akan restart setelah selesai.`);
    if (!ok) return;

    try {
      setInstallingUpdate(true);
      addToast("Mengunduh update", `Sedang memasang v${availableUpdate.version}...`, "info");
      await invoke("install_update");
    } catch (e) {
      console.error(e);
      addToast("Update gagal", "Gagal memasang update. Coba lagi nanti.", "error");
      setInstallingUpdate(false);
    }
  };

  const tabLabel: Record<string, string> = {
    home: "My Rooms",
    overview: "Overview",
    tasks: "Tasks",
    ledger: "Ledger",
    room: "Room Info",
    activity: "Activity",
  };

  return (
    <div className="dashboard fade-in" data-theme={theme}>
      {/* Confetti */}
      {showConfetti && <Confetti />}

      {/* Command Palette */}
      {showCommandPalette && (
        <CommandPalette
          rooms={rooms}
          activeRoomId={roomId}
          onClose={() => setShowCommandPalette(false)}
          onSelectRoom={(r) => { selectRoom(r); setShowCommandPalette(false); }}
          onAction={(action) => {
            setShowCommandPalette(false);
            if (action === "home") setActiveTab("home");
            else if (action === "tasks" && roomId) setActiveTab("tasks");
            else if (action === "ledger" && roomId) setActiveTab("ledger");
            else if (action === "room" && roomId) setActiveTab("room");
            else if (action === "activity" && roomId) setActiveTab("activity");
            else if (action === "toggle-theme") setTheme(t => t === "dark" ? "light" : "dark");
            else if (action === "signout") handleSignOut();
          }}
        />
      )}

      {/* Onboarding tour */}
      {showOnboarding && (
        <OnboardingTour
          onClose={() => {
            setShowOnboarding(false);
            savePref("onboarding_done", true);
          }}
        />
      )}

      {/* Member profile modal */}
      {profileMemberUid && roomId && (
        <MemberProfileModal
          uid={profileMemberUid}
          roomId={roomId}
          onClose={() => setProfileMemberUid(null)}
        />
      )}

      {/* Toast */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={cx("toast", `toast-${t.type}`)} style={{ position: "relative" }}>
            <button
              onClick={() => removeToast(t.id)}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                background: "none",
                border: "none",
                color: "var(--text-3)",
                cursor: "pointer",
                fontSize: "12px",
                padding: "2px 6px",
                borderRadius: "4px",
                lineHeight: 1,
              }}
              title="Tutup notifikasi"
            >
              ✕
            </button>
            <div className="toast-title" style={{ paddingRight: "18px" }}>{t.title}</div>
            <div className="toast-message">{t.message}</div>
            {t.type && t.type !== "info" && (
              <div className="toast-actions">
                {t.taskId && (
                  <button
                    className="toast-btn toast-btn-primary"
                    onClick={() => {
                      setHighlightedTaskId(t.taskId!);
                      setActiveTab("tasks");
                      removeToast(t.id);
                    }}
                  >
                    Lihat Tugas
                  </button>
                )}
                {t.type === "nudge" && (
                  <button
                    className="toast-btn"
                    onClick={() => {
                      setChatInput("Oke, lagi gw kerjain!");
                      setShowChat(true);
                      setShowNotif(false);
                      removeToast(t.id);
                    }}
                  >
                    Balas Chat
                  </button>
                )}
              </div>
            )}
            <div className="toast-progress" />
          </div>
        ))}
      </div>

      {/* ── Slim Sidebar ──────────────────────────────────────── */}
      <div className="sidebar">
        <div className="sidebar-logo">S</div>

        <nav className="sidebar-nav">
          <NavItem icon={<IconHome />}     label="My Rooms"    active={activeTab === "home"}     onClick={() => setActiveTab("home")} />
          <NavItem icon={<IconGrid />}     label="Overview"    active={activeTab === "overview"}  disabled={!roomHasValue} onClick={() => { setActiveTab("overview"); setShowChat(false); setShowNotif(false); }} />
          <NavItem icon={<IconTask />}     label="Tasks"       active={activeTab === "tasks"}     disabled={!roomHasValue} onClick={() => { setActiveTab("tasks"); setShowChat(false); setShowNotif(false); }} />
          <NavItem icon={<IconLedger />}   label="Ledger"      active={activeTab === "ledger"}    disabled={!roomHasValue} onClick={() => { setActiveTab("ledger"); setShowChat(false); setShowNotif(false); }} />
          <NavItem icon={<IconRoom />}     label="Room Info"   active={activeTab === "room"}      disabled={!roomHasValue} onClick={() => { setActiveTab("room"); setShowChat(false); setShowNotif(false); }} />
          <NavItem icon={<IconActivity />} label="Activity"    active={activeTab === "activity"}  disabled={!roomHasValue} onClick={() => { setActiveTab("activity"); setShowChat(false); setShowNotif(false); }} />
        </nav>

        <div className="sidebar-bottom">
          <div className="nav-item">
            <button
              className="nav-item-btn"
              onClick={() => setShowCommandPalette(true)}
              aria-label="Command palette"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>
              </svg>
            </button>
            <span className="nav-tooltip">Command (⌘K)</span>
          </div>
          <div className="nav-item">
            <button
              className="nav-item-btn"
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <span className="nav-tooltip">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </div>
          <div className="nav-item">
            <button className="nav-item-btn" onClick={handleSignOut} aria-label="Logout">
              <IconLogout />
            </button>
            <span className="nav-tooltip">Logout</span>
          </div>
          <div className="nav-item">
            <div
              className="avatar-btn"
              title={user.displayName}
              onClick={() => roomId && setProfileMemberUid(user.uid)}
              style={{ cursor: roomId ? "pointer" : "default" }}
            >
              {initials(user.displayName)}
            </div>
            <span className="nav-tooltip">{user.displayName} · {role}</span>
          </div>
        </div>
      </div>

      {/* ── Main Area ─────────────────────────────────────────── */}
      <div className={`main-area ${showChat ? "main-area-with-chat" : ""}`}>
        {/* Topbar */}
        <div className="topbar">
          <span className="topbar-brand">Syncology</span>
          <span className="topbar-sep">›</span>
          <span className="topbar-room">{tabLabel[activeTab]}</span>
          {roomName && activeTab !== "home" && (
            <>
              <span className="topbar-sep">·</span>
              <span className="topbar-room">{roomName}</span>
              {roomCode && <span className="topbar-code">{roomCode}</span>}
            </>
          )}
          <div className="topbar-spacer" />

          {roomId && (
            <div className="topbar-icons" style={{ marginRight: '12px' }}>
              <button
                className={cx("topbar-icon-btn", showNotif && "active", notifs.length > 0 && "has-badge")}
                onClick={() => { setShowNotif(!showNotif); setShowChat(false); }}
                title="Notifikasi"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              </button>

              <button
                className={cx("topbar-icon-btn", showChat && "active")}
                onClick={() => { setShowChat(!showChat); setShowNotif(false); }}
                title="Obrolan Room"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>
          )}

          <div className="topbar-avatar">{initials(user.displayName)}</div>
        </div>

        {/* Content */}
        <div className="content-body">
          {availableUpdate && (
            <div
              style={{
                marginBottom: "12px",
                border: "1px solid var(--accent)",
                background: "var(--accent-dim)",
                color: "var(--text-1)",
                borderRadius: "var(--r-md)",
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "12px" }}>
                <strong>Update tersedia:</strong> v{availableUpdate.version}
                {availableUpdate.body ? <span style={{ color: "var(--text-2)" }}> · {String(availableUpdate.body).slice(0, 120)}</span> : null}
              </div>
              <button className="btn-primary" onClick={handleInstallUpdate} disabled={installingUpdate}>
                {installingUpdate ? "Installing..." : "Install Update"}
              </button>
            </div>
          )}
          {activeTab === "home"     && (
            rooms.length > 0 ? (
              <div className="home-dashboard-layout" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <CrossRoomDashboard currentUser={user} rooms={rooms} onSelectRoom={selectRoom} onRefreshRooms={loadData} />
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "24px", marginTop: "12px" }}>
                  <HomeTab rooms={rooms} onSelectRoom={selectRoom} onRefreshRooms={loadData} />
                </div>
              </div>
            ) : (
              <HomeTab rooms={rooms} onSelectRoom={selectRoom} onRefreshRooms={loadData} />
            )
          )}
          {activeTab === "overview" && <OverviewTab roomId={roomId} onMemberClick={(uid) => setProfileMemberUid(uid)} />}
          {activeTab === "tasks"    && <TasksTab currentUser={user} roomId={roomId} highlightedTaskId={highlightedTaskId} onClearHighlight={() => setHighlightedTaskId(null)} />}
          {activeTab === "ledger"   && <LedgerTab roomId={roomId} onMemberClick={(uid) => setProfileMemberUid(uid)} />}
          {activeTab === "room"     && <RoomInfoTab currentUser={user} roomId={roomId} onMemberClick={(uid) => setProfileMemberUid(uid)} />}
          {activeTab === "activity" && <ActivityTab roomId={roomId} />}
        </div>
      </div>

      {/* ── Chat Drawer Panel ─────────────────────────────────── */}
      {showChat && roomId && (
        <div className="chat-drawer">
          <div className="chat-header">
            <span className="chat-title">Obrolan Project</span>
            <div className="chat-header-actions">
              <input
                type="text"
                className="chat-search"
                placeholder="🔍 Cari pesan..."
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
              />
              <button className="chat-close-btn" onClick={() => setShowChat(false)}>✕</button>
            </div>
          </div>

          <div className="chat-messages" ref={chatListRef}>
            {filteredMessages.length === 0 ? (
              <div className="notif-empty">
                {chatSearch ? "Tidak ada pesan yang cocok." : "Belum ada obrolan. Kirim pesan pertama Anda!"}
              </div>
            ) : (
              filteredMessages.map((m, idx) => {
                const isSelf = m.sender_id === user.uid;
                const isSystem = m.sender_id === "system";
                const senderProfile = membersMap[m.sender_id];
                const senderRole = senderProfile?.role || "member";
                const replyToMsg = m.reply_to ? chatMessages.find(x => x.id === m.reply_to) : null;

                if (isSystem) {
                  return (
                    <div key={idx} className="chat-msg system">
                      <div className="chat-msg-bubble">{parseMessageBody(m.message_body)}</div>
                    </div>
                  );
                }

                return (
                  <div key={idx} className={cx("chat-msg", isSelf && "self")}>
                    <span className="chat-msg-sender">
                      {m.sender_name}
                      {senderRole === "leader" ? (
                        <span className="badge-leader">Leader</span>
                      ) : (
                        <span className="badge-member">Member</span>
                      )}
                    </span>

                    <div className="chat-msg-bubble-container">
                      <div className="chat-msg-bubble">
                        {replyToMsg && (
                          <div className="reply-preview">
                            <span className="reply-author">{replyToMsg.sender_name}</span>
                            <span className="reply-text">{replyToMsg.message_body.substring(0, 60)}</span>
                          </div>
                        )}
                        {parseMessageBody(m.message_body)}
                        {m.edited && <span className="edited-tag"> (diedit)</span>}

                        {(() => {
                          const reactions = m.reactions || {};
                          const reactionKeys = Object.keys(reactions);
                          if (reactionKeys.some(k => (reactions[k] || []).length > 0)) {
                            return (
                              <div className="reactions-row">
                                {reactionKeys.map(emoji => {
                                  const usersList = reactions[emoji] || [];
                                  if (usersList.length === 0) return null;
                                  const hasReacted = usersList.includes(user.uid);
                                  return (
                                    <button
                                      key={emoji}
                                      className={cx("react-badge", hasReacted && "active")}
                                      onClick={() => handleToggleReaction(m.id, emoji)}
                                    >
                                      {emoji} {usersList.length}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      {/* Action menu */}
                      <div className="msg-actions">
                        {!isSelf && (
                          <button
                            className="msg-action-btn"
                            onClick={() => { setReplyTo(m); setEditingMessage(null); setChatInput(""); }}
                            title="Reply"
                          >↩</button>
                        )}
                        {isSelf && (
                          <button
                            className="msg-action-btn"
                            onClick={() => handleEditMessage(m)}
                            title="Edit"
                          >✏️</button>
                        )}
                        <div className="react-picker">
                          {["👍", "🔥", "🚀", "👀"].map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => handleToggleReaction(m.id, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <span className="chat-msg-time">
                      {formatTime(m.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="typing-indicator">
                {typingUsers.length === 1
                  ? `${typingUsers[0].display_name} sedang mengetik...`
                  : `${typingUsers.length} orang sedang mengetik...`}
                <span className="typing-dots">
                  <span></span><span></span><span></span>
                </span>
              </div>
            )}
          </div>

          {/* Reply / edit preview */}
          {(replyTo || editingMessage) && (
            <div className="chat-preview-bar">
              <div className="chat-preview-content">
                {editingMessage
                  ? <><strong>Edit:</strong> {editingMessage.message_body.substring(0, 50)}</>
                  : <><strong>Balas ke {replyTo!.sender_name}:</strong> {replyTo!.message_body.substring(0, 50)}</>
                }
              </div>
              <button
                className="chat-preview-cancel"
                onClick={() => { setReplyTo(null); setEditingMessage(null); setChatInput(""); }}
              >✕</button>
            </div>
          )}

          <form className="chat-input-area" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="chat-input"
              placeholder={editingMessage ? "Edit pesan..." : "Tulis pesan... (@mention, #task-id)"}
              value={chatInput}
              onChange={e => {
                setChatInput(e.target.value);
                // Trigger typing indicator (throttled)
                if (Math.random() < 0.3) handleTyping();
              }}
            />
            <button type="submit" className="chat-send-btn">
              {editingMessage ? "Update" : "Kirim"}
            </button>
          </form>
        </div>
      )}

      {/* ── Notification Dropdown List ────────────────────────── */}
      {showNotif && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <span>NOTIFIKASI</span>
            {notifs.length > 0 && (
              <button
                className="notif-clear-btn"
                onClick={async () => {
                  if (roomId) {
                    try { await invoke("mark_all_nudges_read", { roomId }); } catch (e) { /* ignore */ }
                  }
                  setNotifs([]);
                }}
              >
                Hapus Semua
              </button>
            )}
          </div>
          <div className="notif-list">
            {notifs.length === 0 ? (
              <div className="notif-empty">Tidak ada notifikasi baru.</div>
            ) : (
              notifs.map(n => (
                <div key={n.id} className="notif-item unread">
                  <div
                    className="notif-item-title"
                    onClick={() => { setActiveTab("tasks"); setShowNotif(false); if(n.taskId) setHighlightedTaskId(n.taskId); }}
                  >
                    {n.title}
                  </div>
                  <div className="notif-item-body">{n.body}</div>
                  <div className="notif-item-actions">
                    {n.taskId && (
                      <button
                        className="notif-btn"
                        onClick={() => {
                          setHighlightedTaskId(n.taskId);
                          setActiveTab("tasks");
                          setShowNotif(false);
                        }}
                      >
                        Fokus Tugas
                      </button>
                    )}
                    {n.type === "backup" && (
                      <button
                        className="notif-btn"
                        style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
                        onClick={async () => {
                          try {
                            await invoke("call_function", { functionName: "rescueTask", data: { taskId: n.taskId, roomId } });
                            setNotifs(prev => prev.filter(item => item.id !== n.id));
                            addToast("✅ Tugas Di-Rescue!", "Kamu berhasil mengambil alih tugas.", "success");
                          } catch(e) { console.error(e); }
                        }}
                      >
                        Rescue
                      </button>
                    )}
                  </div>
                  <span className="notif-item-time">{formatTime(n.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
