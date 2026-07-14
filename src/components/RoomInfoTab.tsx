import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import ConfirmModal from "./ConfirmModal";
import "./RoomInfo.css";

interface RoomInfoTabProps {
  currentUser: any;
  roomId: string | null;
  onMemberClick?: (uid: string) => void;
}

export default function RoomInfoTab({ roomId, onMemberClick }: RoomInfoTabProps) {
  const [room, setRoom]           = useState<any>(null);
  const [members, setMembers]     = useState<any[]>([]);
  const [isLeader, setIsLeader]   = useState(false);
  const [floorWarn, setFloorWarn] = useState("");
  const [copied, setCopied]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState("");
  const [confirm, setConfirm]     = useState<null | { title: string; message: string; danger?: boolean; onConfirm: () => void }>(null);

  // Controlled edit fields
  const [editName, setEditName]       = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editChatUrl, setEditChatUrl] = useState("");

  const loadData = async () => {
    if (!roomId) return;
    try {
      const rooms: any[] = await invoke("list_my_rooms");
      const current = rooms.find(r => r.id === roomId);
      if (current) {
        setRoom(current);
        setIsLeader(current.my_role === "leader");
        setEditName(current.project_name || "");
        setEditDeadline(current.global_deadline?.substring(0, 10) || "");
        setEditChatUrl(current.external_chat_url || "");
      }
      const fetchedMembers: any[] = await invoke("get_members", { roomId });
      setMembers(fetchedMembers);

      if (current?.my_role === "leader" && fetchedMembers.length > 0) {
        const totalPts = fetchedMembers.reduce((s, m) => s + (m.total_pts || 0), 0);
        const avg = totalPts / fetchedMembers.length;
        const offenders = fetchedMembers.filter(m => (m.total_pts || 0) < avg * 0.5).map(m => m.display_name);
        setFloorWarn(offenders.length > 0 ? `Kontribusi rendah: ${offenders.join(", ")} (<50% rata-rata tim)` : "");
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadData(); }, [roomId]);

  const handleCopy = async () => {
    if (!room?.room_code) return;
    await navigator.clipboard.writeText(room.room_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!roomId) return;
    setSaving(true); setSaveErr("");
    try {
      await invoke("call_function", {
        functionName: "updateRoom",
        data: {
          roomId,
          projectName: editName,
          globalDeadline: editDeadline,
          externalChatUrl: editChatUrl,
        },
      });
      await loadData();
    } catch (e: any) {
      setSaveErr(typeof e === "string" ? e : JSON.stringify(e));
    } finally { setSaving(false); }
  };

  const handleRemoveMember = (member: any) => {
    setConfirm({
      title: "Hapus Anggota",
      message: `Hapus ${member.display_name} dari room ini?`,
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await invoke("call_function", { functionName: "removeMember", data: { roomId, memberId: member.id } });
          await loadData();
        } catch (e: any) { setSaveErr(typeof e === "string" ? e : JSON.stringify(e)); }
      },
    });
  };

  const handleEndProject = () => {
    setConfirm({
      title: "Akhiri Project",
      message: "Yakin ingin mengakhiri project ini? Room akan menjadi tidak aktif dan tidak bisa digunakan lagi.",
      danger: true,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await invoke("call_function", { functionName: "endRoom", data: { roomId } });
          await loadData();
        } catch (e: any) { setSaveErr(typeof e === "string" ? e : JSON.stringify(e)); }
      },
    });
  };

  if (!room) {
    return <div style={{ color: "var(--text-3)", padding: "40px 0", textAlign: "center", fontSize: "13px" }}>Memuat info room...</div>;
  }

  return (
    <>
      <div className="room-info-container fade-in">

        {/* ── Room Code Card ─────────────────────── */}
        <div>
          <div className="section-header">
            <span className="section-title">Kode Room</span>
          </div>
          <div className="info-card" style={{ display: "flex", alignItems: "center", gap: "20px", padding: "20px" }}>
            <QRCodeSVG value={`Room Code: ${room.room_code}`} size={88} bgColor="transparent" fgColor="var(--text-1)" />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "28px", fontWeight: 800, color: "var(--accent-light)", letterSpacing: "0.18em" }}>
                {room.room_code}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn-primary" onClick={handleCopy} style={{ fontSize: "12px", padding: "5px 12px" }}>
                  {copied ? "Tersalin!" : "Salin Kode"}
                </button>
                {room.external_chat_url && (
                  <button className="btn-secondary" onClick={() => window.open(room.external_chat_url, "_blank")} style={{ fontSize: "12px", padding: "5px 12px" }}>
                    Buka Grup Chat
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Project Info ───────────────────────── */}
        <div>
          <div className="section-header">
            <span className="section-title">Info Project</span>
          </div>
          <div className="info-card">
            {[
              { label: "Nama Project",   value: room.project_name || "—" },
              { label: "Deadline Global", value: room.global_deadline?.substring(0, 10) || "—" },
              { label: "Jumlah Anggota", value: `${members.length} orang` },
              { label: "Rolemu",         value: room.my_role || "member" },
            ].map(r => (
              <div key={r.label} className="info-card-row">
                <span className="info-card-label">{r.label}</span>
                <span className="info-card-value">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Members Table ──────────────────────── */}
        <div>
          <div className="section-header">
            <span className="section-title">Anggota</span>
          </div>
          <div className="members-table">
            <div className="members-table-header">
              <span>Nama</span>
              <span>Role</span>
              <span>Poin</span>
              <span>Selesai</span>
            </div>
            {members.map(m => (
              <div
                key={m.id}
                className="members-table-row"
                onClick={() => onMemberClick?.(m.uid)}
                style={{ cursor: onMemberClick ? "pointer" : "default" }}
              >
                <div className="member-cell-name">
                  <div className="sm-avatar">{m.display_name.charAt(0).toUpperCase()}</div>
                  <span className="name">{m.display_name}</span>
                </div>
                <span className={`role-badge ${m.role}`}>{m.role}</span>
                <span className="pts">{m.total_pts || 0}</span>
                <span style={{ fontSize: "11px", color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                  {m.role === "leader" ? "—" : `${m.nudge_pts || 0} nudge`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Leader Controls ────────────────────── */}
        {isLeader && (
          <div>
            <div className="section-header">
              <span className="section-title" style={{ color: "var(--amber)" }}>Kontrol Leader</span>
            </div>

            {floorWarn && (
              <div style={{ background: "var(--amber-dim)", border: "1px solid rgba(245,158,11,0.25)", color: "var(--amber)", borderRadius: "var(--r-md)", padding: "10px 14px", fontSize: "12px", marginBottom: "12px" }}>
                {floorWarn}
              </div>
            )}

            {/* Edit Form */}
            <div className="info-card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-2)" }}>Nama Project</label>
                <input className="form-input" type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", color: "var(--text-1)", fontFamily: "var(--font)", fontSize: "13px", padding: "7px 10px", outline: "none", width: "100%" }} />
              </div>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-2)" }}>Deadline Global</label>
                <input className="form-input" type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)}
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", color: "var(--text-1)", fontFamily: "var(--font)", fontSize: "13px", padding: "7px 10px", outline: "none", width: "100%" }} />
              </div>
              <div className="form-field" style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-2)" }}>Link Grup Chat</label>
                <input className="form-input" type="url" value={editChatUrl} onChange={e => setEditChatUrl(e.target.value)} placeholder="https://..."
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", color: "var(--text-1)", fontFamily: "var(--font)", fontSize: "13px", padding: "7px 10px", outline: "none", width: "100%" }} />
              </div>
              {saveErr && <div style={{ color: "var(--red)", fontSize: "11px" }}>{saveErr}</div>}
              <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ alignSelf: "flex-start" }}>
                {saving ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>

            {/* Remove Members */}
            {members.filter(m => m.role !== "leader").length > 0 && (
              <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "4px" }}>Hapus Anggota</div>
                {members.filter(m => m.role !== "leader").map(m => (
                  <div key={m.id} className="danger-zone" style={{ padding: "10px 14px" }}>
                    <div className="danger-zone-text">
                      <h4>{m.display_name}</h4>
                      <p>{m.total_pts || 0} pts · {m.role}</p>
                    </div>
                    <button className="btn-danger" onClick={() => handleRemoveMember(m)}>Hapus</button>
                  </div>
                ))}
              </div>
            )}

            {/* End Project */}
            <div className="danger-zone">
              <div className="danger-zone-text">
                <h4>Akhiri Project</h4>
                <p>Room akan dinonaktifkan. Semua data tetap tersimpan.</p>
              </div>
              <button className="btn-danger" onClick={handleEndProject}>Akhiri Project</button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          confirmLabel="Ya, lanjutkan"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
