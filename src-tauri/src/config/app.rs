/// AppConfig — unified application configuration.
///
/// Membaca credentials dari `.env.local`:
///   - Firebase (untuk Auth/Google Sign-In)
///   - Supabase (untuk database PostgreSQL)
use dotenvy;
use std::env;

// ── Firebase Config (hanya untuk Auth) ──────────────────────────────────────

#[derive(Debug, Clone)]
pub struct FirebaseAuthConfig {
    pub api_key: String,
    pub auth_domain: String,
    pub project_id: String,
    pub use_emulator: bool,
}

// ── Supabase Config (untuk database) ────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SupabaseConfig {
    /// https://<project-ref>.supabase.co
    pub url: String,
    /// service_role key — digunakan oleh backend Rust (bypass RLS)
    pub service_key: String,
    /// anon/public key — digunakan sebagai apikey header
    pub anon_key: String,
}

// ── Unified AppConfig ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub firebase: FirebaseAuthConfig,
    pub supabase: SupabaseConfig,
}

impl AppConfig {
    pub fn load() -> Self {
        load_env();

        Self {
            firebase: FirebaseAuthConfig {
                api_key: env_var(&["VITE_FIREBASE_API_KEY", "FIREBASE_API_KEY"]),
                auth_domain: env_var(&["VITE_FIREBASE_AUTH_DOMAIN", "FIREBASE_AUTH_DOMAIN"]),
                project_id: env_var(&["VITE_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID"]),
                use_emulator: env_var(&["VITE_USE_EMULATOR", "USE_EMULATOR"])
                    .to_lowercase() == "true",
            },
            supabase: SupabaseConfig {
                url: env_var(&["SUPABASE_URL", "VITE_SUPABASE_URL"]),
                service_key: env_var(&["SUPABASE_SERVICE_KEY"]),
                anon_key: env_var(&["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]),
            },
        }
    }
}

fn load_env() {
    if let Ok(current_dir) = env::current_dir() {
        let env_path = current_dir.join(".env.local");
        if env_path.exists() {
            let _ = dotenvy::from_path_override(&env_path);
            return;
        }
    }
    if let Some(home_dir) = dirs::home_dir() {
        let home_env_path = home_dir.join(".env.local");
        if home_env_path.exists() {
            let _ = dotenvy::from_path_override(&home_env_path);
        }
    }
}

/// Coba baca environment variable dari daftar key (prioritas dari kiri).
fn env_var(keys: &[&str]) -> String {
    for key in keys {
        if let Ok(val) = env::var(key) {
            if !val.is_empty() {
                return val;
            }
        }
    }
    String::new()
}

// ── Backward compat: FirebaseConfig alias ────────────────────────────────────
// Dipertahankan agar services/auth.rs tidak perlu diubah besar-besaran.

#[derive(Debug, Clone)]
pub struct FirebaseConfig {
    pub api_key: String,
    pub auth_domain: String,
    pub project_id: String,
    pub storage_bucket: String,
    pub messaging_sender_id: String,
    pub app_id: String,
    pub oauth_client_id: String,
    pub use_emulator: bool,
}

impl FirebaseConfig {
    pub fn load() -> Self {
        load_env();
        Self {
            api_key: env_var(&["VITE_FIREBASE_API_KEY", "FIREBASE_API_KEY"]),
            auth_domain: env_var(&["VITE_FIREBASE_AUTH_DOMAIN", "FIREBASE_AUTH_DOMAIN"]),
            project_id: env_var(&["VITE_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID"]),
            storage_bucket: env_var(&["VITE_FIREBASE_STORAGE_BUCKET", "FIREBASE_STORAGE_BUCKET"]),
            messaging_sender_id: env_var(&["VITE_FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_MESSAGING_SENDER_ID"]),
            app_id: env_var(&["VITE_FIREBASE_APP_ID", "FIREBASE_APP_ID"]),
            oauth_client_id: env_var(&["VITE_GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]),
            use_emulator: env_var(&["VITE_USE_EMULATOR", "USE_EMULATOR"]).to_lowercase() == "true",
        }
    }

    pub fn identitytoolkit_url(&self) -> String {
        if self.use_emulator {
            "http://localhost:9099/identitytoolkit.googleapis.com/v1".to_string()
        } else {
            "https://identitytoolkit.googleapis.com/v1".to_string()
        }
    }

    pub fn securetoken_url(&self) -> String {
        if self.use_emulator {
            "http://localhost:9099/securetoken.googleapis.com/v1".to_string()
        } else {
            "https://securetoken.googleapis.com/v1".to_string()
        }
    }
}
