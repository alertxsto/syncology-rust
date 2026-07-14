import { useState } from "react";
import CreateRoomModal from "./CreateRoomModal";
import JoinRoomModal from "./JoinRoomModal";
import "./HomeTab.css";

interface HomeTabProps {
  onSelectRoom: (room: any) => void;
  onRefreshRooms: () => void;
  rooms: any[];
}

const EmptyIcon = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" x2="12" y1="22.08" y2="12"/>
  </svg>
);

export default function HomeTab({ onSelectRoom, onRefreshRooms, rooms }: HomeTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin]     = useState(false);

  return (
    <div className="home-tab fade-in">
      <div className="home-header">
        <h2>My Rooms</h2>
        <p>Pilih project untuk memulai, atau buat / gabung room baru.</p>
        <div className="home-actions">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ Buat Room</button>
          <button className="btn-secondary" onClick={() => setShowJoin(true)}>Gabung dengan Kode</button>
        </div>
      </div>

      <div>
        <div className="section-label">Project aktif — {rooms.length} room</div>
        <div className="rooms-grid">
          {rooms.length === 0 ? (
            <div className="empty-state">
              <EmptyIcon />
              <h3>Belum ada room</h3>
              <p>Buat room baru atau minta kode dari leader tim.</p>
            </div>
          ) : (
            rooms.map((room) => {
              const role     = room.my_role || "member";
              const isActive = room.is_active !== false;
              return (
                <div key={room.id} className="room-card" onClick={() => onSelectRoom(room)}>
                  <div className="room-card-header">
                    <span className="room-card-title">{room.project_name}</span>
                    <span className={`role-badge ${role}`}>{role}</span>
                  </div>
                  <div className="room-card-meta">
                    <div className="room-meta-row">
                      <span className="mlabel">Kode</span>
                      <span className="mcode">{room.room_code}</span>
                    </div>
                    {room.global_deadline && (
                      <div className="room-meta-row">
                        <span className="mlabel">Deadline</span>
                        <span className="mval">{room.global_deadline.substring(0, 10)}</span>
                      </div>
                    )}
                    {room.created_at && (
                      <div className="room-meta-row">
                        <span className="mlabel">Dibuat</span>
                        <span className="mval">{room.created_at.substring(0, 10)}</span>
                      </div>
                    )}
                  </div>
                  <div className="room-card-status">
                    <span className={`status-dot ${isActive ? "active" : ""}`}
                      style={{ background: isActive ? "var(--green)" : "var(--text-3)" }}
                    />
                    {isActive ? "Active" : "Ended"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); onRefreshRooms(); }}
        />
      )}
      {showJoin && (
        <JoinRoomModal
          onClose={() => setShowJoin(false)}
          onSuccess={() => { setShowJoin(false); onRefreshRooms(); }}
        />
      )}
    </div>
  );
}
