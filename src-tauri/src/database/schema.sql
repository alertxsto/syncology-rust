-- =============================================================
-- Syncology — Supabase PostgreSQL Schema
-- Jalankan file ini di Supabase SQL Editor (satu kali saat setup)
-- =============================================================

-- Extension untuk UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ROOMS
-- =============================================================
CREATE TABLE IF NOT EXISTS rooms (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code           TEXT NOT NULL UNIQUE,
    project_name        TEXT NOT NULL,
    global_deadline     TIMESTAMPTZ,
    external_chat_url   TEXT NOT NULL DEFAULT '',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rooms_room_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);

-- =============================================================
-- MEMBERS
-- =============================================================
CREATE TABLE IF NOT EXISTS members (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uid                 TEXT NOT NULL,          -- Firebase Auth UID
    display_name        TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'member', -- 'leader' | 'member'
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_pts           INTEGER NOT NULL DEFAULT 0,
    nudge_pts           INTEGER NOT NULL DEFAULT 0,
    nudge_sent_today    INTEGER NOT NULL DEFAULT 0,
    nudge_reset_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE(room_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_members_room_id ON members(room_id);
CREATE INDEX IF NOT EXISTS idx_members_uid ON members(uid);

-- =============================================================
-- TASKS
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id                 UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL,
    description             TEXT NOT NULL DEFAULT '',
    assigned_to_id          TEXT NOT NULL,      -- Firebase Auth UID
    proposed_by_id          TEXT NOT NULL DEFAULT '',
    weight                  INTEGER NOT NULL DEFAULT 10,
    difficulty              TEXT NOT NULL DEFAULT 'Medium',
    category                TEXT NOT NULL DEFAULT 'technical',
    status                  TEXT NOT NULL DEFAULT 'proposed',
    internal_deadline       TIMESTAMPTZ,
    evidence_url            TEXT NOT NULL DEFAULT '',
    evidence_meta           JSONB,
    approved_by_id          TEXT NOT NULL DEFAULT '',
    rejection_reason        TEXT NOT NULL DEFAULT '',
    assigned_reviewer_id    TEXT NOT NULL DEFAULT '',
    is_rescue               BOOLEAN NOT NULL DEFAULT FALSE,
    escalation_level        INTEGER NOT NULL DEFAULT 0,
    escalated_at            TIMESTAMPTZ,
    backup_message          TEXT NOT NULL DEFAULT '',
    blocked_by              TEXT[] NOT NULL DEFAULT '{}',
    kudos_by                TEXT[] NOT NULL DEFAULT '{}',
    kudos_count             INTEGER NOT NULL DEFAULT 0,
    recurrence              TEXT NOT NULL DEFAULT 'none',   -- 'none'|'daily'|'weekly'|'monthly'
    subtasks                JSONB NOT NULL DEFAULT '[]',    -- array of TaskSubtask objects
    reviewer_backup_id      TEXT NOT NULL DEFAULT '',
    review_due_at           TIMESTAMPTZ,
    proposed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at            TIMESTAMPTZ,
    approved_at             TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_room_id ON tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_id ON tasks(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_escalation_level ON tasks(escalation_level);

-- =============================================================
-- TASK COMMENTS (Subcollection dari Task)
-- =============================================================
CREATE TABLE IF NOT EXISTS task_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    author_uid      TEXT NOT NULL,
    author_name     TEXT NOT NULL,
    comment_text    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

-- =============================================================
-- MESSAGES (Room Chat)
-- =============================================================
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL,          -- Firebase Auth UID or 'system'
    sender_name     TEXT NOT NULL,
    message_body    TEXT NOT NULL,
    reply_to        UUID REFERENCES messages(id),
    reactions       JSONB NOT NULL DEFAULT '{}',
    edited          BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(room_id, created_at);

-- =============================================================
-- NUDGES
-- =============================================================
CREATE TABLE IF NOT EXISTS nudges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_member_id  UUID,
    from_uid        TEXT NOT NULL,
    from_name       TEXT NOT NULL,
    to_uid          TEXT NOT NULL,
    task_id         UUID NOT NULL,
    task_title      TEXT NOT NULL DEFAULT '',
    read            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nudges_room_id ON nudges(room_id);
CREATE INDEX IF NOT EXISTS idx_nudges_to_uid ON nudges(to_uid);

-- =============================================================
-- EVENTS (Activity Audit Log)
-- =============================================================
CREATE TABLE IF NOT EXISTS events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    actor_uid   TEXT NOT NULL,
    actor_name  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_room_id ON events(room_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(room_id, created_at DESC);

-- =============================================================
-- TYPING INDICATORS (TTL-based, short-lived)
-- =============================================================
CREATE TABLE IF NOT EXISTS typing_indicators (
    room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    uid             TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, uid)
);

-- =============================================================
-- Row Level Security (RLS)
-- CATATAN: Untuk saat ini DISABLE dulu — backend pakai service key
-- Enable & tambah policies saat siap production
-- =============================================================
ALTER TABLE rooms DISABLE ROW LEVEL SECURITY;
ALTER TABLE members DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE nudges DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
ALTER TABLE typing_indicators DISABLE ROW LEVEL SECURITY;

-- Migration script untuk menambahkan kolom yang kurang jika tabel tasks sudah ada sebelumnya
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS subtasks JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewer_backup_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ;
