import { useState, useEffect, useRef } from "react";
import type { Room } from "@/types";
import { 
  FiHome, 
  FiGrid, 
  FiCheckSquare, 
  FiTrendingUp, 
  FiInfo, 
  FiActivity, 
  FiLayers, 
  FiSun, 
  FiLogOut 
} from "react-icons/fi";
import "./CommandPalette.css";

interface CommandPaletteProps {
  rooms: Room[];
  activeRoomId: string | null;
  onClose: () => void;
  onSelectRoom: (room: Room) => void;
  onAction: (action: string) => void;
}

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  action: () => void;
  group: string;
}

export default function CommandPalette({
  rooms, activeRoomId, onClose, onSelectRoom, onAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Build command list
  const commands: CommandItem[] = [];

  // Navigation
  commands.push({ id: "nav-home",     label: "Pergi ke My Rooms",   icon: <FiHome />, group: "Navigasi", action: () => onAction("home") });
  if (activeRoomId) {
    commands.push({ id: "nav-overview", label: "Pergi ke Overview",  icon: <FiGrid />, group: "Navigasi", action: () => onAction("overview") });
    commands.push({ id: "nav-tasks",    label: "Pergi ke Tasks",     icon: <FiCheckSquare />, group: "Navigasi", action: () => onAction("tasks") });
    commands.push({ id: "nav-ledger",   label: "Pergi ke Ledger",    icon: <FiTrendingUp />, group: "Navigasi", action: () => onAction("ledger") });
    commands.push({ id: "nav-room",     label: "Pergi ke Room Info", icon: <FiInfo />, group: "Navigasi", action: () => onAction("room") });
    commands.push({ id: "nav-activity", label: "Pergi ke Activity",  icon: <FiActivity />, group: "Navigasi", action: () => onAction("activity") });
  }

  // Quick actions
  commands.push({ id: "act-theme",    label: "Toggle Light/Dark Theme", icon: <FiSun />, group: "Aksi Cepat", action: () => onAction("toggle-theme") });
  commands.push({ id: "act-signout",  label: "Sign Out",                icon: <FiLogOut />, group: "Aksi Cepat", action: () => onAction("signout") });

  // Rooms
  rooms.forEach(r => {
    commands.push({
      id: `room-${r.id}`,
      label: `Buka room: ${r.project_name}`,
      hint: r.room_code,
      icon: <FiLayers />,
      group: "Rooms",
      action: () => { onSelectRoom(r); onClose(); }
    });
  });

  // Filter by query
  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  // Group filtered commands
  const groups: Record<string, CommandItem[]> = {};
  filtered.forEach(c => {
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const flatFiltered = Object.values(groups).flat();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = flatFiltered[selectedIdx];
      if (cmd) cmd.action();
    }
  };

  return (
    <div className="cmd-palette-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-palette fade-in">
        <input
          ref={inputRef}
          type="text"
          className="cmd-input"
          placeholder="Ketik perintah atau cari room..."
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={handleKeyDown}
        />
        <div className="cmd-list">
          {flatFiltered.length === 0 ? (
            <div className="cmd-empty">Tidak ada hasil.</div>
          ) : (
            Object.entries(groups).map(([groupName, items]) => (
              <div key={groupName} className="cmd-group">
                <div className="cmd-group-label">{groupName}</div>
                {items.map(item => {
                  const idx = flatFiltered.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      className={`cmd-item ${idx === selectedIdx ? "selected" : ""}`}
                      onClick={() => item.action()}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <span className="cmd-item-icon">{item.icon}</span>
                      <span className="cmd-item-label">{item.label}</span>
                      {item.hint && <span className="cmd-item-hint">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="cmd-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigasi</span>
          <span><kbd>Enter</kbd> pilih</span>
          <span><kbd>Esc</kbd> tutup</span>
        </div>
      </div>
    </div>
  );
}
