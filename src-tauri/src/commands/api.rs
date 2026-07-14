use std::sync::Arc;
use serde_json::{Value, Map};
use tauri::{State, AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex as TokioMutex;
use std::collections::HashMap;

use crate::database::manager::Database;
use crate::models::auth::FirebaseUser;

/// Global registry of active watchers, keyed by room_id.
/// Allows us to stop a watcher when the user switches rooms.
static WATCHERS: std::sync::LazyLock<TokioMutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
    std::sync::LazyLock::new(|| TokioMutex::new(HashMap::new()));

#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_room_watcher(
    roomId: String,
    app: AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    // Stop existing watcher for this room (if any)
    let mut watchers = WATCHERS.lock().await;
    if let Some(handle) = watchers.remove(&roomId) {
        handle.abort();
    }

    let db_clone = db.inner().clone();
    let room_id_clone = roomId.clone();

    let handle = tokio::spawn(async move {
        let mut last_tasks_hash: u64 = 0;
        let mut last_messages_count: usize = 0;
        let mut last_nudges_count: usize = 0;
        let mut last_events_count: usize = 0;

        loop {
            // Sleep first so we don't hammer Firestore on startup
            tokio::time::sleep(tokio::time::Duration::from_millis(2500)).await;

            // Tasks — hash-based change detection
            if let Ok(tasks) = db_clone.room.get_tasks(Some(room_id_clone.clone())).await {
                let serialized = serde_json::to_string(&tasks).unwrap_or_default();
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                serialized.hash(&mut hasher);
                let current_hash = hasher.finish();

                if current_hash != last_tasks_hash {
                    let _ = app.emit("tasks-updated", &tasks);
                    last_tasks_hash = current_hash;
                }
            }

            // Messages — count-based change detection
            if let Ok(msgs) = db_clone.room.get_room_messages(&room_id_clone).await {
                if msgs.len() != last_messages_count {
                    let _ = app.emit("messages-updated", &msgs);
                    last_messages_count = msgs.len();
                }
            }

            // Nudges
            if let Ok(nudges) = db_clone.room.get_nudges_local(&room_id_clone).await {
                if nudges.len() != last_nudges_count {
                    let _ = app.emit("nudges-updated", &nudges);
                    last_nudges_count = nudges.len();
                }
            }

            // Events / activity
            if let Ok(events) = db_clone.room.get_events(&room_id_clone, Some(50)).await {
                if events.len() != last_events_count {
                    let _ = app.emit("events-updated", &events);
                    last_events_count = events.len();
                }
            }
        }
    });

    watchers.insert(roomId, handle);
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn stop_room_watcher(
    roomId: String,
) -> Result<(), String> {
    let mut watchers = WATCHERS.lock().await;
    if let Some(handle) = watchers.remove(&roomId) {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn sign_in_with_google(db: State<'_, Arc<Database>>) -> Result<FirebaseUser, String> {
    // Build FirebaseConfig for the OAuth flow from the cf_caller's stored config
    let firebase_config = db.cf.config.clone();
    let user = db.auth.sign_in_with_google(firebase_config).await.map_err(|e| e.to_string())?;
    db.set_token(user.id_token.clone()).await;

    // Spawn a background task that auto-refreshes the token every 50 minutes
    let auth_clone = db.auth.clone();
    let cf_clone = db.cf.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(50 * 60)).await;
            match auth_clone.ensure_valid_token().await {
                Ok(new_token) => {
                    cf_clone.set_token(new_token).await;
                }
                Err(e) => {
                    eprintln!("[warn] token refresh failed: {}", e);
                    break;
                }
            }
        }
    });

    Ok(user)
}

#[tauri::command]
pub async fn sign_out(db: State<'_, Arc<Database>>) -> Result<(), String> {
    db.sign_out().await;
    Ok(())
}

#[tauri::command]
pub async fn create_room(
    project_name: String,
    global_deadline: Option<String>,
    external_chat_url: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let user = { db.auth.user.lock().await.clone() };
    if let Some(u) = user {
        let result = db.room.create_room(
            &project_name,
            global_deadline.as_deref(),
            external_chat_url.as_deref(),
            &u.uid,
            &u.display_name,
        ).await.map_err(|e| e.to_string())?;
        Ok(result)
    } else {
        Err("User not authenticated".into())
    }
}

#[tauri::command]
pub async fn join_room(
    room_code: String,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let user = { db.auth.user.lock().await.clone() };
    if let Some(u) = user {
        db.room.join_room(&room_code, &u.uid, &u.display_name).await
    } else {
        Err("User not authenticated".into())
    }
}

#[tauri::command]
pub async fn list_my_rooms(db: State<'_, Arc<Database>>) -> Result<Vec<Map<String, Value>>, String> {
    let user = { db.auth.user.lock().await.clone() };
    if let Some(u) = user {
        db.room.list_my_rooms(&u.uid).await
    } else {
        Err("User not authenticated".into())
    }
}

#[tauri::command]
pub async fn get_tasks(room_id: Option<String>, db: State<'_, Arc<Database>>) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_tasks(room_id).await
}

#[tauri::command]
pub async fn add_task(
    title: String,
    description: String,
    assigned_to_id: String,
    difficulty: String,
    category: Option<String>,
    internal_deadline: String,
    room_id: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let current_uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).unwrap_or_default()
    };
    db.room
        .add_task(
            &title,
            &description,
            &assigned_to_id,
            &difficulty,
            category.as_deref(),
            &internal_deadline,
            room_id,
            &current_uid,
        )
        .await
}

#[tauri::command]
pub async fn update_task(
    task_id: String,
    data: Map<String, Value>,
    room_id: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    let current_uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).unwrap_or_default()
    };
    db.room.update_task(&task_id, &data, room_id, &current_uid).await
}

#[tauri::command]
pub async fn delete_task(
    task_id: String,
    room_id: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    let current_uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).unwrap_or_default()
    };
    db.room.delete_task(&task_id, room_id, &current_uid).await
}

#[tauri::command]
pub async fn get_members(room_id: Option<String>, db: State<'_, Arc<Database>>) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_members(room_id).await
}

#[tauri::command]
pub async fn call_function(
    function_name: String,
    data: Value,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let current_user_uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).unwrap_or_default()
    };

    match function_name.as_str() {
        "sendNudge" => {
            let to_id = data.get("toId").and_then(|v| v.as_str()).unwrap_or("");
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if to_id.is_empty() || task_id.is_empty() || room_id.is_empty() {
                return Err("Missing required parameters for sendNudge.".to_string());
            }
            db.room.send_nudge_local(room_id, to_id, task_id, &current_user_uid).await
        }
        "submitEvidence" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            let evidence_url = data.get("evidenceUrl").and_then(|v| v.as_str()).unwrap_or("");
            let github_url = data.get("githubUrl").and_then(|v| v.as_str()).unwrap_or("");
            let notes = data.get("notes").and_then(|v| v.as_str()).unwrap_or("");
            let image_urls = data.get("imageUrls").cloned().unwrap_or_else(|| Value::Array(vec![]));

            let primary_url = if !evidence_url.is_empty() {
                evidence_url.to_string()
            } else if !github_url.is_empty() {
                github_url.to_string()
            } else if let Some(first) = image_urls.as_array().and_then(|a| a.first()).and_then(|v| v.as_str()) {
                first.to_string()
            } else {
                String::new()
            };

            if task_id.is_empty() || room_id.is_empty() || primary_url.is_empty() {
                return Err("Missing required parameters for submitEvidence.".to_string());
            }

            let evidence_meta = serde_json::json!({
                "github_url": github_url,
                "image_urls": image_urls,
                "notes": notes,
            });

            db.room.submit_evidence_local(room_id, task_id, &primary_url, Some(evidence_meta), &current_user_uid).await
        }
        "reviewTask" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            let decision = data.get("decision").and_then(|v| v.as_str()).unwrap_or("");
            let reason = data.get("reason").and_then(|v| v.as_str()).unwrap_or("");
            if task_id.is_empty() || room_id.is_empty() || decision.is_empty() {
                return Err("Missing required parameters for reviewTask.".to_string());
            }
            db.room.review_task_local(room_id, task_id, &current_user_uid, decision, reason).await
        }
        "rescueTask" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if task_id.is_empty() || room_id.is_empty() {
                return Err("Missing required parameters for rescueTask.".to_string());
            }
            db.room.rescue_task_local(room_id, task_id, &current_user_uid).await
        }
        "claimTask" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if task_id.is_empty() || room_id.is_empty() {
                return Err("Missing required parameters for claimTask.".to_string());
            }
            db.room.claim_task_local(room_id, task_id, &current_user_uid).await
        }
        "callForBackup" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            let message = data.get("message").and_then(|v| v.as_str()).unwrap_or("");
            if task_id.is_empty() || room_id.is_empty() || message.is_empty() {
                return Err("Missing required parameters for callForBackup.".to_string());
            }
            db.room.call_for_backup_local(room_id, task_id, message, &current_user_uid).await
        }
        "giveKudos" => {
            let task_id = data.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
            let to_uid = data.get("toId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if task_id.is_empty() || to_uid.is_empty() || room_id.is_empty() {
                return Err("Missing required parameters for giveKudos.".to_string());
            }
            db.room.give_kudos_local(room_id, task_id, to_uid, &current_user_uid).await
        }
        "removeMember" => {
            let member_id = data.get("memberId").and_then(|v| v.as_str()).unwrap_or("");
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if member_id.is_empty() || room_id.is_empty() {
                return Err("Missing required parameters for removeMember.".to_string());
            }
            db.room.remove_member_local(room_id, member_id, &current_user_uid).await
        }
        "endRoom" => {
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            if room_id.is_empty() {
                return Err("Missing required parameters for endRoom.".to_string());
            }
            db.room.end_room_local(room_id, &current_user_uid).await
        }
        "updateRoom" => {
            let room_id = data.get("roomId").and_then(|v| v.as_str()).unwrap_or("");
            let project_name = data.get("projectName").and_then(|v| v.as_str()).unwrap_or("");
            let global_deadline = data.get("globalDeadline").and_then(|v| v.as_str()).unwrap_or("");
            let external_chat_url = data.get("externalChatUrl").and_then(|v| v.as_str()).unwrap_or("");
            if room_id.is_empty() {
                return Err("Missing required parameters for updateRoom.".to_string());
            }
            db.room.update_room_local(room_id, project_name, global_deadline, external_chat_url, &current_user_uid).await
        }
        _ => {
            // Fallback to calling GCP Cloud Function
            db.cf.call(&function_name, data).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn send_room_message(
    roomId: String,
    body: String,
    replyTo: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let (uid, display_name) = {
        let lock = db.auth.user.lock().await;
        if let Some(ref u) = *lock {
            (u.uid.clone(), u.display_name.clone())
        } else {
            ("system".to_string(), "System".to_string())
        }
    };
    db.room.send_room_message(&roomId, &uid, &display_name, &body, replyTo.as_deref()).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_room_messages(
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_room_messages(&roomId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_nudges(
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_nudges_local(&roomId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn add_message_reaction(
    roomId: String,
    messageId: String,
    emoji: String,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).unwrap_or_else(|| "anonymous".to_string())
    };
    db.room.add_message_reaction(&roomId, &messageId, &emoji, &uid).await
}

// ── Phase 5: Task comments ─────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_task_comments(
    taskId: String,
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_task_comments(&roomId, &taskId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn add_task_comment(
    taskId: String,
    roomId: String,
    text: String,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).ok_or_else(|| "Not authenticated.".to_string())?
    };
    db.room.add_task_comment(&roomId, &taskId, &uid, &text).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn delete_task_comment(
    taskId: String,
    roomId: String,
    commentId: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).ok_or_else(|| "Not authenticated.".to_string())?
    };
    db.room.delete_task_comment(&roomId, &taskId, &commentId, &uid).await
}

// ── Phase 9: Typing & message edit ─────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_typing(
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).ok_or_else(|| "Not authenticated.".to_string())?
    };
    db.room.set_typing(&roomId, &uid).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_typing(
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_typing(&roomId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn edit_room_message(
    roomId: String,
    messageId: String,
    body: String,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).ok_or_else(|| "Not authenticated.".to_string())?
    };
    db.room.edit_room_message(&roomId, &messageId, &body, &uid).await
}

// ── Mark nudge as read ──────────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn mark_nudge_read(
    nudgeId: String,
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    db.room.mark_nudge_read(&roomId, &nudgeId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn mark_all_nudges_read(
    roomId: String,
    db: State<'_, Arc<Database>>,
) -> Result<u32, String> {
    let uid = {
        let lock = db.auth.user.lock().await;
        lock.as_ref().map(|u| u.uid.clone()).ok_or_else(|| "Not authenticated.".to_string())?
    };
    db.room.mark_all_nudges_read(&roomId, &uid).await
}

// ── Activity log ───────────────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_events(
    roomId: String,
    limit: Option<usize>,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Map<String, Value>>, String> {
    db.room.get_events(&roomId, limit).await
}

// ── Phase 7: Task dependencies ─────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn set_task_blocked_by(
    taskId: String,
    roomId: String,
    blockedBy: Vec<String>,
    db: State<'_, Arc<Database>>,
) -> Result<(), String> {
    db.room.set_task_blocked_by(&roomId, &taskId, blockedBy).await
}

// ── Phase 12: Member stats ─────────────────────────────────────────

#[tauri::command]
#[allow(non_snake_case)]
pub async fn get_member_stats(
    roomId: String,
    uid: String,
    db: State<'_, Arc<Database>>,
) -> Result<Value, String> {
    db.room.get_member_stats(&roomId, &uid).await
}

// ── App updater (Phase 13) ───────────────────────────────────────

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "date": update.date.map(|d| d.to_string()),
            "body": update.body,
        }))
    } else {
        Ok(serde_json::json!({ "available": false }))
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(
                |_chunk_len, _content_len| {},
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}
