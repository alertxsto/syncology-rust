use crate::config::firebase::FirebaseConfig;
use crate::database::firestore::FirestoreClient;
use crate::services::auth::FirebaseAuth;
use crate::utils::cf_caller::CFCaller;
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::Utc;

pub struct RoomManager {
    fb: Arc<FirestoreClient>,
    current_room_id: Arc<RwLock<Option<String>>>,
    member_id: Arc<RwLock<Option<String>>>,
}

impl RoomManager {
    pub fn new(fb: Arc<FirestoreClient>) -> Self {
        Self {
            fb,
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

    /// Lookup a member doc by Firebase Auth UID. Returns the member map.
    ///
    /// Supports legacy field names so older rooms still work after schema migrations.
    async fn get_member_by_uid(&self, room_id: &str, uid: &str) -> Result<Map<String, Value>, String> {
        let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;
        members.into_iter()
            .find(|m| {
                let uid_match = ["uid", "user_uid", "user_id", "userId", "firebase_uid"]
                    .iter()
                    .any(|k| m.get(*k).and_then(|u| u.as_str()) == Some(uid));
                let doc_id_match = m.get("id").and_then(|v| v.as_str()) == Some(uid);
                uid_match || doc_id_match
            })
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
    /// Frontend sends "Easy" / "Medium" / "Hard" / "Very Hard" (CamelCase).
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

    pub async fn create_room(
        &self,
        project_name: &str,
        global_deadline: Option<&str>,
        external_chat_url: Option<&str>,
        uid: &str,
        display_name: &str,
    ) -> Result<Value, crate::database::firestore::FirestoreError> {
        let room_code = Self::gen_room_code();
        let deadline = global_deadline.map(|s| s.to_string()).unwrap_or_else(|| Self::now_iso());

        let mut data = Map::new();
        data.insert("room_code".to_string(), json!(room_code));
        data.insert("project_name".to_string(), json!(project_name));
        data.insert("global_deadline".to_string(), json!(deadline));
        data.insert("created_at".to_string(), json!(Self::now_iso()));
        data.insert("is_active".to_string(), json!(true));
        data.insert("external_chat_url".to_string(), json!(external_chat_url.unwrap_or("")));
        data.insert("archived_at".to_string(), json!(""));

        let result = self.fb.add("rooms", &data).await?;
        let room_id = result.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

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
        let rooms = self.fb.query("rooms", "room_code", "EQUAL", &json!(room_code)).await
            .map_err(|e| e.to_string())?;

        if rooms.is_empty() {
            return Err("Room code tidak ditemukan.".to_string());
        }

        let room = &rooms[0];
        let room_id = room.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

        if let Some(is_active) = room.get("is_active").and_then(|b| b.as_bool()) {
            if !is_active {
                return Err("Room sudah tidak aktif.".to_string());
            }
        }

        let existing = self.fb.query(&format!("rooms/{}/members", room_id), "uid", "EQUAL", &json!(uid)).await
            .map_err(|e| e.to_string())?;

        if !existing.is_empty() {
            let member = &existing[0];
            let member_id = member.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
            self.set_room(room_id.clone(), member_id.clone()).await;
            return Ok(json!({
                "room_id": room_id,
                "member_id": member_id,
                "is_rejoin": true
            }));
        }

        let member_id = self.add_member_internal(&room_id, uid, display_name, "member").await
            .map_err(|e| e.to_string())?;

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
        // Efficient query: find all member docs for this uid via collection group,
        // then fetch only those room docs.
        let member_hits = self
            .fb
            .query_collection_group("members", "uid", "EQUAL", &json!(uid))
            .await
            .map_err(|e| e.to_string())?;

        let mut my_rooms = Vec::new();
        let mut seen_room_ids = std::collections::HashSet::new();

        for member in member_hits {
            let doc_name = member.get("_doc_name").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = doc_name
                .split("/rooms/")
                .nth(1)
                .and_then(|s| s.split("/members/").next())
                .unwrap_or("")
                .to_string();

            if room_id.is_empty() || seen_room_ids.contains(&room_id) {
                continue;
            }
            seen_room_ids.insert(room_id.clone());

            if let Some(mut room) = self.fb.get(&format!("rooms/{}", room_id)).await.map_err(|e| e.to_string())? {
                room.insert("id".to_string(), json!(room_id));
                room.insert("my_role".to_string(), member.get("role").cloned().unwrap_or(json!("")));
                room.insert("my_member_id".to_string(), member.get("id").cloned().unwrap_or(json!("")));
                my_rooms.push(room);
            }
        }

        Ok(my_rooms)
    }

    async fn add_member_internal(&self, room_id: &str, uid: &str, display_name: &str, role: &str) -> Result<String, crate::database::firestore::FirestoreError> {
        let mut data = Map::new();
        data.insert("uid".to_string(), json!(uid));
        data.insert("display_name".to_string(), json!(display_name));
        data.insert("role".to_string(), json!(role));
        data.insert("joined_at".to_string(), json!(Self::now_iso()));
        data.insert("nudge_pts".to_string(), json!(0));
        data.insert("total_pts".to_string(), json!(0));
        data.insert("nudge_sent_today".to_string(), json!(0));
        data.insert("nudge_reset_date".to_string(), json!(Utc::now().format("%Y-%m-%d").to_string()));

        let result = self.fb.add(&format!("rooms/{}/members", room_id), &data).await?;
        Ok(result.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string())
    }

    pub async fn get_tasks(&self, room_id: Option<String>) -> Result<Vec<Map<String, Value>>, String> {
        let rid = if let Some(r) = room_id { r } else { self.current_room_id.read().await.clone().unwrap_or_default() };
        if rid.is_empty() {
            return Ok(vec![]);
        }
        self.fb.list(&format!("rooms/{}/tasks", rid)).await.map_err(|e| e.to_string())
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
        let rid = if let Some(r) = room_id { r } else { self.current_room_id.read().await.clone().unwrap_or_default() };
        if rid.is_empty() {
            return Err("No active room.".to_string());
        }

        let proposed_by = self.member_id.read().await.clone().unwrap_or_default();
        let weight = Self::weight_for_difficulty(difficulty);

        let mut data = Map::new();
        data.insert("title".to_string(), json!(title));
        data.insert("description".to_string(), json!(description));
        data.insert("assigned_to_id".to_string(), json!(assigned_to_id));
        data.insert("proposed_by_id".to_string(), json!(proposed_by));
        data.insert("weight".to_string(), json!(weight));
        data.insert("difficulty".to_string(), json!(difficulty));
        let category = category.unwrap_or("technical");
        data.insert("category".to_string(), json!(category));
        data.insert("status".to_string(), json!("proposed"));
        data.insert("internal_deadline".to_string(), json!(if internal_deadline.is_empty() { Self::now_iso() } else { internal_deadline.to_string() }));
        data.insert("evidence_url".to_string(), json!(""));
        data.insert("approved_by_id".to_string(), json!(""));
        data.insert("rejection_reason".to_string(), json!(""));
        data.insert("is_rescue".to_string(), json!(false));
        data.insert("proposed_at".to_string(), json!(Self::now_iso()));
        data.insert("approved_at".to_string(), json!(""));
        data.insert("submitted_at".to_string(), json!(""));
        data.insert("completed_at".to_string(), json!(""));
        data.insert("escalation_level".to_string(), json!(0));
        data.insert("escalated_at".to_string(), json!(""));
        data.insert("assigned_reviewer_id".to_string(), json!(""));

        let result = self.fb.add(&format!("rooms/{}/tasks", rid), &data).await.map_err(|e| e.to_string())?;
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
        let rid = if let Some(r) = room_id { r } else { self.current_room_id.read().await.clone().unwrap_or_default() };
        if rid.is_empty() {
            return Err("No active room.".to_string());
        }

        let path = format!("rooms/{}/tasks/{}", rid, task_id);
        let before = self.fb.get(&path).await.map_err(|e| e.to_string())?.unwrap_or_default();
        let before_status = before.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();

        self.fb.update(&path, data).await.map_err(|e| e.to_string())?;

        let after = self.fb.get(&path).await.map_err(|e| e.to_string())?.unwrap_or_default();
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
        let rid = if let Some(r) = room_id { r } else { self.current_room_id.read().await.clone().unwrap_or_default() };
        if rid.is_empty() {
            return Err("No active room.".to_string());
        }

        let path = format!("rooms/{}/tasks/{}", rid, task_id);
        let existing = self.fb.get(&path).await.map_err(|e| e.to_string())?.unwrap_or_default();
        let title = existing.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let status = existing.get("status").and_then(|v| v.as_str()).unwrap_or("");

        self.fb.delete(&path).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(&rid, actor_uid, "task_deleted", json!({
            "task_id": task_id,
            "title": title,
            "status": status,
        })).await;

        Ok(())
    }

    pub async fn send_nudge_local(&self, room_id: &str, to_uid: &str, task_id: &str, from_uid: &str) -> Result<Value, String> {
        let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;

        let sender = members.iter().find(|m| m.get("uid").and_then(|u| u.as_str()) == Some(from_uid))
            .ok_or_else(|| "Sender member profile not found in this room.".to_string())?;
        let recipient = members.iter().find(|m| m.get("uid").and_then(|u| u.as_str()) == Some(to_uid))
            .ok_or_else(|| "Recipient member profile not found in this room.".to_string())?;

        let sender_id = sender.get("id").and_then(|i| i.as_str()).unwrap_or("");
        let sender_name = sender.get("display_name").and_then(|n| n.as_str()).unwrap_or("Someone");

        let mut nudge_sent = sender.get("nudge_sent_today").and_then(|v| v.as_i64()).unwrap_or(0);
        let reset_date = sender.get("nudge_reset_date").and_then(|v| v.as_str()).unwrap_or("");
        let today = Utc::now().format("%Y-%m-%d").to_string();

        if reset_date != today {
            nudge_sent = 0;
        }

        if nudge_sent >= 3 {
            return Err("Batas nudge harian (3/hari) telah tercapai!".to_string());
        }

        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let task = tasks.iter().find(|t| t.get("id").and_then(|i| i.as_str()) == Some(task_id))
            .ok_or_else(|| "Task not found.".to_string())?;
        let task_title = task.get("title").and_then(|t| t.as_str()).unwrap_or("Task");

        // Write nudge notification document.
        // IMPORTANT: field names must match what frontend reads in Dashboard.tsx.
        // Frontend filters by `n.to_uid === user.uid`.
        let mut nudge_data = Map::new();
        nudge_data.insert("from_member_id".into(), json!(sender_id)); // Firestore member doc ID
        nudge_data.insert("from_uid".into(), json!(from_uid));        // Firebase Auth UID
        nudge_data.insert("from_name".into(), json!(sender_name));
        nudge_data.insert("to_uid".into(), json!(to_uid));            // Firebase Auth UID (used by frontend)
        nudge_data.insert("task_id".into(), json!(task_id));
        nudge_data.insert("task_title".into(), json!(task_title));
        nudge_data.insert("timestamp".into(), json!(Self::now_iso()));
        nudge_data.insert("read".into(), json!(false));               // unread tracking

        self.fb.add(&format!("rooms/{}/nudges", room_id), &nudge_data).await.map_err(|e| e.to_string())?;

        // Update sender member stats (+2 points reward)
        let mut sender_update = Map::new();
        sender_update.insert("nudge_sent_today".into(), json!(nudge_sent + 1));
        sender_update.insert("nudge_reset_date".into(), json!(today));
        sender_update.insert("total_pts".into(), json!(sender.get("total_pts").and_then(|v| v.as_i64()).unwrap_or(0) + 2));
        sender_update.insert("nudge_pts".into(), json!(sender.get("nudge_pts").and_then(|v| v.as_i64()).unwrap_or(0) + 2));

        self.fb.update(&format!("rooms/{}/members/{}", room_id, sender_id), &sender_update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, from_uid, "nudge_sent", json!({
            "to_uid": to_uid,
            "task_id": task_id,
            "task_title": task_title,
        })).await;

        Ok(json!({"status": "ok", "nudge_sent_today": nudge_sent + 1}))
    }

    pub async fn submit_evidence_local(&self, room_id: &str, task_id: &str, evidence_url: &str, evidence_meta: Option<Value>, current_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, current_uid).await?;

        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let task = tasks.iter().find(|t| t.get("id").and_then(|i| i.as_str()) == Some(task_id))
            .ok_or_else(|| "Task not found.".to_string())?;
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");

        // Authorization: only the assignee can submit evidence
        if current_uid != assignee_uid {
            return Err("Forbidden: only the assignee can submit evidence.".to_string());
        }

        let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;

        // Pick reviewer: anyone who is not the assignee
        let mut reviewer_uid = String::new();
        for m in &members {
            let m_uid = m.get("uid").and_then(|u| u.as_str()).unwrap_or("");
            let m_role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if m_uid != assignee_uid && m_role != "leader" {
                reviewer_uid = m_uid.to_string();
                break;
            }
        }
        if reviewer_uid.is_empty() {
            for m in &members {
                let m_uid = m.get("uid").and_then(|u| u.as_str()).unwrap_or("");
                if m_uid != assignee_uid {
                    reviewer_uid = m_uid.to_string();
                    break;
                }
            }
        }
        if reviewer_uid.is_empty() {
            reviewer_uid = assignee_uid.to_string();
        }

        let mut update_data = Map::new();
        update_data.insert("status".into(), json!("under_review"));
        update_data.insert("evidence_url".into(), json!(evidence_url));
        if let Some(meta) = evidence_meta.clone() {
            update_data.insert("evidence_meta".into(), meta);
        }
        update_data.insert("submitted_at".into(), json!(Self::now_iso()));
        update_data.insert("assigned_reviewer_id".into(), json!(reviewer_uid));

        self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &update_data).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, current_uid, "evidence_submitted", json!({
            "task_id": task_id,
            "assigned_reviewer_id": reviewer_uid,
            "has_evidence_meta": evidence_meta.is_some(),
        })).await;

        Ok(json!({"status": "ok", "assigned_reviewer_id": reviewer_uid}))
    }

    pub async fn review_task_local(&self, room_id: &str, task_id: &str, reviewer_uid: &str, decision: &str, reason: &str) -> Result<Value, String> {
        self.assert_member(room_id, reviewer_uid).await?;

        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let task = tasks.iter().find(|t| t.get("id").and_then(|i| i.as_str()) == Some(task_id))
            .ok_or_else(|| "Task not found.".to_string())?;
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");
        let assigned_reviewer = task.get("assigned_reviewer_id").and_then(|a| a.as_str()).unwrap_or("");

        // Authorization: only the assigned reviewer can review
        if reviewer_uid != assigned_reviewer {
            return Err("Forbidden: you are not the assigned reviewer for this task.".to_string());
        }

        if decision == "approve" {
            let weight = task.get("weight").and_then(|w| w.as_i64()).unwrap_or(10);
            let is_rescue = task.get("is_rescue").and_then(|r| r.as_bool()).unwrap_or(false);
            let earned = if is_rescue { ((weight as f64) * 1.5).ceil() as i64 } else { weight };

            let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;
            if let Some(assignee) = members.iter().find(|m| m.get("uid").and_then(|u| u.as_str()) == Some(assignee_uid)) {
                let assignee_id = assignee.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let current_pts = assignee.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);

                let mut member_update = Map::new();
                member_update.insert("total_pts".into(), json!(current_pts + earned));
                self.fb.update(&format!("rooms/{}/members/{}", room_id, assignee_id), &member_update).await.map_err(|e| e.to_string())?;
            }

            let mut task_update = Map::new();
            task_update.insert("status".into(), json!("completed"));
            task_update.insert("completed_at".into(), json!(Self::now_iso()));
            task_update.insert("approved_by_id".into(), json!(reviewer_uid));
            task_update.insert("approved_at".into(), json!(Self::now_iso()));

            self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &task_update).await.map_err(|e| e.to_string())?;
        } else {
            let mut task_update = Map::new();
            task_update.insert("status".into(), json!("todo"));
            task_update.insert("rejection_reason".into(), json!(reason));

            self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &task_update).await.map_err(|e| e.to_string())?;
        }

        let _ = self.log_event(room_id, reviewer_uid, if decision == "approve" { "task_approved" } else { "task_rejected" }, json!({
            "task_id": task_id,
            "reason": reason,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    pub async fn rescue_task_local(&self, room_id: &str, task_id: &str, rescuer_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, rescuer_uid).await?;

        // Look up the task to prevent self-rescue
        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let task = tasks.iter().find(|t| t.get("id").and_then(|i| i.as_str()) == Some(task_id))
            .ok_or_else(|| "Task not found.".to_string())?;
        let current_assignee = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");
        let esc_level = task.get("escalation_level").and_then(|e| e.as_i64()).unwrap_or(0);

        if rescuer_uid == current_assignee {
            return Err("Cannot rescue your own task — transfer ownership first.".to_string());
        }
        if esc_level != 3 {
            return Err("Task is not in ghost pool, cannot rescue.".to_string());
        }

        let mut task_update = Map::new();
        task_update.insert("assigned_to_id".into(), json!(rescuer_uid));
        task_update.insert("is_rescue".into(), json!(true));
        task_update.insert("escalation_level".into(), json!(0));
        task_update.insert("status".into(), json!("todo"));
        task_update.insert("backup_message".into(), json!(""));

        self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &task_update).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, rescuer_uid, "task_rescued", json!({
            "task_id": task_id,
            "previous_assignee": current_assignee,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    pub async fn call_for_backup_local(&self, room_id: &str, task_id: &str, message: &str, from_uid: &str) -> Result<Value, String> {
        let sender = self.assert_member(room_id, from_uid).await?;

        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let task = tasks.iter().find(|t| t.get("id").and_then(|i| i.as_str()) == Some(task_id))
            .ok_or_else(|| "Task not found.".to_string())?;
        let task_title = task.get("title").and_then(|t| t.as_str()).unwrap_or("Task");
        let assignee_uid = task.get("assigned_to_id").and_then(|a| a.as_str()).unwrap_or("");

        // Authorization: only the assignee or leader can call for backup
        let sender_role = sender.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if from_uid != assignee_uid && sender_role != "leader" {
            return Err("Forbidden: only the assignee or leader can call for backup.".to_string());
        }

        let sender_name = sender.get("display_name").and_then(|n| n.as_str()).unwrap_or("Someone");

        let mut task_update = Map::new();
        task_update.insert("escalation_level".into(), json!(3));
        task_update.insert("escalated_at".into(), json!(Self::now_iso()));
        task_update.insert("backup_message".into(), json!(message));

        self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &task_update).await.map_err(|e| e.to_string())?;

        // Post system message to chat
        let sys_body = format!("📢 [SYSTEM] {} membutuhkan bantuan untuk tugas \"{}\": \"{}\"", sender_name, task_title, message);
        let mut sys_msg = Map::new();
        sys_msg.insert("sender_id".into(), json!("system"));
        sys_msg.insert("sender_name".into(), json!("System"));
        sys_msg.insert("message_body".into(), json!(sys_body));
        sys_msg.insert("timestamp".into(), json!(Self::now_iso()));

        self.fb.add(&format!("rooms/{}/messages", room_id), &sys_msg).await.map_err(|e| e.to_string())?;

        let _ = self.log_event(room_id, from_uid, "backup_called", json!({
            "task_id": task_id,
            "message": message,
        })).await;

        Ok(json!({"status": "ok"}))
    }

    pub async fn give_kudos_local(&self, room_id: &str, task_id: &str, to_uid: &str, from_uid: &str) -> Result<Value, String> {
        self.assert_member(room_id, from_uid).await?;
        self.assert_member(room_id, to_uid).await?;

        if from_uid == to_uid {
            return Err("Tidak bisa memberi kudos ke diri sendiri.".to_string());
        }

        let task_path = format!("rooms/{}/tasks/{}", room_id, task_id);
        let task = self.fb.get(&task_path).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Task not found.".to_string())?;

        let task_status = task.get("status").and_then(|s| s.as_str()).unwrap_or("");
        if task_status != "completed" {
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
        task_update.insert("kudos_by".into(), json!(kudos_by));
        task_update.insert("kudos_count".into(), json!(kudos_count));
        self.fb.update(&task_path, &task_update).await.map_err(|e| e.to_string())?;

        // +1 point to recipient for each unique kudos
        let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;
        if let Some(recipient) = members.iter().find(|m| m.get("uid").and_then(|u| u.as_str()) == Some(to_uid)) {
            let recipient_id = recipient.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let current_pts = recipient.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);
            let mut member_update = Map::new();
            member_update.insert("total_pts".into(), json!(current_pts + 1));
            self.fb.update(&format!("rooms/{}/members/{}", room_id, recipient_id), &member_update).await.map_err(|e| e.to_string())?;
        }

        let _ = self.log_event(room_id, from_uid, "kudos_sent", json!({
            "task_id": task_id,
            "to_uid": to_uid,
        })).await;

        Ok(json!({"status": "ok", "already_sent": false, "kudos_count": kudos_count}))
    }

    pub async fn remove_member_local(&self, room_id: &str, member_id: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;

        // Prevent removing a leader (including self)
        let target = self.fb.get(&format!("rooms/{}/members/{}", room_id, member_id)).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Member not found.".to_string())?;
        if target.get("role").and_then(|r| r.as_str()) == Some("leader") {
            return Err("Cannot remove a leader. Transfer leadership first.".to_string());
        }

        self.fb.delete(&format!("rooms/{}/members/{}", room_id, member_id)).await.map_err(|e| e.to_string())?;

        // Audit log
        self.log_event(room_id, current_uid, "member_removed", json!({
            "target_member_id": member_id,
            "target_name": target.get("display_name").and_then(|n| n.as_str()).unwrap_or(""),
        })).await.ok();

        Ok(json!({"status": "ok"}))
    }

    pub async fn end_room_local(&self, room_id: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;
        let mut room_update = Map::new();
        room_update.insert("is_active".into(), json!(false));
        room_update.insert("archived_at".into(), json!(Self::now_iso()));

        self.fb.update(&format!("rooms/{}", room_id), &room_update).await.map_err(|e| e.to_string())?;

        self.log_event(room_id, current_uid, "room_ended", json!({})).await.ok();
        Ok(json!({"status": "ok"}))
    }

    pub async fn update_room_local(&self, room_id: &str, name: &str, deadline: &str, chat_url: &str, current_uid: &str) -> Result<Value, String> {
        self.assert_leader(room_id, current_uid).await?;
        let mut room_update = Map::new();
        room_update.insert("project_name".into(), json!(name));
        room_update.insert("global_deadline".into(), json!(deadline));
        room_update.insert("external_chat_url".into(), json!(chat_url));

        self.fb.update(&format!("rooms/{}", room_id), &room_update).await.map_err(|e| e.to_string())?;

        self.log_event(room_id, current_uid, "room_updated", json!({
            "project_name": name,
        })).await.ok();
        Ok(json!({"status": "ok"}))
    }

    /// Audit log helper — append-only event document under `rooms/{roomId}/events`.
    pub async fn log_event(&self, room_id: &str, actor_uid: &str, event_type: &str, payload: Value) -> Result<(), String> {
        // Look up actor display name (best-effort, ignore errors)
        let actor_name = self.get_member_by_uid(room_id, actor_uid).await
            .ok()
            .and_then(|m| m.get("display_name").and_then(|n| n.as_str()).map(String::from))
            .unwrap_or_else(|| "Unknown".to_string());

        let mut data = Map::new();
        data.insert("actor_uid".into(), json!(actor_uid));
        data.insert("actor_name".into(), json!(actor_name));
        data.insert("event_type".into(), json!(event_type));
        data.insert("payload".into(), payload);
        data.insert("timestamp".into(), json!(Self::now_iso()));

        self.fb.add(&format!("rooms/{}/events", room_id), &data).await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub async fn get_events(&self, room_id: &str, limit: Option<usize>) -> Result<Vec<Map<String, Value>>, String> {
        let mut events = self.fb.list(&format!("rooms/{}/events", room_id)).await.map_err(|e| e.to_string())?;
        // Sort by timestamp desc (most recent first)
        events.sort_by(|a, b| {
            let ta = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            let tb = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            tb.cmp(ta)
        });
        if let Some(n) = limit {
            events.truncate(n);
        }
        Ok(events)
    }

    pub async fn get_members(&self, room_id: Option<String>) -> Result<Vec<Map<String, Value>>, String> {
        let rid = if let Some(r) = room_id { r } else { self.current_room_id.read().await.clone().unwrap_or_default() };
        if rid.is_empty() {
            return Ok(vec![]);
        }
        self.fb.list(&format!("rooms/{}/members", rid)).await.map_err(|e| e.to_string())
    }

    pub async fn send_room_message(&self, room_id: &str, sender_id: &str, sender_name: &str, body: &str, reply_to: Option<&str>) -> Result<Value, String> {
        let mut data = Map::new();
        data.insert("sender_id".into(), json!(sender_id));
        data.insert("sender_name".into(), json!(sender_name));
        data.insert("message_body".into(), json!(body));
        data.insert("timestamp".into(), json!(Self::now_iso()));
        data.insert("edited".into(), json!(false));
        data.insert("reply_to".into(), json!(reply_to.unwrap_or("")));

        let res = self.fb.add(&format!("rooms/{}/messages", room_id), &data).await.map_err(|e| e.to_string())?;

        // Don't log chat messages to events feed (would be too noisy)
        Ok(json!(res))
    }

    pub async fn get_room_messages(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        let mut msgs = self.fb.list(&format!("rooms/{}/messages", room_id)).await.map_err(|e| e.to_string())?;
        msgs.sort_by(|a, b| {
            let ta = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            let tb = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            ta.cmp(tb)
        });
        Ok(msgs)
    }

    pub async fn get_nudges_local(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        self.fb.list(&format!("rooms/{}/nudges", room_id)).await.map_err(|e| e.to_string())
    }

    pub async fn add_message_reaction(&self, room_id: &str, message_id: &str, emoji: &str, user_id: &str) -> Result<Value, String> {
        let path = format!("rooms/{}/messages/{}", room_id, message_id);
        let mut msg = self.fb.get(&path).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        let mut reactions = msg.get("reactions")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(Map::new);

        let mut users = reactions.get(emoji)
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

        let mut update_data = Map::new();
        update_data.insert("reactions".into(), json!(reactions));

        self.fb.update(&path, &update_data).await.map_err(|e| e.to_string())?;
        Ok(json!({"status": "ok"}))
    }

    // ── Phase 5: Task comments (thread) ─────────────────────────────

    pub async fn add_task_comment(&self, room_id: &str, task_id: &str, author_uid: &str, text: &str) -> Result<Value, String> {
        let author = self.get_member_by_uid(room_id, author_uid).await?;
        let author_name = author.get("display_name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let mut data = Map::new();
        data.insert("author_uid".into(), json!(author_uid));
        data.insert("author_name".into(), json!(author_name));
        data.insert("comment_text".into(), json!(text));
        data.insert("timestamp".into(), json!(Self::now_iso()));

        let res = self.fb.add(&format!("rooms/{}/tasks/{}/comments", room_id, task_id), &data).await
            .map_err(|e| e.to_string())?;
        Ok(json!(res))
    }

    pub async fn get_task_comments(&self, room_id: &str, task_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        let mut comments = self.fb.list(&format!("rooms/{}/tasks/{}/comments", room_id, task_id)).await
            .map_err(|e| e.to_string())?;
        comments.sort_by(|a, b| {
            let ta = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            let tb = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
            ta.cmp(tb)
        });
        Ok(comments)
    }

    pub async fn delete_task_comment(&self, room_id: &str, task_id: &str, comment_id: &str, author_uid: &str) -> Result<(), String> {
        // Authorization: only the author can delete their comment
        let comment = self.fb.get(&format!("rooms/{}/tasks/{}/comments/{}", room_id, task_id, comment_id)).await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Comment not found.".to_string())?;
        if comment.get("author_uid").and_then(|u| u.as_str()) != Some(author_uid) {
            return Err("Forbidden: only the author can delete their comment.".to_string());
        }
        self.fb.delete(&format!("rooms/{}/tasks/{}/comments/{}", room_id, task_id, comment_id)).await
            .map_err(|e| e.to_string())
    }

    // ── Phase 9: Typing indicator ───────────────────────────────────
    //
    // Stored under `rooms/{roomId}/typing/{uid}` with TTL via timestamp.
    // Frontend polls every 2 seconds and filters entries with timestamp < now - 3000ms.

    pub async fn set_typing(&self, room_id: &str, uid: &str) -> Result<(), String> {
        let member = self.get_member_by_uid(room_id, uid).await?;
        let display_name = member.get("display_name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let mut data = Map::new();
        data.insert("uid".into(), json!(uid));
        data.insert("display_name".into(), json!(display_name));
        data.insert("timestamp".into(), json!(chrono::Utc::now().timestamp_millis()));

        // Upsert — Firestore doesn't have native upsert via REST, but `add` to a named doc path
        // via patch works as upsert
        self.fb.update(&format!("rooms/{}/typing/{}", room_id, uid), &data).await
            .map_err(|e| e.to_string())
    }

    pub async fn get_typing(&self, room_id: &str) -> Result<Vec<Map<String, Value>>, String> {
        let all = self.fb.list(&format!("rooms/{}/typing", room_id)).await.map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        Ok(all.into_iter()
            .filter(|m| {
                let ts = m.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
                now - ts < 3000 // 3-second window
            })
            .collect())
    }

    // ── Phase 9: Edit message ───────────────────────────────────────

    pub async fn edit_room_message(&self, room_id: &str, message_id: &str, new_body: &str, editor_uid: &str) -> Result<Value, String> {
        let path = format!("rooms/{}/messages/{}", room_id, message_id);
        let msg = self.fb.get(&path).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Message not found.".to_string())?;

        // Only the original sender can edit
        if msg.get("sender_id").and_then(|s| s.as_str()) != Some(editor_uid) {
            return Err("Forbidden: only the sender can edit their message.".to_string());
        }

        let mut update = Map::new();
        update.insert("message_body".into(), json!(new_body));
        update.insert("edited".into(), json!(true));
        update.insert("edited_at".into(), json!(Self::now_iso()));

        self.fb.update(&path, &update).await.map_err(|e| e.to_string())?;
        Ok(json!({"status": "ok"}))
    }

    // ── Mark nudge as read ──────────────────────────────────────────

    pub async fn mark_nudge_read(&self, room_id: &str, nudge_id: &str) -> Result<(), String> {
        let mut update = Map::new();
        update.insert("read".into(), json!(true));
        self.fb.update(&format!("rooms/{}/nudges/{}", room_id, nudge_id), &update).await
            .map_err(|e| e.to_string())
    }

    pub async fn mark_all_nudges_read(&self, room_id: &str, uid: &str) -> Result<u32, String> {
        let nudges = self.fb.list(&format!("rooms/{}/nudges", room_id)).await.map_err(|e| e.to_string())?;
        let mut count = 0u32;
        for n in nudges {
            if n.get("to_uid").and_then(|u| u.as_str()) == Some(uid) {
                if let Some(id) = n.get("id").and_then(|i| i.as_str()) {
                    let mut update = Map::new();
                    update.insert("read".into(), json!(true));
                    let _ = self.fb.update(&format!("rooms/{}/nudges/{}", room_id, id), &update).await;
                    count += 1;
                }
            }
        }
        Ok(count)
    }

    // ── Phase 7: Task dependencies ──────────────────────────────────

    pub async fn set_task_blocked_by(&self, room_id: &str, task_id: &str, blocked_by: Vec<String>) -> Result<(), String> {
        let mut update = Map::new();
        update.insert("blocked_by".into(), json!(blocked_by));
        self.fb.update(&format!("rooms/{}/tasks/{}", room_id, task_id), &update).await
            .map_err(|e| e.to_string())
    }

    // ── Phase 12: Member stats / profile ────────────────────────────

    pub async fn get_member_stats(&self, room_id: &str, uid: &str) -> Result<Value, String> {
        let members = self.fb.list(&format!("rooms/{}/members", room_id)).await.map_err(|e| e.to_string())?;
        let member = members.iter().find(|m| m.get("uid").and_then(|u| u.as_str()) == Some(uid))
            .ok_or_else(|| "Member not found.".to_string())?;

        let tasks = self.fb.list(&format!("rooms/{}/tasks", room_id)).await.map_err(|e| e.to_string())?;
        let nudges = self.fb.list(&format!("rooms/{}/nudges", room_id)).await.map_err(|e| e.to_string())?;
        let events = self.fb.list(&format!("rooms/{}/events", room_id)).await.unwrap_or_default();

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

        // Compute streak + weekly activity: consecutive days with at least 1 completed task
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
            // Check if last completion date is today or yesterday
            let today = chrono::Utc::now().naive_utc().date();
            let last = *completion_dates.last().unwrap();
            let current = if (today - last).num_days() <= 1 { current_run } else { 0 };
            (current, longest)
        };

        // Weekly activity over last 12 weeks (bins)
        let today = chrono::Utc::now().naive_utc().date();
        let mut weekly_activity = vec![0i64; 12];
        for d in &completion_dates {
            let days_ago = (today - *d).num_days();
            if days_ago >= 0 {
                let week_idx_from_now = (days_ago / 7) as usize;
                if week_idx_from_now < 12 {
                    let target_idx = 11usize.saturating_sub(week_idx_from_now);
                    weekly_activity[target_idx] += 1;
                }
            }
        }

        // On-time completion rate
        let completed_tasks: Vec<_> = my_tasks.iter().filter(|t| t.get("status").and_then(|s| s.as_str()) == Some("completed")).collect();
        let on_time_done = completed_tasks.iter().filter(|t| {
            let completed_at = t.get("completed_at").and_then(|v| v.as_str()).unwrap_or("");
            let deadline = t.get("internal_deadline").and_then(|v| v.as_str()).unwrap_or("");
            !completed_at.is_empty() && !deadline.is_empty() && completed_at <= deadline
        }).count();
        let on_time_rate = if completed_tasks.is_empty() {
            0i64
        } else {
            ((on_time_done as f64 / completed_tasks.len() as f64) * 100.0).round() as i64
        };

        // Award badges
        let mut badges: Vec<String> = Vec::new();
        if completed >= 1      { badges.push("first_blood".into()); }
        if rescues >= 1        { badges.push("rescuer".into()); }
        if rescues >= 5        { badges.push("ghostbuster".into()); }
        if reviews_done >= 10  { badges.push("mentor".into()); }
        if current_streak >= 7 { badges.push("streak_7".into()); }
        if current_streak >= 30 { badges.push("streak_30".into()); }
        if nudges_sent >= 50   { badges.push("nudge_master".into()); }
        let total_pts = member.get("total_pts").and_then(|p| p.as_i64()).unwrap_or(0);
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
}


pub struct Database {
    pub auth: Arc<FirebaseAuth>,
    pub fb: Arc<FirestoreClient>,
    pub room: Arc<RoomManager>,
    pub cf: Arc<CFCaller>,
}

impl Database {
    pub fn new(config: FirebaseConfig, auth: Arc<FirebaseAuth>) -> Self {
        let fb = Arc::new(FirestoreClient::new(config.clone(), "".to_string()));
        let cf = Arc::new(CFCaller::new(config, "".to_string()));
        let room = Arc::new(RoomManager::new(fb.clone()));

        Self { auth, fb, room, cf }
    }

    pub async fn set_token(&self, token: String) {
        self.fb.set_token(token.clone()).await;
        self.cf.set_token(token).await;
    }

    pub async fn sign_out(&self) {
        self.auth.sign_out().await;
        self.set_token("".to_string()).await;
    }
}
