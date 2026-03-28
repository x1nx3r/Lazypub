import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { Preview } from "./components/Preview";
import { SettingsModal } from "./components/SettingsModal";
import { Scratchpad } from "./components/Scratchpad";
import { TermEditorModal } from "./components/TermEditorModal";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { OpenResult, Term, FileNode, LayoutFile, TranslationResult } from "./types";
import { load } from "@tauri-apps/plugin-store";
import "./App.css";

type ViewMode = "editor" | "preview";

const appWindow = getCurrentWindow();

function App() {
  // --- State ---
  const [bookInfo, setBookInfo] = useState<OpenResult | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [chapterContent, setChapterContent] = useState<string>("");
  const [epubBuffer, setEpubBuffer] = useState<ArrayBuffer | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  // --- Window controls ---
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  // --- Handlers ---
  const handleOpenEpub = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "EPUB Files", extensions: ["epub"] }],
      });

      if (!selected) return;

      setIsLoading(true);
      setLoadingMessage("📂 Opening EPUB...");
      const result = await invoke<OpenResult>("open_epub", {
        path: selected,
      });

      setBookInfo(result);
      setFileTree(result.file_tree);
      setActiveFile(null);
      setChapterContent("");
      setEditorDirty(false);
      
      const buffer = await invoke<number[]>("get_epub_buffer");
      setEpubBuffer(new Uint8Array(buffer).buffer);
    } catch (err) {
      console.error("Failed to open EPUB:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectFile = useCallback(async (path: string) => {
    try {
      setIsLoading(true);
      setLoadingMessage("📂 Reading file...");
      const content = await invoke<string>("read_file", {
        path,
      });
      setActiveFile(path);
      setChapterContent(content);
      setEditorDirty(false);
    } catch (err) {
      console.error("Failed to read chapter:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    setChapterContent(value);
    setEditorDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    setIsLoading(true);
    setLoadingMessage("💾 Saving and refreshing preview...");
    try {
      await invoke("save_file", {
        path: activeFile,
        content: chapterContent,
      });
      setEditorDirty(false);

      const buffer = await invoke<number[]>("get_epub_buffer");
      setEpubBuffer(new Uint8Array(buffer).buffer);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  }, [activeFile, chapterContent]);

  const handleExtractEntities = useCallback(async () => {
    if (!activeFile || !chapterContent) return;
    setIsLoading(true);
    setLoadingMessage("✨ Extracting entities and crawling wikis...");
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key");
      const model = await store.get<string>("gemini_model_extract") || await store.get<string>("gemini_model") || "models/gemini-1.5-flash";
      const wikiUrl = await store.get<string>("wiki_url") || "https://ja.wikipedia.org/w/";
      const develMode = await store.get<boolean>("devel_mode") || false;
      
      if (!apiKey) {
        alert("Please set your Google AI Studio API Key in Settings first.");
        setIsSettingsOpen(true);
        return;
      }

      console.log(`Extracting entities via Gemini (${model})...`);
      setLoadingMessage("✨ Extracting entities via Gemini...");
      const extracted = await invoke<string[]>("run_entity_extraction", {
        apiKey,
        model,
        text: chapterContent, 
        develMode,
      });
      console.log("Extracted:", extracted);
      
      let currentGlossary = await invoke<Term[]>("get_glossary");

      for (let i = 0; i < extracted.length; i++) {
        const entity = extracted[i];

        if (currentGlossary.some(t => t.ja === entity)) {
          console.log(`Skipping known entity: ${entity}`);
          continue;
        }

        setLoadingMessage(`🔍 Reconciling ${i + 1}/${extracted.length}: ${entity}...`);
        try {
          const term = await invoke<Term>("reconcile_term", {
             apiKey, model, wikiUrl, entity, develMode 
          });
          currentGlossary.push(term);
          await invoke("update_glossary", { glossary: currentGlossary });
          await emit("glossary_updated");
        } catch (e) {
          console.error(`Failed to reconcile ${entity}`, e);
          alert(`Extraction interrupted: ${e}`);
          break;
        }

        // Add an artificial delay to respect Gemini's free tier rate limits (15 RPM)
        if (i < extracted.length - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }

      setLoadingMessage("");
      alert(`Extraction and Reconciliation complete! ${extracted.length} terms merged into your Glossary.`);
      setIsLoading(false);
    } catch (err) {
      console.error("Failed to extract entities:", err);
      alert(`Extraction failed: ${err}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  }, [activeFile, chapterContent]);

  const handleSaveTerm = useCallback(async (updatedTerm: Term) => {
    try {
      const currentGlossary = await invoke<Term[]>("get_glossary");
      const idx = currentGlossary.findIndex(t => t.id === updatedTerm.id);
      if (idx !== -1) {
        currentGlossary[idx] = updatedTerm;
        await invoke("update_glossary", { glossary: currentGlossary });
        await emit("glossary_updated");
      }
      setEditingTerm(null);
    } catch (err) {
      console.error("Failed to save term:", err);
      alert("Failed to save term.");
    }
  }, []);

  const handleTranslateChapter = useCallback(async () => {
    if (!activeFile) return;
    setIsLoading(true);
    setLoadingMessage("🌐 Translating chapter with AI...");
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key");
      const model = await store.get<string>("gemini_model_translate") || await store.get<string>("gemini_model") || "models/gemini-1.5-flash";
      const develMode = await store.get<boolean>("devel_mode") || false;

      if (!apiKey) {
        alert("Please set your Google AI Studio API Key in Settings first.");
        setIsSettingsOpen(true);
        return;
      }

      const result = await invoke<TranslationResult>("translate_chapter", {
        apiKey,
        model,
        path: activeFile,
        develMode,
      });

      // Load the translated content into the editor (user reviews before saving)
      setChapterContent(result.translated_xhtml);
      setEditorDirty(true);

      // Push new terms to the glossary as "pending"
      if (result.new_terms.length > 0) {
        const currentGlossary = await invoke<Term[]>("get_glossary");
        const timestamp = Date.now();
        const newTerms: Term[] = result.new_terms.map((t, i) => ({
          id: `term_${timestamp}_${i}`,
          ja: t.ja,
          en: t.en,
          notes: t.notes ?? null,
          status: "pending" as const,
        }));
        // Only add terms not already in the glossary
        const merged = [
          ...currentGlossary,
          ...newTerms.filter(nt => !currentGlossary.some(g => g.ja === nt.ja)),
        ];
        await invoke("update_glossary", { glossary: merged });
        await emit("glossary_updated");
        setLoadingMessage("");
        alert(`Translation complete! ${result.new_terms.length} new terms added to Scratchpad. Review the translation in the editor, then click Save.`);
      } else {
        setLoadingMessage("");
        alert("Translation complete! Review the translation in the editor, then click Save.");
      }
    } catch (err) {
      console.error("Translation failed:", err);
      alert(`Translation failed: ${err}`);
    } finally {
      setLoadingMessage("");
      setIsLoading(false);
    }
  }, [activeFile]);

  const handleExportEpub = useCallback(async () => {
    if (!bookInfo) return;
    const outputPath = await save({
      title: "Export EPUB",
      defaultPath: `${bookInfo.title || "export"}.epub`,
      filters: [{ name: "EPUB Files", extensions: ["epub"] }],
    });
    if (!outputPath) return;
    setIsLoading(true);
    setLoadingMessage("📦 Packaging EPUB...");
    try {
      await invoke("export_epub", { outputPath });
      alert(`Exported successfully to:\n${outputPath}`);
    } catch (err) {
      console.error("Export failed:", err);
      alert(`Export failed: ${err}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  }, [bookInfo]);

  const handleNormalizeLayout = useCallback(async () => {
    if (!bookInfo) return;
    setIsLoading(true);
    setLoadingMessage("🪄 Normalizing EPUB layout...");
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key");
      const model = await store.get<string>("gemini_model_normalize") || await store.get<string>("gemini_model") || "models/gemini-1.5-flash";
      const develMode = await store.get<boolean>("devel_mode") || false;
      
      if (!apiKey) {
        alert("Please set your Google AI Studio API Key in Settings first.");
        setIsSettingsOpen(true);
        setIsLoading(false);
        setLoadingMessage("");
        return;
      }

      const layoutFiles = await invoke<LayoutFile[]>("get_layout_files");
      if (layoutFiles.length === 0) {
        alert("No layout files found to modify.");
        setIsLoading(false);
        setLoadingMessage("");
        return;
      }

      setLoadingMessage("🧠 Asking Gemini to re-layout...");
      const newFiles = await invoke<LayoutFile[]>("normalize_layout_files", {
        apiKey,
        model,
        files: layoutFiles,
        develMode,
      });

      if (newFiles.length === 0) {
        alert("Gemini returned no files to patch.");
        setIsLoading(false);
        setLoadingMessage("");
        return;
      }

      setLoadingMessage(`💾 Applying ${newFiles.length} file changes...`);
      for (const file of newFiles) {
        await invoke("save_file", { path: file.path, content: file.content });
      }
      
      const buffer = await invoke<number[]>("get_epub_buffer");
      setEpubBuffer(new Uint8Array(buffer).buffer);

      alert(`Successfully full-replaced ${newFiles.length} layout files!`);

      if (activeFile) {
        handleSelectFile(activeFile);
      }
    } catch (err) {
      console.error("Layout normalization failed:", err);
      alert(`Layout normalization failed: ${err}`);
    } finally {
      setLoadingMessage("");
      setIsLoading(false);
    }
  }, [bookInfo, activeFile, handleSelectFile]);

  // --- Render ---
  return (
    <div className="app">
      {isLoading && <LoadingOverlay message={loadingMessage} />}
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      {editingTerm && <TermEditorModal term={editingTerm} onClose={() => setEditingTerm(null)} onSave={handleSaveTerm} />}

      {/* Custom Titlebar */}
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__left">
          <span className="titlebar__logo">Lazypub</span>
          <span className="titlebar__version">v0.1.0</span>
        </div>

        {bookInfo && (
          <div className="titlebar__center">
            <span className="titlebar__book-title">{bookInfo.title}</span>
            {bookInfo.author && (
              <span className="titlebar__dot">·</span>
            )}
            {bookInfo.author && (
              <span className="titlebar__book-author">{bookInfo.author}</span>
            )}
            <span className="titlebar__book-lang">{bookInfo.language}</span>
          </div>
        )}

        <div className="titlebar__right">
          <div className="titlebar__actions">
            {activeFile !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn btn--sm" onClick={handleNormalizeLayout} disabled={isLoading}>
                  🪄 Normalize
                </button>
                {activeFile.match(/\.x?html?$/i) && (
                  <>
                    <button className="btn btn--sm" onClick={handleExtractEntities} disabled={isLoading}>
                      ✨ Extract
                    </button>
                    <button className="btn btn--sm btn--primary" onClick={handleTranslateChapter} disabled={isLoading}>
                      🌐 Translate
                    </button>
                  </>
                )}
              </div>
            )}
            <button className="btn btn--icon" onClick={() => setIsSettingsOpen(true)} title="Settings">
              ⚙️
            </button>
            {activeFile !== null && (
              <button 
                className={`btn btn--sm ${editorDirty ? "btn--primary" : ""}`} 
                onClick={handleSave}
              >
                Save
              </button>
            )}
            <button className="btn btn--sm btn--primary" onClick={handleOpenEpub}>
              Open EPUB
            </button>
            {bookInfo && (
              <button className="btn btn--sm btn--primary" onClick={handleExportEpub} disabled={isLoading}>
                💾 Export
              </button>
            )}
          </div>
          <div className="titlebar__controls">
            <button
              className="titlebar__control titlebar__control--minimize"
              onClick={handleMinimize}
              aria-label="Minimize"
            >
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              className="titlebar__control titlebar__control--maximize"
              onClick={handleMaximize}
              aria-label="Maximize"
            >
              {isMaximized ? (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <rect x="2.5" y="0.5" width="8.5" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                  <rect x="1" y="3" width="8.5" height="8.5" rx="1" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </button>
            <button
              className="titlebar__control titlebar__control--close"
              onClick={handleClose}
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Workspace */}
      <div className="workspace">
        {/* Sidebar Left: Files */}
        <div className="sidebar-container">
          {bookInfo && (
            <Sidebar
              fileTree={fileTree}
              activeFile={activeFile}
              onSelectFile={handleSelectFile}
            />
          )}
        </div>

        {/* Main Editor/Preview Area */}
        <div className="editor-area">
          {activeFile ? (
            <>
              <div className="editor-area__tabs">
                <button 
                  className={`editor-area__tab ${viewMode === "editor" ? "editor-area__tab--active" : ""}`}
                  onClick={() => setViewMode("editor")}
                >
                  📝 Source
                </button>
                <button 
                  className={`editor-area__tab ${viewMode === "preview" ? "editor-area__tab--active" : ""}`}
                  onClick={() => setViewMode("preview")}
                >
                  👁️ Preview
                </button>
              </div>
              <div className="editor-area__content">
                {viewMode === "editor" ? (
                  <Editor
                    content={chapterContent}
                    language={activeFile.endsWith(".css") ? "css" : "xml"}
                    onChange={handleEditorChange}
                  />
                ) : (
                  <Preview epubBuffer={epubBuffer} activeFile={activeFile} />
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state__icon">📚</div>
              <h2 className="empty-state__title">No file selected</h2>
              <p className="empty-state__subtitle">
                Select a chapter from the sidebar to start translating.
              </p>
              {!bookInfo && (
                <button className="btn btn--primary" onClick={handleOpenEpub}>📂 Open EPUB</button>
              )}
            </div>
          )}
        </div>

        {/* Sidebar Right: Glossary */}
        <div className="sidebar-right">
          {bookInfo && (
            <Scratchpad 
              onTermClick={setEditingTerm} 
              onRequestReconciliation={handleExtractEntities} 
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
