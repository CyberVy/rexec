use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method};
use serde::Deserialize;
use tauri::ipc::Response;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub base64_body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

#[tauri::command]
pub async fn fetch(_app: AppHandle, req: FetchRequest) -> Result<Response, String> {
    let client = Client::builder().build().map_err(|e| e.to_string())?;

    let method = req
        .method
        .parse::<Method>()
        .map_err(|_| format!("invalid method: {}", req.method))?;

    let mut headers = HeaderMap::new();
    for (k, v) in req.headers.iter() {
        let name = HeaderName::from_bytes(k.as_bytes())
            .map_err(|_| format!("invalid header name: {}", k))?;
        let value =
            HeaderValue::from_str(v).map_err(|_| format!("invalid header value for {}", k))?;
        headers.insert(name, value);
    }

    let mut request = client.request(method, &req.url).headers(headers.clone());

    if let Some(timeout) = req.timeout_ms {
        request = request.timeout(std::time::Duration::from_millis(timeout));
    }

    if let Some(b64) = req.base64_body {
        let bytes = STANDARD
            .decode(b64)
            .map_err(|_| "invalid base64 body".to_string())?;
        request = request.body(bytes);
    } else if let Some(body) = req.body {
        request = request.body(body);
    }

    let resp = request.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();

    let mut resp_headers = HashMap::new();
    for (name, value) in resp.headers().iter() {
        resp_headers.insert(name.to_string(), value.to_str().unwrap_or("").to_string());
    }

    let body_bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(&resp_headers).unwrap_or_else(|_| "{}".to_string());
    let headers_bytes = headers_json.as_bytes();
    let headers_len = headers_bytes.len() as u32;

    let mut payload = Vec::with_capacity(6 + headers_bytes.len() + body_bytes.len());
    payload.extend_from_slice(&status.to_be_bytes());
    payload.extend_from_slice(&headers_len.to_be_bytes());
    payload.extend_from_slice(headers_bytes);
    payload.extend_from_slice(&body_bytes);

    Ok(Response::new(payload))
}
