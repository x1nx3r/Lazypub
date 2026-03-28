# Lazypub: AI-Powered EPUB Localization Studio

## 1. Project Overview

A local-first desktop application built with **Tauri 2 + Rust**, designed specifically to localize Japanese `.epub` files (light novels, web novels) into English. The application leverages the **Google AI Studio API (Gemini)** to solve the two biggest hurdles in machine translation: terminology consistency and layout normalization.

## 2. Architecture

- **Frontend:** React + TypeScript + Vite, Monaco Editor, Epub.js
- **Backend:** Rust (Tauri IPC)
- **Key Crates:** `zip`, `reqwest`, `serde_json`, `quick-xml`
- **AI:** Google Gemini via structured JSON schema enforcement
- **Temp Storage:** EPUB is unpacked to `/tmp` (tmpfs) for zero-overhead I/O; never writes to the original file until final export.

## 3. Features & Status

### ✅ Phase 1: Foundation & EPUB I/O
- Unpack `.epub` into `/tmp` working directory
- Parse `content.opf` for spine, title, author, language
- Recursive file tree exposed to the sidebar
- Generic `read_file` / `save_file` IPC commands for any archive file
- Re-zip working directory back to an in-memory `Vec<u8>` buffer (no disk write)

### ✅ Phase 2: Pre-Flight Glossary Builder
- AI entity extraction from Japanese chapter text
- Rust-native MediaWiki/Fandom API crawler  
- AI reconciliation prompt merges extracted entities + wiki data → `glossary.json`
- Scratchpad sidebar to review/edit pending terms
- Term editor modal with approve/reject workflow
- Bulk Glossary Batch view

### ✅ Phase 3: Layout Normalization
- Reads all `.css` and `.opf` layout files
- Sends them in full to Gemini; receives complete, rewritten file contents back
- Saves rewritten files directly (no patching — full file replacement)
- Immediately rebuilds the Epub.js preview buffer after applying

### ✅ Phase 4: Epub.js Preview Engine
- Save-to-Preview workflow: clicking Save re-zips to memory and pipes `ArrayBuffer` to Epub.js
- Dedicated full-screen `Preview` tab with paginated rendering
- Next/Previous page navigation buttons
- Sidebar file clicks trigger lightweight `rendition.display()` navigation
- Supports Japanese vertical/RTL and Western LTR layouts correctly

### 🔲 Phase 5: The Translation Loop
- Core Translation Prompt: `[System] + [Glossary] + [Previous Context] + [Chapter]`
- Structured dual JSON output: `{ "translated_text": "...", "new_terms": [...] }`
- Newly proposed terms auto-populate Scratchpad as "Pending"

### 🔲 Phase 6: Export & Polish
- Overwrite XHTML files with translated English text
- Final export re-zip according to EPUB spec (mimetype uncompressed, placed first)
- Global error handling, rate limit retry logic, token usage warnings

## 4. Out of Scope (MVP)
- PDF / OCR translation
- Multi-user collaborative editing
- WYSIWYG visual editing (Monaco source editor is the editing surface)