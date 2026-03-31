use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
  "required": ["entities"]
}"###;

const EXTRACTION_PROMPT: &str = "Extract all proper nouns (character names, locations, unique technology, organization names, spells/techniques) from the following Japanese text. Return only the raw Japanese terms as a JSON array of strings.";

const RECONCILE_SCHEMA: &str = r###"{
  "type": "object",
  "properties": {
    "en": { "type": "string", "description": "The official or best localization in the target language" },
    "notes": { "type": "string", "description": "Optional context or explanation for the term mapping" }
  },
  "required": ["en"]
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
        "required": ["path", "content"]
      }
    }
  },
  "required": ["files"]
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
          "notes": { "type": "string" }
        },
        "required": ["ja", "en"]
      }
    }
  },
  "required": ["translated_xhtml", "new_terms"]
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

// Google AI Studio (Gemini) API
// ---------------------------------------------------------------------------

/// Helper to call the Gemini 1.5 Flash API with JSON schema enforcement
async fn call_gemini(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_content: &str,
    schema_str: &str,
    devel_mode: bool,
) -> Result<String, AiError> {
    if api_key.is_empty() {
        return Err(AiError::ApiKeyMissing);
    }

    // Gemini API format
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}:generateContent?key={}",
        model, api_key
    );

    let schema_json: Value = serde_json::from_str(schema_str)?;

    let payload = json!({
        "systemInstruction": {
            "parts": [{ "text": system_prompt }]
        },
        "contents": [{
            "parts": [{ "text": user_content }]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
            "responseSchema": schema_json
        }
    });

    crate::devel_log(
        devel_mode,
        &format!(
            ">>> [Gemini API] Request JSON:\n{}",
            serde_json::to_string_pretty(&payload).unwrap_or_default()
        ),
    );

    let client = Client::new();

    let res = client.post(&url).json(&payload).send().await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    crate::devel_log(
        devel_mode,
        &format!("<<< [Gemini API] Response JSON:\n{}", text),
    );

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AiError::Api(
            "Quota Exceeded (429). Please wait before trying again.".into(),
        ));
    }

    if status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
        return Err(AiError::Api(
            "Gemini is currently overloaded (503). Spikes in demand are temporary. Please try again in a few moments.".into(),
        ));
    }

    if !status.is_success() {
        return Err(AiError::Api(format!("Gemini API failed: {}", text)));
    }

    let res_json: Value = serde_json::from_str(&text)?;

    // Extract text from the Gemini response tree
    let text = res_json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| AiError::Api("Invalid response structure from Gemini".into()))?;

    Ok(text.to_string())
}

/// Run entity extraction on a block of Japanese text
pub async fn extract_entities(
    api_key: &str,
    model: &str,
    chapter_text: &str,
    devel_mode: bool,
) -> Result<Vec<String>, AiError> {
    let response_text = call_gemini(
        api_key,
        model,
        EXTRACTION_PROMPT,
        chapter_text,
        EXTRACTION_SCHEMA,
        devel_mode,
    )
    .await?;

    #[derive(Deserialize)]
    struct ExtractionResult {
        entities: Vec<String>,
    }

    let parsed: ExtractionResult = serde_json::from_str(&response_text)?;
    Ok(parsed.entities)
}

/// Fetch available models using the Gemini API
pub async fn list_models(api_key: &str, devel_mode: bool) -> Result<Vec<String>, AiError> {
    if api_key.is_empty() {
        return Err(AiError::ApiKeyMissing);
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        api_key
    );

    crate::devel_log(
        devel_mode,
        &format!(">>> [Gemini API] ListModels GET: {}", url),
    );

    let client = Client::new();
    let res = client.get(&url).send().await?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    crate::devel_log(
        devel_mode,
        &format!("<<< [Gemini API] ListModels Response:\n{}", text),
    );

    if !status.is_success() {
        return Err(AiError::Api(format!("ListModels failed: {}", text)));
    }

    let res_json: Value = serde_json::from_str(&text)?;

    let mut model_names = Vec::new();
    if let Some(models) = res_json["models"].as_array() {
        for m in models {
            if let Some(name) = m["name"].as_str() {
                // Only include models that support generateContent
                if let Some(methods) = m["supportedGenerationMethods"].as_array() {
                    let supports_generate = methods
                        .iter()
                        .any(|m| m.as_str() == Some("generateContent"));
                    if supports_generate {
                        model_names.push(name.to_string());
                    }
                }
            }
        }
    }

    Ok(model_names)
}

pub async fn reconcile_term(
    api_key: &str,
    model: &str,
    term_ja: &str,
    wiki_context: &str,
    chapter_context: &str,
    target_language: &str,
    devel_mode: bool,
) -> Result<crate::glossary::Term, AiError> {
    let content = format!(
        "Japanese Term: {}\n\nChapter Context:\n{}\n\nWiki Context:\n{}",
        term_ja, chapter_context, wiki_context
    );

    let system_prompt = get_reconcile_prompt(target_language);

    let response_text = call_gemini(
        api_key,
        model,
        &system_prompt,
        &content,
        RECONCILE_SCHEMA,
        devel_mode,
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
    model: &str,
    files: Vec<crate::epub::LayoutFile>,
    devel_mode: bool,
) -> Result<Vec<crate::epub::LayoutFile>, AiError> {
    let mut content = String::new();
    for file in files {
        content.push_str(&format!(
            "--- FILE: {} ---\n{}\n\n",
            file.path, file.content
        ));
    }

    let response_text = call_gemini(
        api_key,
        model,
        LAYOUT_PROMPT,
        &content,
        LAYOUT_SCHEMA,
        devel_mode,
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
    model: &str,
    xhtml: &str,
    glossary: &[crate::glossary::Term],
    target_language: &str,
    devel_mode: bool,
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

    let response_text = call_gemini(
        api_key,
        model,
        &system_prompt,
        &user_content,
        TRANSLATION_SCHEMA,
        devel_mode,
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
