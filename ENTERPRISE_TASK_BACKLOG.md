# Syncology — Enterprise-Grade Interactive Backlog (Open Source Core)

Dokumen ini disusun untuk jadi **catatan task yang bisa langsung dieksekusi** (engineering + product), dengan standar enterprise tapi tetap cocok untuk strategi open-source.

---

## 1) Positioning: “Kita jual mahal di fitur apa?”

### Open Source Core (gratis)
- Task management (status, assign, due date, tags, kategori)
- Review workflow dasar (submit evidence, approve/reject)
- Activity log dasar
- Basic profile analytics
- Desktop app + auto-update

### Premium Value (yang bisa dijual mahal)
1. **Governance & Compliance Layer**
   - Approval policy by role/team
   - Audit trail immutable (export + signed)
   - SLA & escalation automation
   - Evidence integrity (hash/snapshot)
2. **Reviewer Intelligence**
   - Smart reviewer routing (workload, expertise, historical quality)
   - Bottleneck prediction + SLA risk alerts
   - Review quality scoring
3. **Execution Depth**
   - Subtasks/checklists, dependency graph, blocker engine
   - Multi-stage workflow templates (e.g. Draft → Dev → Review → QA → Done)
4. **Org Analytics**
   - Team throughput, cycle time, on-time rate, review latency
   - People insights (load, focus, reliability)
5. **Integrations**
   - Native GitHub sync (PR/commit evidence, status tracking)
   - Slack/Discord notifications + digests
   - Webhook/API package untuk enterprise stack

> Ringkas: **jualan utama = governance + reviewer intelligence + analytics + integrations**.

---

## 2) Product Goal (Next Level Interaktif)

Membuat pengalaman task/review jadi:
- **lebih jelas** (siapa reviewer, kenapa pending)
- **lebih granular** (task bukan 1 baris doang)
- **lebih actionable** (tiap screen ada next-step)
- **lebih enterprise** (traceable, measurable, policy-driven)

---

## 3) Batch Plan (Prioritas Tinggi)

## Batch A — Review Clarity & Task Granularity (High ROI)

### TASK-A1 — Subtask/Checklist Engine
**Objective:** Task bisa dipecah jadi unit kerja granular.

**Scope:**
- Tambah model `subtasks` per task: title, status, assignee (optional), due date (optional), order.
- Progress task otomatis: `% complete` dari subtasks.
- UI interaktif: check/uncheck cepat di task detail + inline add.

**Acceptance Criteria:**
- User bisa create/edit/delete/reorder subtasks.
- Card task menampilkan progress bar + `x/y done`.
- Status parent task auto-update opsional (rule-based, configurable).

**KPI:**
- >60% task aktif punya subtasks.
- Penurunan task “stuck” minimal 20%.

---

### TASK-A2 — Review Ownership Visibility
**Objective:** Selalu jelas siapa reviewer aktif dan siapa backup.

**Scope:**
- Tambah field `reviewer_uid`, `reviewer_backup_uid`, `review_due_at`.
- Tampilkan reviewer badge di board card + detail.
- Filter baru: `Needs My Review`, `Waiting Reviewer`, `Overdue Review`.

**Acceptance Criteria:**
- Tidak ada task “in review” tanpa reviewer terlihat.
- Klik reviewer badge membuka profile mini (workload, avg response time).

**KPI:**
- Waktu assignment reviewer turun 50%.
- Review overdue ratio turun 25%.

---

### TASK-A3 — Review Workspace (Interactive Queue)
**Objective:** Reviewer punya workspace khusus, bukan nyari manual.

**Scope:**
- Halaman queue: `Needs My Review`, `Recently Reviewed`, `Escalated`.
- Batch actions: approve/reject/request changes + note template.
- SLA age badge (warna + countdown).

**Acceptance Criteria:**
- Reviewer bisa proses >1 task dari satu layar.
- Queue sort by urgency (SLA + priority + blocker impact).

**KPI:**
- Median review turnaround turun 30%.

---

### TASK-A4 — Dependency & Blocker Map
**Objective:** Task blocked-by jadi fitur nyata dan interaktif.

**Scope:**
- Link dependency antar task (`blocked_by`, `blocking`).
- Status blocker di card + detail.
- Visual mini dependency graph (2-level cukup awal).

**Acceptance Criteria:**
- Task blocked tidak bisa dipindah Done tanpa override reason.
- Ada action cepat: “Open blocking task”.

**KPI:**
- Reopen task akibat dependency miss turun 20%.

---

## Batch B — Evidence & Audit Trail (Enterprise Feel)

### TASK-B1 — Evidence Hub (GitHub + Image + Rich Notes)
**Objective:** Bukti kerja bukan cuma link teks.

**Scope:**
- Evidence types: `github_pr`, `github_commit`, `image`, `doc_link`, `note`.
- Auto-parse GitHub URL (repo, PR#, title jika tersedia API token optional).
- Multi-image preview grid + captions.

**Acceptance Criteria:**
- Bukti bisa dibuka dari tombol “Lihat Bukti” tanpa broken link.
- Metadata evidence tampil konsisten di timeline & detail.

**KPI:**
- Task reviewable on first pass naik 25%.

---

### TASK-B2 — Activity Log 2.0 (Deep Link + Semantik)
**Objective:** Activity log tidak kosong dan benar-benar berguna.

**Scope:**
- Event schema standar: actor, target, action, diff summary, timestamp.
- Deep-link ke task/comment/evidence terkait.
- Event grouping per task/day untuk readability.

**Acceptance Criteria:**
- Semua aksi utama (create/update/status/review/evidence/kudos) selalu menghasilkan event.
- User bisa klik event dan langsung landing ke context yang tepat.

**KPI:**
- CTR activity log >40%.

---

### TASK-B3 — Review Decision Notes
**Objective:** Keputusan review punya alasan yang reusable.

**Scope:**
- Mandatory reason saat reject/request changes.
- Optional checklist quality gate (DoD).
- Saved templates per reviewer/team.

**Acceptance Criteria:**
- Tidak bisa reject tanpa alasan.
- Alasan tersimpan di audit trail + terlihat di task.

**KPI:**
- Iterasi review bolak-balik turun 15–20%.

---

## Batch C — Profile & Team Intelligence

### TASK-C1 — Profile “Work DNA”
**Objective:** Profile bukan kosmetik, tapi operasional.

**Scope:**
- Metrics: completion rate, review response time, on-time %, streak, focus area.
- Breakdown by category/tag.
- “Current workload health” indicator.

**Acceptance Criteria:**
- Semua metrik dari data real (no random/fake).
- Ada insight card: “Top strength” + “Needs attention”.

**KPI:**
- Adoption profile page >50% weekly active users.

---

### TASK-C2 — Team Load Balancer
**Objective:** Bantu distribusi kerja & reviewer biar fair.

**Scope:**
- Per-member load score (open tasks + due pressure + review queue).
- Suggested assignee/reviewer.
- Warning saat assign ke member overload.

**Acceptance Criteria:**
- Assignment UI menampilkan load indicator saat pilih member.

**KPI:**
- Overload cases turun 30%.

---

## Batch D — Reliability & Quota Safety

### TASK-D1 — Query Budget Guardrail
**Objective:** Cegah Firestore 429 recurring.

**Scope:**
- Cache short-lived untuk room/member/task summary.
- Request coalescing + dedupe.
- Retry exponential backoff khusus `RESOURCE_EXHAUSTED`.

**Acceptance Criteria:**
- Error 429 turun signifikan di flow join/list room.
- UI menampilkan retry state yang jelas (bukan silent fail).

**KPI:**
- 429 rate turun >70%.

---

### TASK-D2 — Offline-Tolerant UX
**Objective:** UX tetap usable walau jaringan buruk.

**Scope:**
- Optimistic UI untuk aksi ringan.
- Local queue untuk pending writes (best effort).
- Sync indicator + conflict notification.

**Acceptance Criteria:**
- User tetap bisa draft update saat network loss sementara.

---

## 4) Definition of Done (Enterprise Open-Source Standard)

Satu task dianggap selesai kalau:
1. Ada unit/integration test untuk path kritikal.
2. Event activity untuk aksi baru ter-cover.
3. Accessibility minimal: keyboard focus + semantic labels.
4. Error states jelas & actionable.
5. Tidak menambah query boros (cek perf/read budget).
6. Dokumen user-facing minimal 1 section update.

---

## 5) Suggested Monetization Structure

### Free (Open Source)
- Core task + review + updater + basic analytics

### Pro Team
- Review workspace, SLA badges, dependency map, profile intelligence

### Enterprise
- SSO/RBAC policy, audit export signed, compliance pack, advanced reviewer routing, API/webhooks, governance templates

---

## 6) Eksekusi Minggu Ini (Actionable)

**Week 1 (langsung gas):**
- TASK-A1 (Subtasks)
- TASK-A2 (Review ownership)
- TASK-B2 (Activity deep-link)
- TASK-D1 (429 guardrail basic)

**Week 2:**
- TASK-A3 (Review workspace)
- TASK-A4 (Dependency map)
- TASK-B1 (Evidence hub hardening)

**Week 3:**
- TASK-C1 (Profile Work DNA)
- TASK-C2 (Load balancer)
- polish + docs + release notes

---

## 7) Catatan Strategis

Kalau mau “terasa mahal”, jangan cuma tambah fitur banyak.
Fokus ke 3 hal ini:
1. **Clarity:** siapa ngapain, kapan due, kenapa pending.
2. **Control:** policy, SLA, audit trace.
3. **Confidence:** data valid, performa stabil, update mulus.

> Enterprise bukan soal UI ramai, tapi **keputusan lebih cepat + risiko lebih kecil + accountability jelas**.
