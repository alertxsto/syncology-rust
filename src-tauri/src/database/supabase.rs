/// Supabase PostgreSQL REST client (via PostgREST).
///
/// Menggantikan `firestore.rs`. Menggunakan Supabase REST API (PostgREST)
/// dengan service role key — semua operasi trusted dari backend Rust.
///
/// Base URL format: https://<project-ref>.supabase.co/rest/v1
/// Auth headers:
///   - `apikey: <anon_key>`          (wajib untuk semua request)
///   - `Authorization: Bearer <service_key>` (untuk bypass RLS)
use reqwest::{Client, Method, RequestBuilder};
use serde_json::{Map, Value};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SupabaseError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("API error {status}: {message}")]
    ApiError { status: u16, message: String },
    #[error("Parse error: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("Not found")]
    NotFound,
}

pub type Result<T> = std::result::Result<T, SupabaseError>;

// ── Query builder ────────────────────────────────────────────────────────────

/// Sebuah query SELECT yang sedang dibangun secara fluent.
pub struct SelectQuery {
    client: Arc<reqwest::Client>,
    url: String,
    service_key: String,
    anon_key: String,
    filters: Vec<String>,
    order_col: Option<String>,
    order_asc: bool,
    limit_n: Option<usize>,
    columns: Option<String>,
}

impl SelectQuery {
    /// Filter: col = val (equality)
    pub fn eq(mut self, col: &str, val: &str) -> Self {
        self.filters.push(format!("{}=eq.{}", col, urlencoding(val)));
        self
    }

    /// Filter: col != val
    pub fn neq(mut self, col: &str, val: &str) -> Self {
        self.filters.push(format!("{}=neq.{}", col, urlencoding(val)));
        self
    }

    /// Filter: col IS NULL
    pub fn is_null(mut self, col: &str) -> Self {
        self.filters.push(format!("{}=is.null", col));
        self
    }

    /// Filter: col = true / false
    pub fn bool_eq(mut self, col: &str, val: bool) -> Self {
        self.filters.push(format!("{}=is.{}", col, val));
        self
    }

    /// Ordering
    pub fn order(mut self, col: &str, ascending: bool) -> Self {
        self.order_col = Some(col.to_string());
        self.order_asc = ascending;
        self
    }

    /// Limit
    pub fn limit(mut self, n: usize) -> Self {
        self.limit_n = Some(n);
        self
    }

    /// Select specific columns
    pub fn columns(mut self, cols: &[&str]) -> Self {
        self.columns = Some(cols.join(","));
        self
    }

    /// Execute query, return all matching rows.
    pub async fn execute(self) -> Result<Vec<Map<String, Value>>> {
        let mut url = self.url;
        let mut params: Vec<String> = self.filters;

        if let Some(ref col) = self.order_col {
            let dir = if self.order_asc { "asc" } else { "desc" };
            params.push(format!("order={}.{}", col, dir));
        }
        if let Some(n) = self.limit_n {
            params.push(format!("limit={}", n));
        }
        if let Some(ref cols) = self.columns {
            params.push(format!("select={}", cols));
        }

        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }

        let resp = reqwest::Client::new()
            .get(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .header("Accept", "application/json")
            .send()
            .await?;

        let status = resp.status();
        if status == 404 {
            return Ok(vec![]);
        }
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: text.chars().take(300).collect(),
            });
        }
        if text.is_empty() || text == "null" {
            return Ok(vec![]);
        }
        let rows: Vec<Map<String, Value>> = serde_json::from_str(&text)?;
        Ok(rows)
    }

    /// Execute and return at most one row.
    pub async fn execute_single(self) -> Result<Option<Map<String, Value>>> {
        let mut rows = self.limit(1).execute().await?;
        Ok(rows.pop())
    }
}

// ── Main Client ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SupabaseClient {
    pub supabase_url: String,
    pub base_url: String,
    pub service_key: String,
    pub anon_key: String,
    client: Arc<Client>,
}

impl SupabaseClient {
    pub fn new(supabase_url: &str, service_key: &str, anon_key: &str) -> Self {
        let raw_url = supabase_url.trim_end_matches('/').to_string();
        let base_url = format!("{}/rest/v1", raw_url);
        Self {
            supabase_url: raw_url,
            base_url,
            service_key: service_key.to_string(),
            anon_key: anon_key.to_string(),
            client: Arc::new(Client::new()),
        }
    }

    /// Buat request builder dengan auth headers.
    fn req(&self, method: Method, url: &str) -> RequestBuilder {
        self.client
            .request(method, url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .header("Content-Type", "application/json")
    }

    /// Mulai SELECT query builder untuk sebuah tabel.
    pub fn select(&self, table: &str) -> SelectQuery {
        SelectQuery {
            client: self.client.clone(),
            url: format!("{}/{}", self.base_url, table),
            service_key: self.service_key.clone(),
            anon_key: self.anon_key.clone(),
            filters: Vec::new(),
            order_col: None,
            order_asc: true,
            limit_n: None,
            columns: None,
        }
    }

    /// INSERT satu row, kembalikan row yang baru dibuat (termasuk id).
    pub async fn insert(&self, table: &str, data: &Map<String, Value>) -> Result<Map<String, Value>> {
        let url = format!("{}/{}?select=*", self.base_url, table);
        let resp = self.req(Method::POST, &url)
            .header("Prefer", "return=representation")
            .json(data)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("INSERT into {} failed: {}", table, text.chars().take(300).collect::<String>()),
            });
        }
        // Supabase returns array even for single insert
        let mut rows: Vec<Map<String, Value>> = serde_json::from_str(&text)?;
        rows.pop().ok_or(SupabaseError::NotFound)
    }

    /// UPDATE row by primary key (`id` column = UUID).
    pub async fn update_by_id(&self, table: &str, id: &str, data: &Map<String, Value>) -> Result<()> {
        let url = format!("{}/{}?id=eq.{}", self.base_url, table, id);
        let resp = self.req(Method::PATCH, &url)
            .json(data)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await?;
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("UPDATE {} id={} failed: {}", table, id, text.chars().take(300).collect::<String>()),
            });
        }
        Ok(())
    }

    /// UPDATE rows yang cocok filter `col = val`.
    pub async fn update_where(&self, table: &str, col: &str, val: &str, data: &Map<String, Value>) -> Result<()> {
        let url = format!("{}/{}?{}=eq.{}", self.base_url, table, col, urlencoding(val));
        let resp = self.req(Method::PATCH, &url)
            .json(data)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await?;
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("UPDATE {} where {}={} failed: {}", table, col, val, text.chars().take(300).collect::<String>()),
            });
        }
        Ok(())
    }

    /// UPSERT — insert atau update jika conflict pada `on_conflict` column.
    /// Digunakan untuk typing_indicators (PRIMARY KEY = room_id + uid).
    pub async fn upsert(&self, table: &str, data: &Map<String, Value>) -> Result<()> {
        let url = format!("{}/{}", self.base_url, table);
        let resp = self.req(Method::POST, &url)
            .header("Prefer", "resolution=merge-duplicates")
            .json(data)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await?;
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("UPSERT {} failed: {}", table, text.chars().take(300).collect::<String>()),
            });
        }
        Ok(())
    }

    /// DELETE row by id.
    pub async fn delete_by_id(&self, table: &str, id: &str) -> Result<()> {
        let url = format!("{}/{}?id=eq.{}", self.base_url, table, id);
        let resp = self.req(Method::DELETE, &url)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() && status.as_u16() != 404 {
            let text = resp.text().await?;
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("DELETE {} id={} failed: {}", table, id, text.chars().take(300).collect::<String>()),
            });
        }
        Ok(())
    }

    /// DELETE rows yang cocok filter `col = val`.
    pub async fn delete_where(&self, table: &str, col: &str, val: &str) -> Result<()> {
        let url = format!("{}/{}?{}=eq.{}", self.base_url, table, col, urlencoding(val));
        let resp = self.req(Method::DELETE, &url)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() && status.as_u16() != 404 {
            let text = resp.text().await?;
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("DELETE {} where {}={} failed: {}", table, col, val, text.chars().take(300).collect::<String>()),
            });
        }
        Ok(())
    }

    /// GET single row by id, return None jika tidak ditemukan.
    pub async fn get_by_id(&self, table: &str, id: &str) -> Result<Option<Map<String, Value>>> {
        self.select(table).eq("id", id).execute_single().await
    }

    // ── Storage ───────────────────────────────────────────────────────────────────

    pub fn storage_url(&self, bucket: &str, path: &str) -> String {
        format!("{}/storage/v1/object/{}/{}", self.supabase_url, bucket, path)
    }

    pub fn public_url(&self, bucket: &str, path: &str) -> String {
        format!("{}/storage/v1/object/public/{}/{}", self.supabase_url, bucket, path)
    }

    pub async fn upload_file(&self, bucket: &str, path: &str, data: Vec<u8>, content_type: &str) -> Result<String> {
        let url = self.storage_url(bucket, path);
        let resp = self.client
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.service_key))
            .header("Content-Type", content_type)
            .header("x-upsert", "true")
            .body(data)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(SupabaseError::ApiError {
                status: status.as_u16(),
                message: format!("Storage upload failed: {}", text.chars().take(300).collect::<String>()),
            });
        }
        Ok(self.public_url(bucket, path))
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────

/// Simple percent-encode untuk query param value.
fn urlencoding(s: &str) -> String {
    s.chars().map(|c| {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        }
    }).collect()
}
