use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::ipc::Channel;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AiError {
    #[error("API key not set")]
    ApiKeyMissing,
    #[error("Request error: {0}")]
    Request(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("API error: {0}")]
    Api(String),
}

impl Serialize for AiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ---------------------------------------------------------------------------
// Prompts & Schemas
// ---------------------------------------------------------------------------

const EXTRACTION_SCHEMA: &str = r###"{
  "type": "object",
  "properties": {
    "entities": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of extracted Japanese proper nouns, character names, techniques, and locations."
    }
  },
  "required": ["entities"],
  "additionalProperties": false
}"###;

const EXTRACTION_PROMPT: &str = "Extract all proper nouns (character names, locations, unique technology, organization names, spells/techniques) from the following Japanese text. Return only the raw Japanese terms as a JSON array of strings.";

const RECONCILE_SCHEMA: &str = r###"{
  "type": "object",
  "properties": {
    "en": { "type": "string", "description": "The official or best localization in the target language" },
    "notes": { "type": ["string", "null"], "description": "Optional context or explanation for the term mapping" }
  },
  "required": ["en", "notes"],
  "additionalProperties": false
}"###;

const RECONCILE_PROMPT: &str = "Given a Japanese proper noun, any provided MediaWiki article content (Wiki Context), AND the text of the chapter where the term was found (Chapter Context), extract the official {TARGET_LANG} localization or spelling for the term. 

CRITICAL:
1. PRIORITIZE the 'Chapter Context' over the 'Wiki Context' for the 'notes' field.
2. The 'notes' field MUST be written in {TARGET_LANG}. It should explain what the term means WITHIN THIS SPECIFIC STORY.
3. If the 'Wiki Context' contradicts the 'Chapter Context', follow the 'Chapter Context'.
4. If the 'Wiki Context' is empty or doesn't contain the term, use the 'Chapter Context' and your best judgment to translate/romanize the term into {TARGET_LANG}.
5. Provide a concise explanation for 'notes' in {TARGET_LANG} (e.g., 'Pedang sihir kuat milik X', 'Federasi antar planet').";

const LAYOUT_SCHEMA: &str = r###"{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"],
        "additionalProperties": false
      }
    }
  },
  "required": ["files"],
  "additionalProperties": false
}"###;

const LAYOUT_PROMPT: &str = "You are an expert EPUB layout formatter.
Given the following OPF and CSS files from a Japanese EPUB, output the complete, fully modified file contents for each file to normalize the layout to horizontal/LTR for Western reading.
Target things like:
- `writing-mode: vertical-rl` -> remove or change to horizontal-tb
- `page-progression-direction=\"rtl\"` -> `\"ltr\"`
- Any `-epub-writing-mode` or similar.
Return the complete, fully valid file content string for EACH file provided.";

const TRANSLATION_SCHEMA: &str = r###"{
  "type": "object",
  "properties": {
    "translated_xhtml": {
      "type": "string",
      "description": "The complete, fully translated XHTML file content."
    },
    "new_terms": {
      "type": "array",
      "description": "New proper nouns encountered during translation that are not in the glossary.",
      "items": {
        "type": "object",
        "properties": {
          "ja": { "type": "string" },
          "en": { "type": "string" },
          "notes": { "type": ["string", "null"] }
        },
        "required": ["ja", "en", "notes"],
        "additionalProperties": false
      }
    }
  },
  "required": ["translated_xhtml", "new_terms"],
  "additionalProperties": false
}"###;

const TRANSLATION_PROMPT: &str = "You are an expert Japanese-to-{TARGET_LANG} EPUB translator specializing in light novels and web novels.

You will be given an XHTML chapter file and a JSON glossary of approved terminology.

CRITICAL RULES:
1. ONLY translate text content nodes. NEVER modify, remove, add, or rearrange any XML/HTML tags, attributes, class names, id values, or namespaces.
2. The output `translated_xhtml` MUST be a complete, valid XHTML document with structure identical to the input.
3. Use the provided glossary for consistent terminology.
4. Extract any proper nouns (names, places, etc.) NOT in the glossary into `new_terms`. For each, provide: 'ja' (original), 'en' ({TARGET_LANG} translation), and 'notes' (description in {TARGET_LANG}). IF NO NEW TERMS ARE FOUND, RETURN AN EMPTY ARRAY [].
5. Maintain the author's tone and style. Do not add, remove, or summarize plot content.";

fn get_reconcile_prompt(target_lang: &str) -> String {
    let mut prompt = RECONCILE_PROMPT.replace("{TARGET_LANG}", target_lang);
    if target_lang.to_lowercase() == "indonesian" {
        prompt.push_str("\n\nKHUSUS UNTUK BAHASA INDONESIA: Gunakan istilah yang lazim digunakan dalam lokalisasi novel ringan (light novel) resmi. Jika ada istilah fantasi, cari padanan kata yang puitis atau keren namun tetap mudah dimengerti.");
    }
    prompt
}

fn get_translation_prompt(target_lang: &str) -> String {
    let mut prompt = TRANSLATION_PROMPT.replace("{TARGET_LANG}", target_lang);
    if target_lang.to_lowercase() == "indonesian" {
        prompt.push_str(r###"

INSTRUKSI KHUSUS GAYA BAHASA INDONESIA:
1. Gunakan gaya bahasa novel yang mengalir, ekspresif, dan tidak kaku.
2. Jangan ragu untuk lebih kreatif dengan pilihan kata (diksi) dan struktur kalimat agar terdengar alami dan emosional bagi pembaca Indonesia, selama makna intinya tetap kohesif dan tidak menyimpang.
3. Gunakan variasi sinonim yang kaya untuk menghindari repetisi yang membosankan.
4. Pastikan tingkat kesopanan (honorifik) tercermin dalam pilihan kata karakter (misal: penggunaan kata ganti orang yang tepat)."###);
    }
    prompt
}

// ---------------------------------------------------------------------------

// OpenAI-compatible Chat Completions API
// ---------------------------------------------------------------------------

/// Strip optional markdown code fences that some local backends wrap around JSON.
fn strip_json_fences(text: &str) -> String {
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Drop an optional language tag on the same line (e.g. ```json)
        let rest = rest.splitn(2, '\n').last().unwrap_or(rest);
        if let Some(inner) = rest.strip_suffix("```") {
            return inner.trim().to_string();
        }
    }
    trimmed.to_string()
}

/// Events streamed to the frontend while a request runs.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Reasoning { delta: String },
    Phase { phase: String },
}

/// Call any OpenAI-compatible /chat/completions endpoint with JSON schema enforcement.
/// The response is consumed as an SSE stream: long generations keep bytes flowing
/// (avoids proxy idle timeouts like Cloudflare 524), reasoning deltas are forwarded
/// live to the UI, and content deltas are assembled into the final text.
async fn call_llm(
    api_key: &str,
    base_url: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
    schema_str: &str,
    devel_mode: bool,
    reasoning_effort: &str,
    on_event: &Channel<StreamEvent>,
) -> Result<String, AiError> {
    if api_key.is_empty() {
        return Err(AiError::ApiKeyMissing);
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let schema_json: Value = serde_json::from_str(schema_str)?;

    // Many OpenAI-compatible backends (proxy gateways, local servers) silently
    // drop `response_format`. Embedding the schema in the prompt makes the model
    // comply regardless of whether the field is honored.
    let system_prompt = format!(
        "{system_prompt}\n\nOUTPUT FORMAT (STRICT): Respond with a single JSON object and nothing else. It must match exactly this schema:\n{schema_str}"
    );

    let mut payload = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_content }
        ],
        "temperature": 0.1,
        "stream": true,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "result",
                "strict": true,
                "schema": schema_json
            }
        }
    });

    // Only send reasoning_effort when set. Backends and models that do not
    // support it may reject unknown or invalid values.
    if !reasoning_effort.is_empty() {
        payload["reasoning_effort"] = json!(reasoning_effort);
    }

    crate::devel_log(
        devel_mode,
        &format!(
            ">>> [LLM API] POST {}\nRequest JSON:\n{}",
            url,
            serde_json::to_string_pretty(&payload).unwrap_or_default()
        ),
    );

    let client = Client::new();

    let mut res = match client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            crate::devel_log(
                devel_mode,
                &format!("!!! [LLM API] Request failed before response: {e}"),
            );
            return Err(AiError::Request(e));
        }
    };
    let status = res.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let text = res.text().await.unwrap_or_default();
        crate::devel_log(devel_mode, &format!("<<< [LLM API] Response JSON:\n{}", text));
        return Err(AiError::Api(
            "Quota Exceeded (429). Please wait before trying again.".into(),
        ));
    }

    if status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
        let text = res.text().await.unwrap_or_default();
        crate::devel_log(devel_mode, &format!("<<< [LLM API] Response JSON:\n{}", text));
        return Err(AiError::Api(
            "The provider is currently overloaded (503). Please try again in a few moments.".into(),
        ));
    }

    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        crate::devel_log(devel_mode, &format!("<<< [LLM API] Response JSON:\n{}", text));
        // Prefer the structured message from OpenAI-style error bodies.
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
            .unwrap_or_else(|| format!("LLM API failed: {}", text));
        return Err(AiError::Api(message));
    }

    // Success: consume the SSE stream. Reasoning deltas are forwarded to the
    // UI in ~100ms batches; content deltas are assembled into the final text.
    let mut content = String::new();
    let mut sse_buffer = String::new();
    let mut reasoning_buf = String::new();
    let mut last_flush = std::time::Instant::now();
    let mut writing_notified = false;

    loop {
        match res.chunk().await {
            Ok(Some(bytes)) => {
                sse_buffer.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(pos) = sse_buffer.find('\n') {
                    let line: String = sse_buffer.drain(..=pos).collect();
                    let line = line.trim();
                    let Some(data) = line.strip_prefix("data: ") else {
                        continue;
                    };
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                        let delta = &v["choices"][0]["delta"];
                        if let Some(t) = delta["reasoning_content"].as_str() {
                            reasoning_buf.push_str(t);
                        }
                        if let Some(t) = delta["content"].as_str() {
                            if !writing_notified {
                                writing_notified = true;
                                let _ = on_event.send(StreamEvent::Phase {
                                    phase: "writing".into(),
                                });
                            }
                            content.push_str(t);
                        }
                    }
                }
                if !reasoning_buf.is_empty() && last_flush.elapsed() >= Duration::from_millis(100) {
                    let _ = on_event.send(StreamEvent::Reasoning {
                        delta: std::mem::take(&mut reasoning_buf),
                    });
                    last_flush = std::time::Instant::now();
                }
            }
            Ok(None) => break,
            Err(e) => {
                crate::devel_log(
                    devel_mode,
                    &format!("!!! [LLM API] Stream interrupted: {e}"),
                );
                return Err(AiError::Request(e));
            }
        }
    }
    if !reasoning_buf.is_empty() {
        let _ = on_event.send(StreamEvent::Reasoning { delta: reasoning_buf });
    }

    crate::devel_log(
        devel_mode,
        &format!("<<< [LLM API] Streamed Response (assembled):\n{}", content),
    );

    if content.is_empty() {
        return Err(AiError::Api("Empty response from LLM API".into()));
    }

    Ok(strip_json_fences(&content))
}

/// Run entity extraction on a block of Japanese text
pub async fn extract_entities(
    api_key: &str,
    base_url: &str,
    model: &str,
    chapter_text: &str,
    devel_mode: bool,
    reasoning_effort: &str,
    on_event: &Channel<StreamEvent>,
) -> Result<Vec<String>, AiError> {
    let response_text = call_llm(
        api_key,
        base_url,
        model,
        EXTRACTION_PROMPT,
        chapter_text,
        EXTRACTION_SCHEMA,
        devel_mode,
        reasoning_effort,
        on_event,
    )
    .await?;

    #[derive(Deserialize)]
    struct ExtractionResult {
        entities: Vec<String>,
    }

    let parsed: ExtractionResult = serde_json::from_str(&response_text)?;
    Ok(parsed.entities)
}

/// Fetch available models from an OpenAI-compatible endpoint.
pub async fn list_models(
    api_key: &str,
    base_url: &str,
    devel_mode: bool,
) -> Result<Vec<String>, AiError> {
    if api_key.is_empty() {
        return Err(AiError::ApiKeyMissing);
    }

    let url = format!("{}/models", base_url.trim_end_matches('/'));

    crate::devel_log(
        devel_mode,
        &format!(">>> [LLM API] ListModels GET: {}", url),
    );

    let client = Client::new();
    let res = client.get(&url).bearer_auth(api_key).send().await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    crate::devel_log(
        devel_mode,
        &format!("<<< [LLM API] ListModels Response:\n{}", text),
    );

    if !status.is_success() {
        return Err(AiError::Api(format!("ListModels failed: {}", text)));
    }

    let res_json: Value = serde_json::from_str(&text)?;

    let mut model_names = Vec::new();
    if let Some(models) = res_json["data"].as_array() {
        for m in models {
            if let Some(id) = m["id"].as_str() {
                model_names.push(id.to_string());
            }
        }
    }
    model_names.sort();

    Ok(model_names)
}

pub async fn reconcile_term(
    api_key: &str,
    base_url: &str,
    model: &str,
    term_ja: &str,
    wiki_context: &str,
    chapter_context: &str,
    target_language: &str,
    devel_mode: bool,
    reasoning_effort: &str,
    on_event: &Channel<StreamEvent>,
) -> Result<crate::glossary::Term, AiError> {
    let content = format!(
        "Japanese Term: {}\n\nChapter Context:\n{}\n\nWiki Context:\n{}",
        term_ja, chapter_context, wiki_context
    );

    let system_prompt = get_reconcile_prompt(target_language);

    let response_text = call_llm(
        api_key,
        base_url,
        model,
        &system_prompt,
        &content,
        RECONCILE_SCHEMA,
        devel_mode,
        reasoning_effort,
        on_event,
    )
    .await?;

    #[derive(Deserialize)]
    struct ReconcileResult {
        en: String,
        notes: Option<String>,
    }

    let parsed: ReconcileResult = serde_json::from_str(&response_text)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros();

    Ok(crate::glossary::Term {
        id: format!("term_{}", timestamp),
        ja: term_ja.to_string(),
        en: parsed.en,
        notes: parsed.notes,
        status: crate::glossary::TermStatus::Pending,
    })
}

pub async fn normalize_layout_files(
    api_key: &str,
    base_url: &str,
    model: &str,
    files: Vec<crate::epub::LayoutFile>,
    devel_mode: bool,
    reasoning_effort: &str,
    on_event: &Channel<StreamEvent>,
) -> Result<Vec<crate::epub::LayoutFile>, AiError> {
    let mut content = String::new();
    for file in files {
        content.push_str(&format!(
            "--- FILE: {} ---\n{}\n\n",
            file.path, file.content
        ));
    }

    let response_text = call_llm(
        api_key,
        base_url,
        model,
        LAYOUT_PROMPT,
        &content,
        LAYOUT_SCHEMA,
        devel_mode,
        reasoning_effort,
        on_event,
    )
    .await?;

    #[derive(Deserialize)]
    struct LayoutResult {
        files: Vec<crate::epub::LayoutFile>,
    }

    let mut parsed: LayoutResult = serde_json::from_str(&response_text)?;
    // Post-process to beautify XHTML/XML/OPF but skip CSS
    for file in &mut parsed.files {
        let p = file.path.to_lowercase();
        if p.ends_with(".xhtml")
            || p.ends_with(".opf")
            || p.ends_with(".xml")
            || p.ends_with(".html")
        {
            file.content = crate::epub::beautify_xhtml(&file.content);
        }
    }
    Ok(parsed.files)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewTerm {
    pub ja: String,
    pub en: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranslationResult {
    pub translated_xhtml: String,
    pub new_terms: Vec<NewTerm>,
    #[serde(default)]
    pub errors: Vec<String>,
}

pub async fn translate_chapter(
    api_key: &str,
    base_url: &str,
    model: &str,
    xhtml: &str,
    glossary: &[crate::glossary::Term],
    target_language: &str,
    devel_mode: bool,
    reasoning_effort: &str,
    on_event: &Channel<StreamEvent>,
) -> Result<TranslationResult, AiError> {
    // Serialize only approved terms to keep tokens minimal
    let glossary_json: serde_json::Value = glossary
        .iter()
        .filter(|t| matches!(t.status, crate::glossary::TermStatus::Approved))
        .map(|t| {
            json!({
                "ja": t.ja,
                "en": t.en,
                "notes": t.notes
            })
        })
        .collect::<Vec<_>>()
        .into();

    let user_content = format!(
        "GLOSSARY:\n{}\n\n--- CHAPTER XHTML ---\n{}",
        serde_json::to_string_pretty(&glossary_json).unwrap_or_default(),
        xhtml
    );

    let system_prompt = get_translation_prompt(target_language);

    let response_text = call_llm(
        api_key,
        base_url,
        model,
        &system_prompt,
        &user_content,
        TRANSLATION_SCHEMA,
        devel_mode,
        reasoning_effort,
        on_event,
    )
    .await?;

    let mut parsed: TranslationResult = serde_json::from_str(&response_text)?;

    // 1. Initial Validation
    let mut errors = crate::epub::validate_xhtml(&parsed.translated_xhtml);

    // 2. Attempt Auto-fix if errors exist
    if !errors.is_empty() {
        crate::devel_log(
            devel_mode,
            &format!(
                "!!! [AI] XHTML Validation Failed. Attempting Auto-fix. Errors: {:?}",
                errors
            ),
        );
        let fixed = crate::epub::auto_fix_xhtml(&parsed.translated_xhtml);
        let new_errors = crate::epub::validate_xhtml(&fixed);

        if new_errors.len() < errors.len() || new_errors.is_empty() {
            parsed.translated_xhtml = fixed;
            errors = new_errors;
        }
    }

    // 3. Final Cleanup: Strip ruby (AI often flips languages while keeping tags) and Beautify
    let cleaned = crate::epub::strip_ruby(&parsed.translated_xhtml);
    parsed.translated_xhtml = crate::epub::beautify_xhtml(&cleaned);
    parsed.errors = errors;

    Ok(parsed)
}
