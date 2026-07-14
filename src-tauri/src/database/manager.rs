use crate::config::app::AppConfig;
use crate::database::supabase::SupabaseClient;
use crate::services::auth::FirebaseAuth;
use crate::utils::cf_caller::CFCaller;
use crate::config::firebase::FirebaseConfig;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

pub struct RoomManager {
    db: Arc<SupabaseClient>,
    current_room_id: Arc<RwLock<Option<String>>>,
    member_id: Arc<RwLock<Option<String>>>,
}

impl RoomManager {
    pub fn new(db: Arc<SupabaseClient>) -> Self {
        Self {
            db,
            current_room_id: Arc::new(RwLock::new(None)),
            member_id: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_room(&self, room_id: String, member_id: String) {
        *self.current_room_id.write().await = Some(room_id);
        *self.member_id.write().await = Some(member_id);
    }

    pub async fn get_room_id(&self) -> Option<String> {
        self.current_room_id.read().await.clone()
    }

    pub async fn get_member_id(&self) -> Option<String> {
        self.member_id.read().await.clone()
    }

    /// Lookup member doc for a given Firebase Auth UID in a room.
    async fn get_member_by_uid(&self, room_id: &str, uid: &str) -> Result<Map<String, Value>, String> {
        self.db
            .select("members")
            .eq("room_id", room_id)
            .eq("uid", uid)
            .execute_single()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "You are not a member of this room.".to_string())
    }

    /// Authorization helper — only leaders may pass.
    async fn assert_leader(&self, room_id: &str, uid: &str) -> Result<(), String> {
        let member = self.get_member_by_uid(room_id, uid).await?;
        if member.get("role").and_then(|r| r.as_str()) != Some("leader") {
            return Err("Forbidden: leader role required.".to_string());
        }
        Ok(())
    }

    /// Authorization helper — only room members may pass.
    async fn assert_member(&self, room_id: &str, uid: &str) -> Result<Map<String, Value>, String> {
        self.get_member_by_uid(room_id, uid).await
    }

    fn now_iso() -> String {
        Utc::now().to_rfc3339()
    }

    /// Map difficulty string → point weight. Case-insensitive.
    pub fn weight_for_difficulty(difficulty: &str) -> i64 {
        match difficulty.to_lowercase().as_str() {
            "easy"      => 5,
            "medium"    => 10,
            "hard"      => 20,
            "very hard" => 35,
            other => {
                eprintln!("[warn] unknown difficulty '{}', defaulting to 10", other);
                10
            }
        }
    }

    fn gen_room_code() -> String {
        use rand::RngExt;
        let charset: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::rng();
        (0..6)
            .map(|_| {
                let idx = rng.random_range(0..charset.len());
                charset[idx] as char
            })
            .collect()
    }

    // ── Rooms ────────────────────────────────────────────────────────────────

    pub async fn create_room(
        &self,
        project_name: &str,
        global_deadline: Option<&str>,
        external_chat_url: Option<&str>,
        uid: &str,
        display_name: &str,
    ) -> Result<Value, String> {
        let room_code = Self::gen_room_code();

        let mut data = Map::new();
        data.insert("room_code".to_string(), json!(room_code));
        data.insert("project_name".to_string(), json!(project_name));
        data.insert("global_deadline".to_string(), json!(global_deadline));
        data.insert("external_chat_url".to_string(), json!(external_chat_url.unwrap_or("")));
        data.insert("is_active".to_string(), json!(true));
        // created_at / archived_at use DEFAULT in DB

        let room = self.db.insert("rooms", &data).await.map_err(|e| e.to_string())?;
        let room_id = room.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

        *self.current_room_id.write().await = Some(room_id.clone());
        let member_id = self.add_member_internal(&room_id, uid, display_name, "leader").await?;
        *self.member_id.write().await = Some(member_id.clone());

        self.log_event(&room_id, uid, "room_created", json!({
            "project_name": project_name,
            "room_code": room_code,
        })).await.ok();

        Ok(json!({
            "room_id": room_id,
            "room_code": room_code,
            "member_id": member_id
        }))
    }

    pub async fn join_room(&self, room_code: &str, uid: &str, display_name: &str) -> Result<Value, String> {
        let rooms = self.db
            .select("rooms")
            .eq("room_code", room_code)
            .execute_single()
            .await
            .map_err(|e| e.to_string())?;

        let room = rooms.ok_or_else(|| "Room code tidak ditemukan.".to_string())?;
        let room_id = room.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

        if let Some(is_active) = room.get("is_active").and_then(|b| b.as_bool()) {
            if !is_active {
                return Err("Room sudah tidak aktif.".to_string());
            }
        }

        // Check if already a member
        let existing = self.db
            .select("members")
            .eq("room_id", &room_id)
            .eq("uid", uid)
            .execute_single()
            .await
            .map_err(|e| e.to_string())?;

        if let Some(member) = existing {
            let member_id = member.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
            self.set_room(room_id.clone(), member_id.clone()).await;
            return Ok(json!({
                "room_id": room_id,
                "member_id": member_id,
                "is_rejoin": true
            }));
        }

        let member_id = self.add_member_internal(&room_id, uid, display_name, "member").await?;
        self.set_room(room_id.clone(), member_id.clone()).await;

        let _ = self.log_event(&room_id, uid, "member_joined", json!({
            "member_id": member_id,
            "display_name": display_name,
        })).await;

        Ok(json!({
            "room_id": room_id,
            "member_id": member_id,
            "is_rejoin": false
        }))
    }

    pub async fn list_my_rooms(&self, uid: &str) -> Result<Vec<Map<String, Value>>, String> {
        // Fetch all member entries for this uid, then join with rooms
        let member_rows = self.db
            .select("members")
            .eq("uid", uid)
            .execute()
            .await
            .map_err(|e| e.to_string())?;

        let mut my_rooms = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for member in &member_rows {
            let room_id = match member.get("room_id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };
            if seen.contains(&room_id) { continue; }
            seen.insert(room_id.clone());

            if let Some(mut room) = self.db
                .select("rooms")
                .eq("id", &room_id)
                .execute_single()
                .await
                .map_err(|e| e.to_string())?
            {
                room.insert("my_role".to_string(), member.get("role").cloned().unwrap_or(json!("")));
                room.insert("my_member_id".to_string(), member.get("id").cloned().unwrap_or(json!("")));
                my_rooms.push(room);
            }
        }
        Ok(my_rooms)
    }

    async fn add_member_internal(&self, room_id: &str, uid: &str, display_name: &str, role: &str) -> Result<String, String> {
        let mut data = Map::new();
        data.insert("room_id".to_string(), json!(room_id));
        data.insert("uid".to_string(), json!(uid));
        data.insert("display_name".to_string(), json!(display_name));
        data.insert("role".to_string(), json!(role));
        data.insert("total_pts".to_string(), json!(0));
        data.insert("nudge_pts".to_string(), json!(0));
        data.insert("nudge_sent_today".to_string(), json!(0));
        data.insert("nudge_reset_date".to_string(), json!(Utc::now().format("%Y-%m-%d").to_string()));

        let result = self.db.insert("members", &data).await.map_err(|e| e.to_string())?;
        Ok(result.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }

    // ── Tasks ────────────────────────────────────────────────────────────────

    pub async fn get_tasks(&self, room_id: Option<String>) -> Result<Vec<Map<String, Value>>, String> {
        let rid = self.resolve_room_id(room_id).await?;
        self.db
            .select("tasks")
            .eq("room_id", &rid)
            .execute()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn add_task(
        &self,
        title: &str,
        description: &str,
        assigned_to_id: &str,
        difficulty: &str,
        category: Option<&str>,
        internal_deadline: &str,
        room_id: Option<String>,
        proposer_uid: &str,
    ) -> Result<String, String> {
        let rid = self.resolve_room_id(room_id).await?;
        let proposed_by = self.member_id.read().await.clone().unwrap_or_default();
        let weight = Self::weight_for_difficulty(difficulty);
        let category = category.unwrap_or("technical");

        let mut data = Map::new();
        data.insert("room_id".to_string(), json!(rid));
        data.insert("title".to_string(), json!(title));
        data.insert("description".to_string(), json!(description));
        data.insert("assigned_to_id".to_string(), json!(assigned_to_id));
        data.insert("proposed_by_id".to_string(), json!(proposed_by));
        data.insert("weight".to_string(), json!(weight));
        data.insert("difficulty".to_string(), json!(difficulty));
        data.insert("category".to_string(), json!(category));
        data.insert("status".to_string(), json!("proposed"));
        if !internal_deadline.is_empty() {
            data.insert("internal_deadline".to_string(), json!(internal_deadline));
        }

        let result = self.db.insert("tasks", &data).await.map_err(|e| e.to_string())?;
        let task_id = result.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

        let actor_uid = if proposer_uid.is_empty() { assigned_to_id } else { proposer_uid };
        let _ = self.log_event(&rid, actor_uid, "task_proposed", json!({
            "task_id": task_id,
            "title": title,
            "difficulty": difficulty,
            "category": category,
            "assigned_to_id": assigned_to_id,
        })).await;

        Ok(task_id)
    }

    pub async fn update_task(&self, task_id: &str, data: &Map<String, Value>, room_id: Option<String>, actor_uid: &str) -> Result<(), String> {
        let rid = self.resolve_room_id(room_id).await?;

        // Get before-state for audit log
        let before = self.db.get_by_id("tasks", task_id).await.map_err(|e| e.to_string())?.unwrap_or_default();
        let before_status = before.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();

        self.db.update_by_id("tasks", task_id, data).await.map_err(|e| e.to_string())?;

        let after = self.db.get_by_id("tasks", task_id).await.map_err(|e| e.to_string())?.unwrap_or_default();
        let after_status = after.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();

        if before_status != after_status {
            let _ = self.log_event(&rid, actor_uid, "task_updated", json!({
                "task_id": task_id,
                "from_status": before_status,
                "to_status": after_status,
                "title": after.get("title").and_then(|v| v.as_str()).unwrap_or(""),
            })).await;
        }
        Ok(())
    }

    pub async fn delete_task(&self, task_id: &str, room_id: Option<String>, actor_uid: &str) -> Result<(), String> {
        let rid = self.resolve_room_id(room_id).await?;

        let existing = self.db.get_by_id("tasks", task_id).await.map_err(|e| e.to_string())?.unwrap_or_default();
        let title = existing.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let status = existing.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();

        // Comments are cascade-deleted by FK constraint
        self.db.delete_by_id("tasks", task_id).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(&rid, actor_uid, "task_deleted", json!({
            "task_id": task_id,
            "title": title,
            "status": status,
        })).await;
        Ok(())
    }

    // ── Nudges ───────────────────────────────────────────────────────────────

    pub async fn send_nudge_local(&self, room_id: &str, to_uid: &str, task_id: &str, from_uid: &str) -> Result<Value, String> {
        let sender = self.get_member_by_uid(room_id, from_uid).await
            .map_err(|_| "Sender member profile not found in this room.".to_string())?;
        // Validate recipient is a room member
        let _recipient = self.assert_member(room_id, to_uid).await
            .map_err(|_| "Recipient member profile not found in this room.".to_string())?;

        let sender_id = sender.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
        let sender_name = sender.get("display_name").and_then(|n| n.as_str()).unwrap_or("Someone").to_string();

        // Rate limit check
        let mut nudge_sent = sender.get("nudge_sent_today").and_then(|v| v.as_i64()).unwrap_or(0);
        let reset_date = sender.get("nudge_reset_date").and_then(|v| v.as_str()).unwrap_or("");
        let today = Utc::now().format("%Y-%m-%d").to_string();
        if reset_date != today {
            nudge_sent = 0;
        }
        if nudge_sent >= 3 {
            return Err("Batas nudge harian (3/hari) telah tercapai!".to_string());
        }

        // Get task title
        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;
        let task_title = task.get("title").and_then(|t| t.as_str()).unwrap_or("Task").to_string();

        // Insert nudge
        let mut nudge_data = Map::new();
        nudge_data.insert("room_id".to_string(), json!(room_id));
        nudge_data.insert("from_member_id".to_string(), json!(sender_id));
        nudge_data.insert("from_uid".to_string(), json!(from_uid));
        nudge_data.insert("from_name".to_string(), json!(sender_name));
        nudge_data.insert("to_uid".to_string(), json!(to_uid));
        nudge_data.insert("task_id".to_string(), json!(task_id));
        nudge_data.insert("task_title".to_string(), json!(task_title));
        nudge_data.insert("read".to_string(), json!(false));
        self.db.insert("nudges", &nudge_data).await.map_err(|e| e.to_string())?;

        // Update sender stats (+2 pts)
        let current_pts = sender.get("total_pts").and_then(|v| v.as_i64()).unwrap_or(0);
        let current_nudge_pts = sender.get("nudge_pts").and_then(|v| v.as_i64()).unwrap_or(0);
        let mut sender_update = Map::new();
        sender_update.insert("nudge_sent_today".to_string(), json!(nudge_sent + 1));
        sender_update.insert("nudge_reset_date".to_string(), json!(today));
        sender_update.insert("total_pts".to_string(), json!(current_pts + 2));
        sender_update.insert("nudge_pts".to_string(), json!(current_nudge_pts + 2));
        self.db.update_by_id("members", &sender_id, &sender_update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, from_uid, "nudge_sent", json!({
            "to_uid": to_uid,
            "task_id": task_id,
            "task_title": task.get("title").and_then(|t| t.as_str()).unwrap_or(""),
        })).await;

        Ok(json!({"status": "ok", "nudge_sent_today": nudge_sent + 1}))
    }

    // ── Evidence & Review ────────────────────────────────────────────────────

    pub async fn submit_evidence_local(&self, room_id: &str, task_id: &str, evidence_url: &str, evidence_meta: Option<Value>, current_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, current_uid).await?;

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("").to_string();

        if current_uid != assignee_uid {
            return Err("Forbidden: only the assignee can submit evidence.".to_string());
        }

        // Pick reviewer: random member (not assignee, prefer non-leader)
        let members = self.db
            .select("members")
            .eq("room_id", room_id)
            .execute()
            .await
            .map_err(|e| e.to_string())?;

        let reviewer_uid = self.pick_reviewer(&members, &assignee_uid);

        let mut update = Map::new();
        update.insert("status".to_string(), json!("under_review"));
        update.insert("evidence_url".to_string(), json!(evidence_url));
        if let Some(meta) = evidence_meta.clone() {
            update.insert("evidence_meta".to_string(), meta);
        }
        update.insert("submitted_at".to_string(), json!(Self::now_iso()));
        update.insert("assigned_reviewer_id".to_string(), json!(reviewer_uid));
        self.db.update_by_id("tasks", task_id, &update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, current_uid, "evidence_submitted", json!({
            "task_id": task_id,
            "assigned_reviewer_id": reviewer_uid,
            "has_evidence_meta": evidence_meta.is_some(),
        })).await;

        Ok(json!({"status": "ok", "assigned_reviewer_id": reviewer_uid}))
    }

    /// Pilih reviewer secara adil: random dari member yang bukan assignee,
    /// prefer member bukan leader, fallback ke siapapun.
    fn pick_reviewer(&self, members: &[Map<String, Value>], assignee_uid: &str) -> String {
        use rand::prelude::IndexedRandom;
        let mut rng = rand::rng();

        let non_leader_candidates: Vec<&str> = members.iter()
            .filter(|m| {
                let uid = m.get("uid").and_then(|u| u.as_str()).unwrap_or("");
                let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
                uid != assignee_uid && role != "leader"
            })
            .filter_map(|m| m.get("uid").and_then(|u| u.as_str()))
            .collect();

        if let Some(&uid) = non_leader_candidates.choose(&mut rng) {
            return uid.to_string();
        }

        let any_candidates: Vec<&str> = members.iter()
            .filter(|m| m.get("uid").and_then(|u| u.as_str()).unwrap_or("") != assignee_uid)
            .filter_map(|m| m.get("uid").and_then(|u| u.as_str()))
            .collect();

        if let Some(&uid) = any_candidates.choose(&mut rng) {
            return uid.to_string();
        }

        // Last fallback: self-review (room with 1 member)
        assignee_uid.to_string()
    }

    pub async fn review_task_local(&self, room_id: &str, task_id: &str, reviewer_uid: &str, decision: &str, reason: &str) -> Result<Value, String> {
        self.assert_member(room_id, reviewer_uid).await?;

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("").to_string();
        let assigned_reviewer = task.get("assigned_reviewer_id").and_then(|a| a.as_str()).unwrap_or("");

        if reviewer_uid != assigned_reviewer {
            return Err("Forbidden: you are not the assigned reviewer for this task.".to_string());
        }

        if decision == "approve" {
            let weight = task.get("weight").and_then(|w| w.as_i64()).unwrap_or(10);
            let is_rescue = task.get("is_rescue").and_then(|r| r.as_bool()).unwrap_or(false);
            let earned = if is_rescue { ((weight as f64) * 1.5).ceil() as i64 } else { weight };

            let assignee_member = self.get_member_by_uid(room_id, &assignee_uid).await.ok();
            if let Some(assignee) = assignee_member {
                let assignee_id = assignee.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                let current_pts = assignee.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);
                let mut member_update = Map::new();
                member_update.insert("total_pts".to_string(), json!(current_pts + earned));
                self.db.update_by_id("members", &assignee_id, &member_update).await.map_err(|e| e.to_string())?;
            }

            let mut task_update = Map::new();
            task_update.insert("status".to_string(), json!("completed"));
            task_update.insert("completed_at".to_string(), json!(Self::now_iso()));
            task_update.insert("approved_by_id".to_string(), json!(reviewer_uid));
            task_update.insert("approved_at".to_string(), json!(Self::now_iso()));
            self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;
        } else {
            let mut task_update = Map::new();
            task_update.insert("status".to_string(), json!("todo"));
            task_update.insert("rejection_reason".to_string(), json!(reason));
            self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;
        }

        let event_type = if decision == "approve" { "task_approved" } else { "task_rejected" };
        let _ = self.log_event(room_id, reviewer_uid, event_type, json!({
            "task_id": task_id,
            "reason": reason,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    // ── Ghost Pool & Rescue ──────────────────────────────────────────────────

    pub async fn rescue_task_local(&self, room_id: &str, task_id: &str, rescuer_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, rescuer_uid).await?;

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;
        let current_assignee = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("").to_string();
        let esc_level = task.get("escalation_level").and_then(|e| e.as_i64()).unwrap_or(0);

        if rescuer_uid == current_assignee {
            return Err("Cannot rescue your own task — transfer ownership first.".to_string());
        }
        if esc_level != 3 {
            return Err("Task is not in ghost pool, cannot rescue.".to_string());
        }

        let mut task_update = Map::new();
        task_update.insert("assigned_to_id".to_string(), json!(rescuer_uid));
        task_update.insert("is_rescue".to_string(), json!(true));
        task_update.insert("escalation_level".to_string(), json!(0));
        task_update.insert("status".to_string(), json!("todo"));
        task_update.insert("backup_message".to_string(), json!(""));
        self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, rescuer_uid, "task_rescued", json!({
            "task_id": task_id,
            "previous_assignee": current_assignee,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    pub async fn claim_task_local(&self, room_id: &str, task_id: &str, claimer_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, claimer_uid).await?;

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;

        let current_assignee = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");
        
        if !current_assignee.is_empty() {
            return Err("Task sudah di-assign ke orang lain.".to_string());
        }

        let mut task_update = Map::new();
        task_update.insert("assigned_to_id".to_string(), json!(claimer_uid));
        self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, claimer_uid, "task_updated", json!({
            "task_id": task_id,
            "title": task.get("title").and_then(|t| t.as_str()).unwrap_or(""),
        })).await;

        Ok(json!({"status": "ok"}))
    }

    pub async fn call_for_backup_local(&self, room_id: &str, task_id: &str, message: &str, from_uid: &str) -> Result<Value, String> {
        let sender = self.assert_member(room_id, from_uid).await?;

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;
        let task_title = task.get("title").and_then(|t| t.as_str()).unwrap_or("Task");
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");
        let sender_role = sender.get("role").and_then(|r| r.as_str()).unwrap_or("");

        if from_uid != assignee_uid && sender_role != "leader" {
            return Err("Forbidden: only the assignee or leader can call for backup.".to_string());
        }

        let sender_name = sender.get("display_name").and_then(|n| n.as_str()).unwrap_or("Someone");

        let mut task_update = Map::new();
        task_update.insert("escalation_level".to_string(), json!(3));
        task_update.insert("escalated_at".to_string(), json!(Self::now_iso()));
        task_update.insert("backup_message".to_string(), json!(message));
        self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;

        // Post system message to chat
        let sys_body = format!("📢 [SYSTEM] {} membutuhkan bantuan untuk tugas \"{}\": \"{}\"", sender_name, task_title, message);
        let mut sys_msg = Map::new();
        sys_msg.insert("room_id".to_string(), json!(room_id));
        sys_msg.insert("sender_id".to_string(), json!("system"));
        sys_msg.insert("sender_name".to_string(), json!("System"));
        sys_msg.insert("message_body".to_string(), json!(sys_body));
        self.db.insert("messages", &sys_msg).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, from_uid, "backup_called", json!({
            "task_id": task_id,
            "message": message,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    // ── Kudos ────────────────────────────────────────────────────────────────

    pub async fn give_kudos_local(&self, room_id: &str, task_id: &str, to_uid: &str, from_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, from_uid).await?;
        self.assert_member(room_id, to_uid).await?;

        if from_uid == to_uid {
            return Err("Tidak bisa memberi kudos ke diri sendiri.".to_string());
        }

        let task = self.db.get_by_id("tasks", task_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;

        if task.get("status").and_then(|s| s.as_str()) != Some("completed") {
            return Err("Kudos hanya bisa diberikan untuk task yang sudah selesai.".to_string());
        }
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");
        if assignee_uid != to_uid {
            return Err("Target kudos tidak sesuai assignee task.".to_string());
        }

        let mut kudos_by: Vec<String> = task.get("kudos_by")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();

        if kudos_by.iter().any(|u| u == from_uid) {
            return Ok(json!({"status": "ok", "already_sent": true, "message": "Kudos sudah pernah diberikan untuk task ini."}));
        }

        kudos_by.push(from_uid.to_string());
        let kudos_count = kudos_by.len() as i64;

        let mut task_update = Map::new();
        task_update.insert("kudos_by".to_string(), json!(kudos_by));
        task_update.insert("kudos_count".to_string(), json!(kudos_count));
        self.db.update_by_id("tasks", task_id, &task_update).await.map_err(|e| e.to_string())?;

        // +1 point to recipient
        let recipient = self.get_member_by_uid(room_id, to_uid).await.ok();
        if let Some(r) = recipient {
            let rid = r.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
            let current_pts = r.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);
            let mut member_update = Map::new();
            member_update.insert("total_pts".to_string(), json!(current_pts + 1));
            self.db.update_by_id("members", &rid, &member_update).await.map_err(|e| e.to_string())?;
        }

        let _ = self.log_event(room_id, from_uid, "kudos_sent", json!({
            "task_id": task_id,
            "to_uid": to_uid,
        })).await;

        Ok(json!({"status": "ok", "already_sent": false, "kudos_count": kudos_count}))
    }

    // ── Member Management ────────────────────────────────────────────────────

    pub async fn remove_member_local(&self, room_id: &str, member_id: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;

        let target = self.db.get_by_id("members", member_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Member not found.".to_string())?;

        if target.get("role").and_then(|r| r.as_str()) == Some("leader") {
            return Err("Cannot remove a leader. Transfer leadership first.".to_string());
        }

        self.db.delete_by_id("members", member_id).await.map_err(|e| e.to_string())?;

        self.log_event(room_id, current_uid, "member_removed", json!({
            "target_member_id": member_id,
            "target_name": target.get("display_name").and_then(|n| n.as_str()).unwrap_or(""),
        })).await.ok();

        Ok(json!({"status": "ok"}))
    }

    pub async fn end_room_local(&self, room_id: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;
        let mut update = Map::new();
        update.insert("is_active".to_string(), json!(false));
        update.insert("archived_at".to_string(), json!(Self::now_iso()));
        self.db.update_by_id("rooms", room_id, &update).await.map_err(|e| e.to_string())?;
        self.log_event(room_id, current_uid, "room_ended", json!({})).await.ok();
        Ok(json!({"status": "ok"}))
    }

    pub async fn update_room_local(&self, room_id: &str, name: &str, deadline: &str, chat_url: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;
        let mut update = Map::new();
        update.insert("project_name".to_string(), json!(name));
        if !deadline.is_empty() {
            update.insert("global_deadline".to_string(), json!(deadline));
        }
        update.insert("external_chat_url".to_string(), json!(chat_url));
        self.db.update_by_id("rooms", room_id, &update).await.map_err(|e| e.to_string())?;
        self.log_event(room_id, current_uid, "room_updated", json!({ "project_name": name })).await.ok();
        Ok(json!({"status": "ok"}))
    }

    // ── Members (get) ────────────────────────────────────────────────────────

    pub async fn get_members(&self, room_id: Option<String>) -> Result<Vec<Map<String, Value>>, String> {
        let rid = self.resolve_room_id(room_id).await?;
        self.db
            .select("members")
            .eq("room_id", &rid)
            .execute()
            .await
            .map_err(|e| e.to_string())
    }

    // ── Chat / Messages ──────────────────────────────────────────────────────

    pub async fn send_room_message(&self, room_id: &str, sender_id: &str, sender_name: &str, body: &str, reply_to: Option<&str>) -> Result<Value, String> {
        let mut data = Map::new();
        data.insert("room_id".to_string(), json!(room_id));
        data.insert("sender_id".to_string(), json!(sender_id));
        data.insert("sender_name".to_string(), json!(sender_name));
        data.insert("message_body".to_string(), json!(body));
        if let Some(rt) = reply_to.filter(|s| !s.is_empty()) {
            data.insert("reply_to".to_string(), json!(rt));
        }
        let res = self.db.insert("messages", &data).await.map_err(|e| e.to_string())?;
        Ok(json!(res))
    }

    pub async fn get_room_messages(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        self.db
            .select("messages")
            .eq("room_id", room_id)
            .order("created_at", true)
            .execute()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn edit_room_message(&self, _room_id: &str, message_id: &str, new_body: &str, editor_uid: &str) -> Result<Value, String> {
        let msg = self.db.get_by_id("messages", message_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        if msg.get("sender_id").and_then(|s| s.as_str()) != Some(editor_uid) {
            return Err("Forbidden: only the sender can edit their message.".to_string());
        }

        let mut update = Map::new();
        update.insert("message_body".to_string(), json!(new_body));
        update.insert("edited".to_string(), json!(true));
        update.insert("edited_at".to_string(), json!(Self::now_iso()));
        self.db.update_by_id("messages", message_id, &update).await.map_err(|e| e.to_string())?;
        Ok(json!({"status": "ok"}))
    }

    pub async fn add_message_reaction(&self, _room_id: &str, message_id: &str, emoji: &str, user_id: &str) -> Result<Value, String> {
        let msg = self.db.get_by_id("messages", message_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        let mut reactions: Map<String, Value> = msg.get("reactions")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(Map::new);

        let mut users: Vec<Value> = reactions.get(emoji)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(Vec::new);

        let user_val = json!(user_id);
        if !users.contains(&user_val) {
            users.push(user_val);
        } else {
            users.retain(|u| u != &user_val);
        }
        reactions.insert(emoji.to_string(), json!(users));

        let mut update = Map::new();
        update.insert("reactions".to_string(), json!(reactions));
        self.db.update_by_id("messages", message_id, &update).await.map_err(|e| e.to_string())?;
        Ok(json!({"status": "ok"}))
    }

    // ── Nudges (get / mark read) ─────────────────────────────────────────────

    pub async fn get_nudges_local(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        self.db
            .select("nudges")
            .eq("room_id", room_id)
            .execute()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn mark_nudge_read(&self, _room_id: &str, nudge_id: &str) -> Result<(), String> {
        let mut update = Map::new();
        update.insert("read".to_string(), json!(true));
        self.db.update_by_id("nudges", nudge_id, &update).await.map_err(|e| e.to_string())
    }

    pub async fn mark_all_nudges_read(&self, room_id: &str, uid: &str) -> Result<u32, String> {
        let nudges = self.db
            .select("nudges")
            .eq("room_id", room_id)
            .eq("to_uid", uid)
            .bool_eq("read", false)
            .execute()
            .await
            .map_err(|e| e.to_string())?;

        let count = nudges.len() as u32;
        if count > 0 {
            // Mark each nudge individually to ensure room_id scoping.
            // (Supabase REST supports multi-column filter via combined query)
            let mut update = Map::new();
            update.insert("read".to_string(), json!(true));
            for nudge in &nudges {
                if let Some(id) = nudge.get("id").and_then(|v| v.as_str()) {
                    self.db.update_by_id("nudges", id, &update).await.map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(count)
    }

    // ── Events (Activity Log) ────────────────────────────────────────────────

    pub async fn log_event(&self, room_id: &str, actor_uid: &str, event_type: &str, payload: Value) -> Result<(), String> {
        let actor_name = self.get_member_by_uid(room_id, actor_uid).await
            .ok()
            .and_then(|m| m.get("display_name").and_then(|n| n.as_str()).map(String::from))
            .unwrap_or_else(|| "Unknown".to_string());

        let mut data = Map::new();
        data.insert("room_id".to_string(), json!(room_id));
        data.insert("actor_uid".to_string(), json!(actor_uid));
        data.insert("actor_name".to_string(), json!(actor_name));
        data.insert("event_type".to_string(), json!(event_type));
        data.insert("payload".to_string(), payload);

        self.db.insert("events", &data).await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub async fn get_events(&self, room_id: &str, limit: Option<usize>) -> Result<Vec<Map<String, Value>>, String> {
        let mut q = self.db
            .select("events")
            .eq("room_id", room_id)
            .order("created_at", false); // newest first

        if let Some(n) = limit {
            q = q.limit(n);
        }
        q.execute().await.map_err(|e| e.to_string())
    }

    // ── Task Comments ────────────────────────────────────────────────────────

    pub async fn add_task_comment(&self, room_id: &str, task_id: &str, author_uid: &str, text: &str) -> Result<Value, String> {
        let author = self.get_member_by_uid(room_id, author_uid).await?;
        let author_name = author.get("display_name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let mut data = Map::new();
        data.insert("task_id".to_string(), json!(task_id));
        data.insert("room_id".to_string(), json!(room_id));
        data.insert("author_uid".to_string(), json!(author_uid));
        data.insert("author_name".to_string(), json!(author_name));
        data.insert("comment_text".to_string(), json!(text));

        let res = self.db.insert("task_comments", &data).await.map_err(|e| e.to_string())?;
        Ok(json!(res))
    }

    pub async fn get_task_comments(&self, _room_id: &str, task_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        self.db
            .select("task_comments")
            .eq("task_id", task_id)
            .order("created_at", true)
            .execute()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_task_comment(&self, _room_id: &str, _task_id: &str, comment_id: &str, author_uid: &str) -> Result<(), String> {
        let comment = self.db.get_by_id("task_comments", comment_id).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Comment not found.".to_string())?;

        if comment.get("author_uid").and_then(|u| u.as_str()) != Some(author_uid) {
            return Err("Forbidden: only the author can delete their comment.".to_string());
        }
        self.db.delete_by_id("task_comments", comment_id).await.map_err(|e| e.to_string())
    }

    // ── Typing Indicator ─────────────────────────────────────────────────────

    pub async fn set_typing(&self, room_id: &str, uid: &str) -> Result<(), String> {
        let member = self.get_member_by_uid(room_id, uid).await?;
        let display_name = member.get("display_name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let mut data = Map::new();
        data.insert("room_id".to_string(), json!(room_id));
        data.insert("uid".to_string(), json!(uid));
        data.insert("display_name".to_string(), json!(display_name));
        data.insert("updated_at".to_string(), json!(Self::now_iso()));
        self.db.upsert("typing_indicators", &data).await.map_err(|e| e.to_string())
    }

    pub async fn get_typing(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        let all = self.db
            .select("typing_indicators")
            .eq("room_id", room_id)
            .execute()
            .await
            .map_err(|e| e.to_string())?;

        let cutoff = Utc::now() - chrono::Duration::milliseconds(3000);
        let cutoff_iso = cutoff.to_rfc3339();
        Ok(all.into_iter()
            .filter(|m| {
                let ts = m.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
                ts > cutoff_iso.as_str()
            })
            .collect())
    }

    // ── Task Dependencies ────────────────────────────────────────────────────

    pub async fn set_task_blocked_by(&self, _room_id: &str, task_id: &str, blocked_by: Vec<String>) -> Result<(), String> {
        let mut update = Map::new();
        update.insert("blocked_by".to_string(), json!(blocked_by));
        self.db.update_by_id("tasks", task_id, &update).await.map_err(|e| e.to_string())
    }

    // ── Member Stats (Phase 12) ──────────────────────────────────────────────

    pub async fn get_member_stats(&self, room_id: &str, uid: &str) -> Result<Value, String> {
        let member = self.get_member_by_uid(room_id, uid).await?;

        let tasks = self.db.select("tasks").eq("room_id", room_id).execute().await.map_err(|e| e.to_string())?;
        let nudges = self.db.select("nudges").eq("room_id", room_id).execute().await.map_err(|e| e.to_string())?;
        let events = self.db.select("events").eq("room_id", room_id).execute().await.unwrap_or_default();

        let my_tasks: Vec<_> = tasks.iter().filter(|t| t.get("assigned_to_id").and_then(|a| a.as_str()) == Some(uid)).collect();
        let completed = my_tasks.iter().filter(|t| t.get("status").and_then(|s| s.as_str()) == Some("completed")).count();
        let overdue = my_tasks.iter().filter(|t| {
            let deadline = t.get("internal_deadline").and_then(|d| d.as_str()).unwrap_or("");
            let status = t.get("status").and_then(|s| s.as_str()).unwrap_or("");
            status != "completed" && !deadline.is_empty() && deadline < Self::now_iso().as_str()
        }).count();
        let rescues = my_tasks.iter().filter(|t| t.get("is_rescue").and_then(|r| r.as_bool()).unwrap_or(false)).count();
        let nudges_sent = nudges.iter().filter(|n| n.get("from_uid").and_then(|u| u.as_str()) == Some(uid)).count();
        let nudges_received = nudges.iter().filter(|n| n.get("to_uid").and_then(|u| u.as_str()) == Some(uid)).count();
        let reviews_done = events.iter().filter(|e| {
            e.get("event_type").and_then(|t| t.as_str()) == Some("task_approved")
                && e.get("actor_uid").and_then(|u| u.as_str()) == Some(uid)
        }).count();
        let reviews_pending = tasks.iter().filter(|t| {
            t.get("status").and_then(|s| s.as_str()) == Some("under_review")
                && t.get("assigned_reviewer_id").and_then(|r| r.as_str()) == Some(uid)
        }).count();

        // Streak calculation
        let mut completion_dates: Vec<chrono::NaiveDate> = my_tasks.iter()
            .filter_map(|t| {
                t.get("completed_at").and_then(|c| c.as_str())
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.naive_utc().date())
            })
            .collect();
        completion_dates.sort();
        completion_dates.dedup();

        let (current_streak, longest_streak) = if completion_dates.is_empty() {
            (0, 0)
        } else {
            let mut longest = 1i64;
            let mut current_run = 1i64;
            for i in 1..completion_dates.len() {
                let prev = completion_dates[i - 1];
                let curr = completion_dates[i];
                if (curr - prev).num_days() == 1 {
                    current_run += 1;
                    if current_run > longest { longest = current_run; }
                } else {
                    current_run = 1;
                }
            }
            let today = chrono::Utc::now().naive_utc().date();
            let last = *completion_dates.last().unwrap();
            let current = if (today - last).num_days() <= 1 { current_run } else { 0 };
            (current, longest)
        };

        // Weekly activity (last 12 weeks)
        let today = chrono::Utc::now().naive_utc().date();
        let mut weekly_activity = vec![0i64; 12];
        for d in &completion_dates {
            let days_ago = (today - *d).num_days();
            if days_ago >= 0 {
                let week_idx = (days_ago / 7) as usize;
                if week_idx < 12 {
                    let target = 11usize.saturating_sub(week_idx);
                    weekly_activity[target] += 1;
                }
            }
        }

        // On-time rate
        let completed_tasks: Vec<_> = my_tasks.iter().filter(|t| t.get("status").and_then(|s| s.as_str()) == Some("completed")).collect();
        let on_time_done = completed_tasks.iter().filter(|t| {
            let completed_at = t.get("completed_at").and_then(|v| v.as_str()).unwrap_or("");
            let deadline = t.get("internal_deadline").and_then(|v| v.as_str()).unwrap_or("");
            !completed_at.is_empty() && !deadline.is_empty() && completed_at <= deadline
        }).count();
        let on_time_rate = if completed_tasks.is_empty() { 0i64 } else {
            ((on_time_done as f64 / completed_tasks.len() as f64) * 100.0).round() as i64
        };

        // Badges
        let mut badges: Vec<String> = Vec::new();
        let total_pts = member.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);
        if completed >= 1      { badges.push("first_blood".into()); }
        if rescues >= 1        { badges.push("rescuer".into()); }
        if rescues >= 5        { badges.push("ghostbuster".into()); }
        if reviews_done >= 10  { badges.push("mentor".into()); }
        if current_streak >= 7 { badges.push("streak_7".into()); }
        if current_streak >= 30 { badges.push("streak_30".into()); }
        if nudges_sent >= 50   { badges.push("nudge_master".into()); }
        if total_pts >= 500    { badges.push("point_legend".into()); }
        if completed >= 25     { badges.push("team_player".into()); }

        Ok(json!({
            "uid": uid,
            "display_name": member.get("display_name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
            "total_pts": total_pts,
            "tasks_completed": completed,
            "tasks_assigned": my_tasks.len(),
            "tasks_overdue": overdue,
            "nudges_sent": nudges_sent,
            "nudges_received": nudges_received,
            "rescues": rescues,
            "reviews_done": reviews_done,
            "reviews_pending": reviews_pending,
            "on_time_rate": on_time_rate,
            "weekly_activity": weekly_activity,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "badges": badges,
            "role": member.get("role").and_then(|r| r.as_str()).unwrap_or("member"),
        }))
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    async fn resolve_room_id(&self, room_id: Option<String>) -> Result<String, String> {
        let rid = if let Some(r) = room_id {
            r
        } else {
            self.current_room_id.read().await.clone().unwrap_or_default()
        };
        if rid.is_empty() {
            Err("No active room.".to_string())
        } else {
            Ok(rid)
        }
    }
}

// ── Database (top-level container) ──────────────────────────────────────────

pub struct Database {
    pub auth: Arc<FirebaseAuth>,
    pub db: Arc<SupabaseClient>,
    pub room: Arc<RoomManager>,
    pub cf: Arc<CFCaller>,
}

impl Database {
    pub fn new(config: AppConfig, auth: Arc<FirebaseAuth>) -> Self {
        let db = Arc::new(SupabaseClient::new(
            &config.supabase.url,
            &config.supabase.service_key,
            &config.supabase.anon_key,
        ));
        // CFCaller retains firebase config for fallback cloud functions
        let firebase_cfg = FirebaseConfig {
            api_key: config.firebase.api_key.clone(),
            auth_domain: config.firebase.auth_domain.clone(),
            project_id: config.firebase.project_id.clone(),
            storage_bucket: String::new(),
            messaging_sender_id: String::new(),
            app_id: String::new(),
            oauth_client_id: String::new(),
            use_emulator: config.firebase.use_emulator,
        };
        let cf = Arc::new(CFCaller::new(firebase_cfg, "".to_string()));
        let room = Arc::new(RoomManager::new(db.clone()));
        Self { auth, db, room, cf }
    }

    pub async fn set_token(&self, token: String) {
        // Supabase uses service key — no per-user token needed on backend
        // CFCaller still needs firebase token for fallback functions
        self.cf.set_token(token).await;
    }

    pub async fn sign_out(&self) {
        self.auth.sign_out().await;
        self.set_token("".to_string()).await;
    }
}
