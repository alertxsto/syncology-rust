use axum::{
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use std::net::SocketAddr;
use chrono::{DateTime, Duration, Utc};
use crate::models::auth::FirebaseUser;
use crate::config::firebase::FirebaseConfig;

const LOGIN_PAGE_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PUSync — Login</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
}
.card {
  background: white; border-radius: 16px; padding: 40px; width: 360px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2); text-align: center;
}
h1 { font-size: 24px; color: #333; margin-bottom: 8px; }
p { font-size: 14px; color: #888; margin-bottom: 24px; }
button {
  background: #1976d2; color: white; border: none; border-radius: 8px;
  padding: 14px 32px; font-size: 16px; font-weight: 600; cursor: pointer;
  width: 100%; transition: background 0.2s;
}
button:hover { background: #1565c0; }
button:disabled { background: #ccc; cursor: not-allowed; }
.status { margin-top: 16px; font-size: 13px; color: #666; }
.error { color: #d32f2f; }
.success { color: #2e7d32; }
</style>
</head>
<body>
<div class="card">
  <h1>PUSync</h1>
  <p>Login dengan Google untuk terhubung ke desktop app</p>
  <button id="btnLogin" onclick="signIn()">Sign in with Google</button>
  <div id="status" class="status">Klik tombol di atas untuk login</div>
</div>
<script src="https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/11.6.0/firebase-auth-compat.js"></script>
<script>
  window.signIn = function() {
    alert("Sedang memuat konfigurasi...");
  };

  fetch('/config')
    .then(r => r.json())
    .then(firebaseConfig => {
      if (!firebaseConfig.apiKey) {
        document.getElementById('status').className = 'status error';
        document.getElementById('status').textContent = 'Error: Konfigurasi Firebase tidak valid (API Key kosong). Harap periksa .env.local Anda.';
        window.signIn = function() {
          alert('Gagal: Konfigurasi Firebase kosong.');
        };
        return;
      }
      
      firebase.initializeApp(firebaseConfig);
      const auth = firebase.auth();
      const provider = new firebase.auth.GoogleAuthProvider();

      window.signIn = function() {
        const btn = document.getElementById('btnLogin');
        const status = document.getElementById('status');
        btn.disabled = true;
        status.className = 'status';
        status.textContent = 'Membuka popup login...';
        
        auth.signInWithPopup(provider)
          .then(function(result) {
            const user = result.user;
            user.getIdToken().then(function(idToken) {
              fetch('/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  idToken: idToken,
                  refreshToken: user.refreshToken,
                  uid: user.uid,
                  displayName: user.displayName,
                  email: user.email,
                  photoURL: user.photoURL,
                })
              })
              .then(function(resp) {
                if (resp.ok) {
                  status.className = 'status success';
                  status.textContent = 'Login berhasil! Silakan tutup tab ini.';
                  btn.textContent = 'Berhasil!';
                } else {
                  throw new Error('Gagal kirim token');
                }
              })
              .catch(function(err) {
                status.className = 'status error';
                status.textContent = 'Error: ' + err.message;
                btn.disabled = false;
                btn.textContent = 'Coba Lagi';
              });
            });
          })
          .catch(function(err) {
            status.className = 'status error';
            status.textContent = 'Error: ' + err.message;
            btn.disabled = false;
            btn.textContent = 'Coba Lagi';
          });
      };
    })
    .catch(err => {
      document.getElementById('status').className = 'status error';
      document.getElementById('status').textContent = 'Error load config: ' + err.message;
    });
</script>
</body>
</html>"#;

struct AppState {
    result: Arc<Mutex<Option<FirebaseUser>>>,
    notify: Arc<Notify>,
    config: FirebaseConfig,
}

pub struct FirebaseAuth {
    pub user: Arc<Mutex<Option<FirebaseUser>>>,
    /// When the current id_token expires (UTC). Refresh must happen before this.
    pub expires_at: Arc<Mutex<Option<DateTime<Utc>>>>,
    pub config: Arc<Mutex<Option<FirebaseConfig>>>,
}

impl FirebaseAuth {
    pub fn new() -> Self {
        Self {
            user: Arc::new(Mutex::new(None)),
            expires_at: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn sign_in_with_google(&self, config: FirebaseConfig) -> Result<FirebaseUser, String> {
        // Store config so we can refresh later
        *self.config.lock().await = Some(config.clone());

        let result = Arc::new(Mutex::new(None));
        let notify = Arc::new(Notify::new());

        let state = Arc::new(AppState {
            result: result.clone(),
            notify: notify.clone(),
            config,
        });

        let app = Router::new()
            .route("/", get(serve_html))
            .route("/login.html", get(serve_html))
            .route("/config", get(serve_config))
            .route("/token", post(receive_token))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:8484").await.map_err(|e| e.to_string())?;

        let server_task = tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[error] Axum server failed: {}", e);
            }
        });

        // Open browser
        let _ = open::that("http://localhost:8484/");

        // Wait for token
        let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(180));
        tokio::select! {
            _ = notify.notified() => {}
            _ = timeout => {
                server_task.abort();
                return Err("Login dibatalkan atau timeout.".to_string());
            }
        }

        server_task.abort();

        let mut lock = result.lock().await;
        if let Some(user) = lock.take() {
            // Set token expiry — Firebase ID tokens are valid for 1 hour
            *self.expires_at.lock().await = Some(Utc::now() + Duration::minutes(55));
            let mut my_user = self.user.lock().await;
            *my_user = Some(user.clone());
            Ok(user)
        } else {
            Err("Gagal mendapatkan token.".to_string())
        }
    }

    /// Refresh the Firebase ID token using the stored refresh_token.
    /// Returns the new id_token on success.
    pub async fn refresh_token(&self) -> Result<String, String> {
        let config = self.config.lock().await.clone()
            .ok_or_else(|| "No config stored.".to_string())?;
        let refresh_token = {
            let lock = self.user.lock().await;
            lock.as_ref()
                .map(|u| u.refresh_token.clone())
                .unwrap_or_default()
        };
        if refresh_token.is_empty() {
            return Err("No refresh_token stored. Must re-authenticate.".to_string());
        }

        let url = format!(
            "{}/token?key={}",
            config.securetoken_url(),
            config.api_key
        );
        let client = reqwest::Client::new();
        let resp = client.post(&url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(format!(
                "grant_type=refresh_token&refresh_token={}",
                refresh_token
            ))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Token refresh failed: {}", text));
        }

        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        let new_id_token = body.get("id_token").and_then(|v| v.as_str())
            .ok_or_else(|| "Missing id_token in refresh response.".to_string())?
            .to_string();
        let new_refresh_token = body.get("refresh_token").and_then(|v| v.as_str())
            .unwrap_or(&refresh_token)
            .to_string();
        let expires_in = body.get("expires_in").and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(3600);

        // Update stored user with new tokens
        let mut user_lock = self.user.lock().await;
        if let Some(u) = user_lock.as_mut() {
            u.id_token = new_id_token.clone();
            u.refresh_token = new_refresh_token;
        }
        drop(user_lock);

        // Update expiry
        *self.expires_at.lock().await = Some(Utc::now() + Duration::seconds(expires_in - 300)); // 5 min buffer

        Ok(new_id_token)
    }

    /// Check if token is close to expiry (within 5 minutes) and refresh if so.
    /// Returns the current valid id_token.
    pub async fn ensure_valid_token(&self) -> Result<String, String> {
        let expires_at = self.expires_at.lock().await.clone();
        let needs_refresh = match expires_at {
            None => true,
            Some(exp) => Utc::now() >= exp - Duration::minutes(5),
        };
        if needs_refresh {
            return self.refresh_token().await;
        }
        let lock = self.user.lock().await;
        lock.as_ref()
            .map(|u| u.id_token.clone())
            .ok_or_else(|| "Not authenticated.".to_string())
    }

    pub async fn sign_out(&self) {
        *self.user.lock().await = None;
        *self.expires_at.lock().await = None;
        *self.config.lock().await = None;
    }
}

async fn serve_html() -> impl IntoResponse {
    Html(LOGIN_PAGE_HTML)
}

async fn serve_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(serde_json::json!({
        "apiKey": state.config.api_key,
        "authDomain": state.config.auth_domain,
        "projectId": state.config.project_id,
    }))
}

async fn receive_token(
    State(state): State<Arc<AppState>>,
    Json(user): Json<FirebaseUser>,
) -> impl IntoResponse {
    let mut lock = state.result.lock().await;
    *lock = Some(user);
    state.notify.notify_one();
    (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
}
