pub mod commands;
pub mod config;
pub mod database;
pub mod models;
pub mod services;
pub mod utils;

use std::sync::Arc;
use crate::database::manager::Database;
use crate::services::auth::FirebaseAuth;
use crate::config::firebase::FirebaseConfig;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = FirebaseConfig::load();
    let auth = Arc::new(FirebaseAuth::new());
    let db = Arc::new(Database::new(config, auth));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::api::sign_in_with_google,
            commands::api::sign_out,
            // Rooms
            commands::api::create_room,
            commands::api::join_room,
            commands::api::list_my_rooms,
            // Tasks
            commands::api::get_tasks,
            commands::api::add_task,
            commands::api::update_task,
            commands::api::delete_task,
            commands::api::get_members,
            commands::api::call_function,
            // Chat
            commands::api::send_room_message,
            commands::api::get_room_messages,
            commands::api::edit_room_message,
            commands::api::add_message_reaction,
            // Nudges
            commands::api::get_nudges,
            commands::api::mark_nudge_read,
            commands::api::mark_all_nudges_read,
            // Activity log
            commands::api::get_events,
            // Task comments (Phase 5)
            commands::api::get_task_comments,
            commands::api::add_task_comment,
            commands::api::delete_task_comment,
            // Typing (Phase 9)
            commands::api::set_typing,
            commands::api::get_typing,
            // Task dependencies (Phase 7)
            commands::api::set_task_blocked_by,
            // Member stats (Phase 12)
            commands::api::get_member_stats,
            // App updater (Phase 13)
            commands::api::check_for_update,
            commands::api::install_update,
            // Real-time watcher (Phase 4)
            commands::api::start_room_watcher,
            commands::api::stop_room_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
