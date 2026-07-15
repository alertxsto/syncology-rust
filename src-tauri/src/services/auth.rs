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

const LOGIN_PAGE_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Syncology — Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #0a0a0f;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

/* Animated background orbs */
body::before {
  content: '';
  position: fixed;
  top: -30%;
  left: -10%;
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%);
  animation: orb1 8s ease-in-out infinite alternate;
  pointer-events: none;
}
body::after {
  content: '';
  position: fixed;
  bottom: -20%;
  right: -10%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
  animation: orb2 10s ease-in-out infinite alternate;
  pointer-events: none;
}

@keyframes orb1 { from { transform: translate(0,0) scale(1); } to { transform: translate(60px, 40px) scale(1.1); } }
@keyframes orb2 { from { transform: translate(0,0) scale(1); } to { transform: translate(-40px, -60px) scale(1.15); } }

/* Grid overlay */
.grid-bg {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
}

/* Card */
.card {
  position: relative;
  z-index: 10;
  background: rgba(255,255,255,0.04);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 24px;
  padding: 48px 44px;
  width: 400px;
  text-align: center;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04) inset,
    0 32px 80px rgba(0,0,0,0.6);
  animation: fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Logo */
.logo-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 28px;
}

.logo-icon {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
}

/* Animated SVG logo mark */
.logo-svg .ring {
  transform-origin: center;
  animation: spin-slow 12s linear infinite;
}
.logo-svg .ring2 {
  animation-direction: reverse;
  animation-duration: 9s;
}

@keyframes spin-slow { to { transform: rotate(360deg); } }

/* Title */
h1 {
  font-size: 26px;
  font-weight: 800;
  color: #f1f5f9;
  letter-spacing: -0.04em;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 13.5px;
  color: rgba(148,163,184,0.85);
  line-height: 1.6;
  margin-bottom: 36px;
  font-weight: 400;
}

/* Divider */
.divider {
  width: 40px;
  height: 2px;
  background: linear-gradient(90deg, #3b82f6, #6366f1);
  border-radius: 2px;
  margin: 0 auto 32px;
}

/* Google button */
#btnLogin {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  color: #e2e8f0;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  padding: 13px 20px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.15s, box-shadow 0.2s;
  letter-spacing: -0.01em;
}
#btnLogin:hover:not(:disabled) {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.2);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
#btnLogin:active:not(:disabled) { transform: translateY(0); }
#btnLogin:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Status */
.status {
  margin-top: 20px;
  font-size: 12.5px;
  color: rgba(148,163,184,0.7);
  min-height: 18px;
  transition: color 0.2s;
}
.error {
  color: #f87171 !important;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 8px;
  padding: 10px 14px;
  margin-top: 16px;
}
.success {
  color: #4ade80 !important;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.2);
  border-radius: 8px;
  padding: 10px 14px;
  margin-top: 16px;
}

/* Spinner for loading state */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Footer note */
.note {
  margin-top: 28px;
  font-size: 11px;
  color: rgba(100,116,139,0.7);
  line-height: 1.6;
}
.note a { color: rgba(148,163,184,0.6); text-decoration: none; }
</style>
</head>
<body>
<div class="grid-bg"></div>
<div class="card">
  <div class="logo-wrap">
    <!-- Syncology animated logo mark -->
    <svg class="logo-icon logo-svg" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="26" cy="26" r="24" stroke="rgba(255,255,255,0.06)" stroke-width="1.5"/>
      <!-- Outer ring -->
      <ellipse class="ring" cx="26" cy="26" rx="20" ry="9" stroke="url(#g1)" stroke-width="1.8" stroke-linecap="round"/>
      <!-- Inner ring rotated -->
      <ellipse class="ring ring2" cx="26" cy="26" rx="20" ry="9" stroke="url(#g2)" stroke-width="1.8" stroke-linecap="round" transform="rotate(60 26 26)"/>
      <!-- Third ring -->
      <ellipse class="ring" cx="26" cy="26" rx="20" ry="9" stroke="url(#g3)" stroke-width="1.4" stroke-linecap="round" transform="rotate(120 26 26)" style="animation-duration:15s"/>
      <!-- Center dot -->
      <circle cx="26" cy="26" r="3" fill="url(#g1)" opacity="0.8"/>
      <defs>
        <linearGradient id="g1" x1="6" y1="26" x2="46" y2="26" gradientUnits="userSpaceOnUse">
          <stop stop-color="#60a5fa"/>
          <stop offset="1" stop-color="#818cf8"/>
        </linearGradient>
        <linearGradient id="g2" x1="6" y1="26" x2="46" y2="26" gradientUnits="userSpaceOnUse">
          <stop stop-color="#38bdf8"/>
          <stop offset="1" stop-color="#6366f1"/>
        </linearGradient>
        <linearGradient id="g3" x1="6" y1="26" x2="46" y2="26" gradientUnits="userSpaceOnUse">
          <stop stop-color="#7dd3fc"/>
          <stop offset="1" stop-color="#a5b4fc"/>
        </linearGradient>
      </defs>
    </svg>
  </div>

  <h1>Syncology</h1>
  <p class="subtitle">Masuk dengan akun Google untuk terhubung<br>ke aplikasi desktop Syncology.</p>
  <div class="divider"></div>

  <button id="btnLogin" onclick="signIn()">
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
    Sign in with Google
  </button>

  <div id="status" class="status">Klik tombol di atas untuk login</div>

  <p class="note">
    Dengan masuk, kamu menyetujui penggunaan data<br>akun Google untuk autentikasi di aplikasi ini.
  </p>
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
        btn.innerHTML = '<span class="spinner"></span> Membuka popup...';
        status.className = 'status';
        status.textContent = '';
        
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
                  status.textContent = 'Login berhasil! Kamu bisa menutup tab ini.';
                  btn.innerHTML = '✓ Berhasil!';
                } else {
                  throw new Error('Gagal kirim token');
                }
              })
              .catch(function(err) {
                status.className = 'status error';
                status.textContent = 'Error: ' + err.message;
                btn.disabled = false;
                btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Coba Lagi';
              });
            });
          })
          .catch(function(err) {
            status.className = 'status error';
            status.textContent = 'Error: ' + err.message;
            btn.disabled = false;
            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Coba Lagi';
          });
      };
    })
    .catch(err => {
      document.getElementById('status').className = 'status error';
      document.getElementById('status').textContent = 'Error load config: ' + err.message;
    });
</script>
</body>
</html>"##;

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
