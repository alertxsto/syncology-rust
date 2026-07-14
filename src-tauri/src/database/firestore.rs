use reqwest::{Client, Method, RequestBuilder};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use thiserror::Error;
use crate::config::firebase::FirebaseConfig;

#[derive(Error, Debug)]
pub enum FirestoreError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("API error: {status} - {message}")]
    ApiError { status: u16, message: String },
    #[error("Parse error: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("Not found")]
    NotFound,
}

pub type Result<T> = std::result::Result<T, FirestoreError>;

fn encode_value(val: &Value) -> Value {
    match val {
        Value::Null => json!({"nullValue": null}),
        Value::Bool(b) => json!({"booleanValue": b}),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                json!({"integerValue": i.to_string()})
            } else if let Some(f) = n.as_f64() {
                json!({"doubleValue": f})
            } else {
                json!({"nullValue": null})
            }
        }
        Value::String(s) => json!({"stringValue": s}),
        Value::Array(arr) => {
            let values: Vec<Value> = arr.iter().map(encode_value).collect();
            json!({"arrayValue": { "values": values }})
        }
        Value::Object(obj) => {
            json!({"mapValue": { "fields": encode_fields(obj) }})
        }
    }
}

fn decode_value(val: &Value) -> Value {
    if val.is_null() {
        return Value::Null;
    }
    let obj = match val.as_object() {
        Some(o) => o,
        None => return val.clone(),
    };

    if let Some(v) = obj.get("nullValue") { return Value::Null; }
    if let Some(v) = obj.get("booleanValue") { return v.clone(); }
    if let Some(v) = obj.get("integerValue") {
        if let Some(s) = v.as_str() {
            if let Ok(i) = s.parse::<i64>() {
                return json!(i);
            }
        }
    }
    if let Some(v) = obj.get("doubleValue") { return v.clone(); }
    if let Some(v) = obj.get("timestampValue") { return v.clone(); }
    if let Some(v) = obj.get("stringValue") { return v.clone(); }
    if let Some(v) = obj.get("mapValue") {
        if let Some(fields) = v.get("fields").and_then(|f| f.as_object()) {
            return Value::Object(decode_fields(fields));
        }
    }
    if let Some(v) = obj.get("arrayValue") {
        if let Some(values) = v.get("values").and_then(|a| a.as_array()) {
            let decoded: Vec<Value> = values.iter().map(decode_value).collect();
            return Value::Array(decoded);
        } else {
            return Value::Array(vec![]);
        }
    }
    val.clone()
}

pub fn decode_fields(fields: &Map<String, Value>) -> Map<String, Value> {
    let mut map = Map::new();
    for (k, v) in fields {
        map.insert(k.clone(), decode_value(v));
    }
    map
}

pub fn encode_fields(data: &Map<String, Value>) -> Map<String, Value> {
    let mut map = Map::new();
    for (k, v) in data {
        if !v.is_null() {
            map.insert(k.clone(), encode_value(v));
        }
    }
    map
}

#[derive(Clone)]
pub struct FirestoreClient {
    pub config: FirebaseConfig,
    pub id_token: Arc<RwLock<String>>,
    client: Client,
}

impl FirestoreClient {
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

    async fn full_url(&self, path: &str) -> String {
        let base = self.config.firestore_base_url();
        let mut url = format!("{}/{}?key={}", base, path, self.config.api_key);
        let token = self.id_token.read().await.clone();
        if !token.is_empty() {
            url.push_str(&format!("&access_token={}", token));
        }
        url
    }

    async fn build_req(&self, method: Method, path: &str) -> RequestBuilder {
        let url = self.full_url(path).await;
        let mut req = self.client.request(method, url).header("Content-Type", "application/json");
        let token = self.id_token.read().await.clone();
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        req
    }

    async fn handle_response(&self, resp: reqwest::Response, op: &str) -> Result<Value> {
        let status = resp.status();
        if status == 404 {
            return Err(FirestoreError::NotFound);
        }
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(FirestoreError::ApiError {
                status: status.as_u16(),
                message: format!("{} failed: {}", op, text.chars().take(200).collect::<String>()),
            });
        }
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn get(&self, path: &str) -> Result<Option<Map<String, Value>>> {
        let req = self.build_req(Method::GET, path).await;
        let resp = req.send().await?;
        match self.handle_response(resp, "GET").await {
            Ok(val) => {
                if let Some(fields) = val.get("fields").and_then(|f| f.as_object()) {
                    Ok(Some(decode_fields(fields)))
                } else {
                    Ok(val.as_object().cloned())
                }
            }
            Err(FirestoreError::NotFound) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn list(&self, path: &str) -> Result<Vec<Map<String, Value>>> {
        let req = self.build_req(Method::GET, path).await;
        let resp = req.send().await?;
        match self.handle_response(resp, "LIST").await {
            Ok(data) => {
                let mut results = Vec::new();
                if let Some(docs) = data.get("documents").and_then(|d| d.as_array()) {
                    for doc in docs {
                        let mut fields = if let Some(f) = doc.get("fields").and_then(|f| f.as_object()) {
                            decode_fields(f)
                        } else {
                            Map::new()
                        };
                        let name = doc.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        let doc_id = name.split('/').last().unwrap_or("");
                        fields.insert("id".to_string(), json!(doc_id));
                        fields.insert("_doc_name".to_string(), json!(name));
                        if let Some(ct) = doc.get("createTime") {
                            fields.insert("_create_time".to_string(), ct.clone());
                        }
                        if let Some(ut) = doc.get("updateTime") {
                            fields.insert("_update_time".to_string(), ut.clone());
                        }
                        results.push(fields);
                    }
                }
                Ok(results)
            }
            Err(FirestoreError::NotFound) => Ok(vec![]),
            Err(e) => Err(e),
        }
    }

    pub async fn add(&self, path: &str, data: &Map<String, Value>) -> Result<Map<String, Value>> {
        let req = self.build_req(Method::POST, path).await;
        let body = json!({ "fields": encode_fields(data) });
        let resp = req.json(&body).send().await?;
        let result = self.handle_response(resp, "ADD").await?;
        
        let mut fields = if let Some(f) = result.get("fields").and_then(|f| f.as_object()) {
            decode_fields(f)
        } else {
            Map::new()
        };
        let doc_id = result.get("name").and_then(|n| n.as_str()).unwrap_or("").split('/').last().unwrap_or("");
        fields.insert("id".to_string(), json!(doc_id));
        Ok(fields)
    }

    pub async fn update(&self, path: &str, data: &Map<String, Value>) -> Result<()> {
        let mut url = self.full_url(path).await;
        if !data.is_empty() {
            let paths: Vec<String> = data.keys().map(|k| format!("updateMask.fieldPaths={}", k)).collect();
            url = format!("{}&{}", url, paths.join("&"));
        }
        
        let mut req = self.client.request(Method::PATCH, url).header("Content-Type", "application/json");
        let token = self.id_token.read().await.clone();
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        
        let body = json!({ "fields": encode_fields(data) });
        let resp = req.json(&body).send().await?;
        self.handle_response(resp, "UPDATE").await?;
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        let req = self.build_req(Method::DELETE, path).await;
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() && status != 404 {
            let text = resp.text().await?;
            return Err(FirestoreError::ApiError {
                status: status.as_u16(),
                message: format!("DELETE failed: {}", text.chars().take(200).collect::<String>()),
            });
        }
        Ok(())
    }

    pub async fn query(&self, path: &str, field: &str, op: &str, value: &Value) -> Result<Vec<Map<String, Value>>> {
        let parts: Vec<&str> = path.split('/').collect();
        let collection_id = parts.last().unwrap_or(&"");
        let parent_path = parts[..parts.len().saturating_sub(1)].join("/");

        let base = self.config.firestore_base_url();
        let mut url = if !parent_path.is_empty() {
            format!("{}/{}:runQuery?key={}", base, parent_path, self.config.api_key)
        } else {
            format!("{}:runQuery?key={}", base, self.config.api_key)
        };
        let token = self.id_token.read().await.clone();
        if !token.is_empty() {
            url.push_str(&format!("&access_token={}", token));
        }

        let body = json!({
            "structuredQuery": {
                "from": [{"collectionId": collection_id}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": field},
                        "op": op,
                        "value": encode_value(value),
                    }
                }
            }
        });

        let mut req = self.client.request(Method::POST, url).header("Content-Type", "application/json");
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let resp = req.json(&body).send().await?;
        let result = self.handle_response(resp, "QUERY").await?;
        
        let mut results = Vec::new();
        if let Some(items) = result.as_array() {
            for item in items {
                if let Some(doc) = item.get("document") {
                    let mut fields = if let Some(f) = doc.get("fields").and_then(|f| f.as_object()) {
                        decode_fields(f)
                    } else {
                        Map::new()
                    };
                    let doc_id = doc.get("name").and_then(|n| n.as_str()).unwrap_or("").split('/').last().unwrap_or("");
                    fields.insert("id".to_string(), json!(doc_id));
                    results.push(fields);
                }
            }
        }
        Ok(results)
    }
}
