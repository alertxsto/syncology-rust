use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use thiserror::Error;
use crate::config::firebase::FirebaseConfig;

#[derive(Error, Debug)]
pub enum CloudFunctionError {
    #[error("[{code}] {message}")]
    ApiError { code: String, message: String },
    #[error("Request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("Parse error: {0}")]
    ParseError(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, CloudFunctionError>;

#[derive(Clone)]
pub struct CFCaller {
    pub config: FirebaseConfig,
    pub id_token: Arc<RwLock<String>>,
    client: Client,
}

impl CFCaller {
    pub fn new(config: FirebaseConfig, id_token: String) -> Self {
        Self {
            config,
            id_token: Arc::new(RwLock::new(id_token)),
            client: Client::new(),
        }
    }

    pub async fn set_token(&self, token: String) {
        let mut write = self.id_token.write().await;
        *write = token;
    }

    fn get_base_url(&self) -> String {
        let project_id = &self.config.project_id;
        if self.config.use_emulator {
            format!("http://localhost:5001/{}/us-central1", project_id)
        } else {
            format!("https://us-central1-{}.cloudfunctions.net", project_id)
        }
    }

    pub async fn call(&self, function_name: &str, data: Value) -> Result<Value> {
        let url = format!("{}/{}", self.get_base_url(), function_name);
        
        let mut req = self.client.request(Method::POST, url).header("Content-Type", "application/json");
        let token = self.id_token.read().await.clone();
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let body = json!({ "data": data });
        let resp = req.json(&body).send().await?;

        let status = resp.status();
        let text = resp.text().await?;

        let response_data: Value = serde_json::from_str(&text).map_err(|e| {
            CloudFunctionError::ApiError {
                code: "internal".to_string(),
                message: format!("Invalid JSON response: {}", text.chars().take(200).collect::<String>()),
            }
        })?;

        if let Some(err) = response_data.get("error").and_then(|e| e.as_object()) {
            let code = err.get("status").and_then(|s| s.as_str()).unwrap_or("unknown");
            let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown error");
            return Err(CloudFunctionError::ApiError {
                code: code.to_string(),
                message: msg.to_string(),
            });
        }

        if let Some(result) = response_data.get("result") {
            Ok(result.clone())
        } else {
            Ok(response_data)
        }
    }
}
