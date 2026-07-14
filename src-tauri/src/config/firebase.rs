use dotenvy;
use std::env;

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
        // Coba load dari .env.local di project dir, lalu ~/.env.local
        if let Ok(current_dir) = env::current_dir() {
            let env_path = current_dir.join(".env.local");
            if env_path.exists() {
                let _ = dotenvy::from_path_override(&env_path);
            } else if let Some(home_dir) = dirs::home_dir() {
                let home_env_path = home_dir.join(".env.local");
                if home_env_path.exists() {
                    let _ = dotenvy::from_path_override(&home_env_path);
                }
            }
        }

        Self {
            api_key: Self::env("API_KEY", ""),
            auth_domain: Self::env("AUTH_DOMAIN", ""),
            project_id: Self::env("PROJECT_ID", ""),
            storage_bucket: Self::env("STORAGE_BUCKET", ""),
            messaging_sender_id: Self::env("MESSAGING_SENDER_ID", ""),
            app_id: Self::env("APP_ID", ""),
            oauth_client_id: Self::env("GOOGLE_OAUTH_CLIENT_ID", ""),
            use_emulator: Self::env("USE_EMULATOR", "false").to_lowercase() == "true",
        }
    }

    fn env(key: &str, default: &str) -> String {
        let with_prefix = format!("VITE_FIREBASE_{}", key);
        let without_prefix = format!("FIREBASE_{}", key);
        
        env::var(&with_prefix)
            .or_else(|_| env::var(&without_prefix))
            .or_else(|_| env::var(key))
            .unwrap_or_else(|_| {
                let val = match key {
                    "API_KEY" => option_env!("VITE_FIREBASE_API_KEY").or(option_env!("FIREBASE_API_KEY")).or(option_env!("API_KEY")),
                    "AUTH_DOMAIN" => option_env!("VITE_FIREBASE_AUTH_DOMAIN").or(option_env!("FIREBASE_AUTH_DOMAIN")).or(option_env!("AUTH_DOMAIN")),
                    "PROJECT_ID" => option_env!("VITE_FIREBASE_PROJECT_ID").or(option_env!("FIREBASE_PROJECT_ID")).or(option_env!("PROJECT_ID")),
                    "STORAGE_BUCKET" => option_env!("VITE_FIREBASE_STORAGE_BUCKET").or(option_env!("FIREBASE_STORAGE_BUCKET")).or(option_env!("STORAGE_BUCKET")),
                    "MESSAGING_SENDER_ID" => option_env!("VITE_FIREBASE_MESSAGING_SENDER_ID").or(option_env!("FIREBASE_MESSAGING_SENDER_ID")).or(option_env!("MESSAGING_SENDER_ID")),
                    "APP_ID" => option_env!("VITE_FIREBASE_APP_ID").or(option_env!("FIREBASE_APP_ID")).or(option_env!("APP_ID")),
                    "GOOGLE_OAUTH_CLIENT_ID" => option_env!("VITE_GOOGLE_OAUTH_CLIENT_ID").or(option_env!("GOOGLE_OAUTH_CLIENT_ID")),
                    "USE_EMULATOR" => option_env!("VITE_USE_EMULATOR").or(option_env!("USE_EMULATOR")),
                    _ => None,
                };
                val.unwrap_or(default).to_string()
            })
    }


    pub fn firestore_base_url(&self) -> String {
        if self.use_emulator {
            format!("http://localhost:8080/v1/projects/{}/databases/(default)/documents", self.project_id)
        } else {
            format!("https://firestore.googleapis.com/v1/projects/{}/databases/(default)/documents", self.project_id)
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
