mod ai;
mod epub;
mod glossary;
mod wiki;

use epub::EpubProject;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs::OpenOptions;
use std::io::Write;

pub(crate) fn devel_log(devel_mode: bool, msg: &str) {
    if !devel_mode {
        return;
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("lazypub-devel.log")
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let _ = writeln!(file, "[{}] {}", ts, msg);
    }
}

// ---------------------------------------------------------------------------
// App State
// ---------------------------------------------------------------------------

/// Holds the currently opened EPUB project.
pub struct AppState {
    pub project: Mutex<Option<EpubProject>>,
}

/// Serializable manifest info returned to the frontend.
#[derive(Serialize)]
pub struct OpenResult {
    pub title: String,
    pub author: String,
    pub language: String,
    pub spine: Vec<epub::SpineItem>,
    pub file_tree: Vec<epub::FileNode>,
    pub opf_dir: String,
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

fn generate_open_result(project: &epub::EpubProject) -> OpenResult {
    let mut spine_map = std::collections::HashMap::new();
    for item in &project.manifest.spine {
        if let Some(manifest_item) = project.manifest.items.get(&item.idref) {
            let zip_path = if project.manifest.opf_dir.is_empty() {
                manifest_item.href.clone()
            } else {
                format!("{}/{}", project.manifest.opf_dir, manifest_item.href)
            };
            spine_map.insert(zip_path, item.index);
        }
    }

    let file_tree = epub::build_file_tree(&project.root_path, &project.root_path, &spine_map)
        .unwrap_or_default();

    OpenResult {
        title: project.manifest.title.clone(),
        author: project.manifest.author.clone(),
        language: project.manifest.language.clone(),
        spine: project.manifest.spine.clone(),
        file_tree,
        opf_dir: project.manifest.opf_dir.clone(),
    }
}

/// Import an EPUB file into a persistent directory.
#[tauri::command]
fn import_epub(
    path: String,
    output_dir: String,
    state: State<AppState>,
) -> Result<OpenResult, String> {
    let epub_path = PathBuf::from(&path);
    let out_path = PathBuf::from(&output_dir);

    let project = epub::import_epub(&epub_path, &out_path).map_err(|e| e.to_string())?;

    let result = generate_open_result(&project);

    let mut state_project = state.project.lock().map_err(|e| e.to_string())?;
    *state_project = Some(project);

    Ok(result)
}

/// Load an existing EPUB project from a persistent directory.
#[tauri::command]
fn load_project(project_dir: String, state: State<AppState>) -> Result<OpenResult, String> {
    let dir_path = PathBuf::from(&project_dir);

    let project = epub::load_project(&dir_path).map_err(|e| e.to_string())?;

    let result = generate_open_result(&project);

    let mut state_project = state.project.lock().map_err(|e| e.to_string())?;
    *state_project = Some(project);

    Ok(result)
}

/// Return the chapter list (spine) of the currently opened EPUB.
#[tauri::command]
fn list_chapters(state: State<AppState>) -> Result<Vec<epub::SpineItem>, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    Ok(project.manifest.spine.clone())
}

/// Read the XHTML content of a chapter by its spine index.
#[tauri::command]
fn read_chapter(spine_index: usize, state: State<AppState>) -> Result<String, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::read_chapter(project, spine_index).map_err(|e| e.to_string())
}

/// Read generic file content by path relative to EPUB root
#[tauri::command]
fn read_file(path: String, state: State<AppState>) -> Result<String, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::read_file(project, &path).map_err(|e| e.to_string())
}

/// Write modified XHTML content back to a chapter file.
#[tauri::command]
fn save_chapter(spine_index: usize, content: String, state: State<AppState>) -> Result<(), String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::save_chapter(project, spine_index, &content).map_err(|e| e.to_string())
}

/// Save generic file content by path relative to EPUB root
#[tauri::command]
fn save_file(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::save_file(project, &path, &content).map_err(|e| e.to_string())
}

/// Read any resource file from the EPUB as a base64 data URI.
/// `relative_path` is relative to the currently open chapter file.
#[tauri::command]
fn read_resource(
    active_file: String,
    relative_path: String,
    state: State<AppState>,
) -> Result<String, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    let file_full_path = project.root_path.join(&active_file);
    let file_dir = file_full_path.parent().unwrap_or(&project.root_path);

    let resource_path = if relative_path.is_empty() {
        file_full_path
    } else {
        file_dir.join(&relative_path)
    };

    let bytes = std::fs::read(&resource_path).map_err(|e| {
        format!(
            "Failed to read resource '{}' at {:?}: {}",
            relative_path, resource_path, e
        )
    })?;

    // Determine MIME type from extension
    let mime = match resource_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("css") => "text/css",
        Some("js") => "application/javascript",
        Some("otf") => "font/otf",
        Some("ttf") => "font/ttf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };

    let encoded = BASE64.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
fn beautify_xhtml(content: String) -> String {
    epub::beautify_xhtml(&content)
}

#[tauri::command]
fn get_epub_buffer(state: State<AppState>) -> Result<Vec<u8>, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::repackage_to_buffer(project).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_epub(output_path: String, state: State<AppState>) -> Result<(), String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::repackage_epub(project, std::path::Path::new(&output_path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_asset(path: String, dest: String, state: State<AppState>) -> Result<(), String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    let src = project.root_path.join(&path);
    if !src.exists() {
        return Err(format!("Source asset not found: {}", path));
    }

    std::fs::copy(&src, &dest).map_err(|e| format!("Failed to copy asset: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 2: Glossary Builder Commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn run_entity_extraction(
    api_key: String,
    model: String,
    text: String,
    devel_mode: bool,
) -> Result<Vec<String>, String> {
    ai::extract_entities(&api_key, &model, &text, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_ai_models(api_key: String, devel_mode: bool) -> Result<Vec<String>, String> {
    ai::list_models(&api_key, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_wiki(
    wiki_url: String,
    query: String,
    devel_mode: bool,
) -> Result<Vec<String>, String> {
    wiki::query_wiki_search(&wiki_url, &query, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_wiki_page(
    wiki_url: String,
    title: String,
    devel_mode: bool,
) -> Result<String, String> {
    wiki::scrape_wiki_page(&wiki_url, &title, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reconcile_term(
    api_key: String,
    model: String,
    wiki_url: String,
    entity: String,
    devel_mode: bool,
) -> Result<glossary::Term, String> {
    let mut wiki_context = String::new();

    // 1. Attempt to search wiki for the term
    if let Ok(results) = wiki::query_wiki_search(&wiki_url, &entity, devel_mode).await {
        if let Some(first_title) = results.first() {
            // 2. Fetch the top matched article
            if let Ok(content) = wiki::scrape_wiki_page(&wiki_url, first_title, devel_mode).await {
                // Truncate wiki content to ~15000 characters to prevent token limits on large pages
                wiki_context = content.chars().take(15000).collect();
            }
        }
    }

    // 3. Prompt Gemini to extract the localized term
    ai::reconcile_term(&api_key, &model, &entity, &wiki_context, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_glossary(state: State<AppState>) -> Result<glossary::Glossary, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    glossary::load_glossary(&project.root_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_glossary(glossary: glossary::Glossary, state: State<AppState>) -> Result<(), String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    glossary::save_glossary(&project.root_path, &glossary).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_layout_files(state: State<AppState>) -> Result<Vec<epub::LayoutFile>, String> {
    let project = state.project.lock().map_err(|e| e.to_string())?;
    let project = project
        .as_ref()
        .ok_or_else(|| "No EPUB currently open".to_string())?;

    epub::get_layout_files(project).map_err(|e| e.to_string())
}

#[tauri::command]
async fn normalize_layout_files(
    api_key: String,
    model: String,
    files: Vec<epub::LayoutFile>,
    devel_mode: bool,
) -> Result<Vec<epub::LayoutFile>, String> {
    ai::normalize_layout_files(&api_key, &model, files, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Phase 5: Translation Loop
// ---------------------------------------------------------------------------

#[tauri::command]
async fn translate_chapter(
    api_key: String,
    model: String,
    path: String,
    devel_mode: bool,
    state: State<'_, AppState>,
) -> Result<ai::TranslationResult, String> {
    let (xhtml, glossary) = {
        let project = state.project.lock().map_err(|e| e.to_string())?;
        let project = project
            .as_ref()
            .ok_or_else(|| "No EPUB currently open".to_string())?;
        let xhtml = epub::read_file(project, &path).map_err(|e| e.to_string())?;
        let glossary = glossary::load_glossary(&project.root_path).map_err(|e| e.to_string())?;
        (xhtml, glossary)
    };

    ai::translate_chapter(&api_key, &model, &xhtml, &glossary, devel_mode)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState {
            project: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            import_epub,
            load_project,
            list_chapters,
            read_chapter,
            save_chapter,
            read_file,
            save_file,
            read_resource,
            run_entity_extraction,
            list_ai_models,
            search_wiki,
            fetch_wiki_page,
            reconcile_term,
            get_glossary,
            update_glossary,
            get_layout_files,
            normalize_layout_files,
            get_epub_buffer,
            translate_chapter,
            export_epub,
            beautify_xhtml,
            save_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
