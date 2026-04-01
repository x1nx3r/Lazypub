import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { Preview, PreviewHandle } from "./components/Preview";
import { ImagePreview } from "./components/ImagePreview";
import { SettingsModal } from "./components/SettingsModal";
import { Scratchpad } from "./components/Scratchpad";
import { TermEditorModal } from "./components/TermEditorModal";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { OpenResult, Term, FileNode, LayoutFile, TranslationResult } from "./types";
import { load } from "@tauri-apps/plugin-store";
import { XhtmlDebugger } from "./components/XhtmlDebugger";
import "./components/XhtmlDebugger.css";
import packageJson from "../package.json";
import "./App.css";
import logoImg from "./assets/logo.svg?url";
import { getThinkingMsg } from "./thinkingPhrases";
import { 
  FolderOpen, 
  Save, 
  Wrench, 
  Search, 
  Languages, 
  Sparkles, 
  Package, 
  Settings,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut
} from "lucide-react";

type ViewMode = "editor" | "preview";

interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
}

const appWindow = getCurrentWindow();

function App() {
  // --- State ---
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [bookInfo, setBookInfo] = useState<OpenResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [chapterContent, setChapterContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [isDebuggerOpen, setIsDebuggerOpen] = useState(false);
  const [debuggerResult, setDebuggerResult] = useState<TranslationResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  // --- Preview State ---
  const previewRef = useRef<PreviewHandle>(null);
  const [previewLocation, setPreviewLocation] = useState({ index: 0, total: 0, label: "1" });

  // --- Window controls ---
  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  // --- Handlers ---
  const loadRecentProjects = async () => {
    try {
      const store = await load("settings.json");
      const saved = await store.get<RecentProject[]>("recent_projects") || [];
      setRecentProjects(saved);
    } catch (e) {
      console.error("Failed to load recent projects", e);
    }
  };

  const saveRecentProject = async (name: string, path: string) => {
    try {
      const store = await load("settings.json");
      let current = await store.get<RecentProject[]>("recent_projects") || [];
      current = current.filter(p => p.path !== path);
      current.unshift({ name, path, lastOpened: Date.now() });
      if (current.length > 10) current = current.slice(0, 10); // Keep last 10
      await store.set("recent_projects", current);
      await store.save();
      setRecentProjects(current);
    } catch (e) {
      console.error("Failed to save recent project", e);
    }
  };

  useEffect(() => {
    loadRecentProjects();
  }, []);

  const handleImportEpub = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadingMessage(getThinkingMsg("generic"));
      const epubPath = await open({
        multiple: false,
        title: "Select EPUB to Import",
        filters: [{ name: "EPUB Files", extensions: ["epub"] }],
      });
      if (!epubPath) {
        setIsLoading(false);
        return;
      }

      const outputDir = await open({
        directory: true,
        multiple: false,
        title: "Select Empty Folder for Project Workspace",
      });
      if (!outputDir) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadingMessage(getThinkingMsg("import"));
      const result = await invoke<OpenResult>("import_epub", {
        path: epubPath,
        outputDir: outputDir
      });

      setBookInfo(result);
      setFileTree(result.file_tree);
      setActiveFile(null);
      setChapterContent("");
      setEditorDirty(false);

      saveRecentProject(result.title || "UntitledBook", outputDir as string);
    } catch (err) {
      console.error("Failed to import EPUB:", err);
      alert(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenProject = useCallback(async (preselectedPath?: string) => {
    try {
      let targetPath = preselectedPath;
      if (!targetPath || typeof targetPath !== "string") {
        setIsLoading(true);
        setLoadingMessage(getThinkingMsg("generic"));
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Lazypub Project Folder",
        });
        if (!selected) {
          setIsLoading(false);
          return;
        }
        targetPath = selected as string;
      }

      setIsLoading(true);
      setLoadingMessage(getThinkingMsg("load"));
      const result = await invoke<OpenResult>("load_project", {
        projectDir: targetPath,
      });

      setBookInfo(result);
      setFileTree(result.file_tree);
      setActiveFile(null);
      setChapterContent("");
      setEditorDirty(false);

      saveRecentProject(result.title || "Untitled", targetPath);
    } catch (err) {
      console.error("Failed to load project:", err);
      alert("Error loading project: " + err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectFile = useCallback(async (path: string) => {
    try {
      setIsLoading(true);

      const isImg = path.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i);

      if (isImg) {
        setChapterContent("");
        setActiveFile(path);
        setEditorDirty(false);
      } else {
        setLoadingMessage(getThinkingMsg("read"));
        const content = await invoke<string>("read_file", {
          path,
        });
        setActiveFile(path);
        setChapterContent(content);
        setEditorDirty(false);
      }

      // Auto-switch to editor if not a chapter and not an image
      const isChapter = path.match(/\.x?html?$/i) && path.startsWith(bookInfo?.opf_dir || "");
      if (!isChapter && !isImg && viewMode === "preview") {
        setViewMode("editor");
      }
    } catch (err) {
      console.error("Failed to read file:", err);
    } finally {
      setIsLoading(false);
    }
  }, [bookInfo, viewMode]);

  const handleEditorChange = useCallback((value: string) => {
    setChapterContent(value);
    setEditorDirty(true);
  }, []);

  const handleBeautify = useCallback(async () => {
    if (!chapterContent) return;
    try {
      setIsLoading(true);
      const beautified = await invoke<string>("beautify_xhtml", { content: chapterContent, stripRuby: true });
      setChapterContent(beautified);
      setEditorDirty(true);
    } catch (err) {
      console.error("Format error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [chapterContent]);

  const handleSave = useCallback(async () => {
    if (!activeFile) return;
    setIsLoading(true);
    setLoadingMessage(getThinkingMsg("save"));
    try {
      await invoke("save_file", {
        path: activeFile,
        content: chapterContent,
      });
      setEditorDirty(false);
      setRefreshKey(prev => prev + 1);
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
    setLoadingMessage(getThinkingMsg("ai"));
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key") || "";
      const model = await store.get<string>("gemini_model_extract") || await store.get<string>("gemini_model") || "models/gemini-1.5-flash";
      const wikiUrl = await store.get<string>("wiki_url") || "https://ja.wikipedia.org/w/";
      const targetLanguage = await store.get<string>("target_language") || "English";
      const develMode = await store.get<boolean>("devel_mode") || false;
      
      if (!apiKey) {
        alert("Please set your Google AI Studio API Key in Settings first.");
        setIsSettingsOpen(true);
        return;
      }

      setLoadingMessage(getThinkingMsg("ai"));
      const extracted = await invoke<string[]>("run_entity_extraction", {
        apiKey,
        model,
        text: chapterContent, 
        develMode,
      });
      
      let currentGlossary = await invoke<Term[]>("get_glossary");

      for (let i = 0; i < extracted.length; i++) {
        const entity = extracted[i];

        if (currentGlossary.some(t => t.ja === entity)) {
          console.log(`Skipping known entity: ${entity}`);
          continue;
        }

        setLoadingMessage(`${getThinkingMsg("reconcile")} (Reconciling ${i + 1}/${extracted.length}: ${entity})`);
        try {
          const term = await invoke<Term>("reconcile_term", {
             apiKey, model, wikiUrl, entity, chapterContext: chapterContent, targetLanguage, develMode 
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

  const handleExportAsset = useCallback(async () => {
    if (!activeFile) return;
    const fileName = activeFile.split('/').pop() || "asset";
    const extension = fileName.split('.').pop() || "";

    const dest = await save({
      filters: [{
        name: extension.toUpperCase(),
        extensions: [extension]
      }]
    });

    if (dest) {
      try {
        setIsLoading(true);
        await invoke("save_asset", { path: activeFile, dest });
      } catch (err) {
        console.error("Failed to export asset:", err);
        alert("Failed to export asset: " + err);
      } finally {
        setIsLoading(false);
      }
    }
  }, [activeFile]);

  const handleSaveTerm = useCallback(async (updatedTerm: Term) => {
    try {
      const currentGlossary = await invoke<Term[]>("get_glossary");
      const idx = currentGlossary.findIndex(t => t.id === updatedTerm.id);
      
      let newGlossary;
      if (idx !== -1) {
        currentGlossary[idx] = updatedTerm;
        newGlossary = currentGlossary;
      } else {
        newGlossary = [...currentGlossary, updatedTerm];
      }
      
      await invoke("update_glossary", { glossary: newGlossary });
      await emit("glossary_updated");
      setEditingTerm(null);
    } catch (err) {
      console.error("Failed to save term:", err);
      alert("Failed to save term.");
    }
  }, []);

  const handleDeleteTerm = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this term?")) return;
    try {
      const currentGlossary = await invoke<Term[]>("get_glossary");
      const filtered = currentGlossary.filter(t => t.id !== id);
      await invoke("update_glossary", { glossary: filtered });
      await emit("glossary_updated");
    } catch (err) {
      console.error("Failed to delete term:", err);
      alert("Failed to delete term.");
    }
  }, []);

  const handleAddNewTerm = useCallback(() => {
    const newTerm: Term = {
      id: `manual_${Date.now()}`,
      ja: "",
      en: "",
      notes: null,
      status: "approved",
    };
    setEditingTerm(newTerm);
  }, []);

  const handleTranslateChapter = useCallback(async () => {
    if (!activeFile) return;
    setIsLoading(true);
    setLoadingMessage(getThinkingMsg("ai"));
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key");
      const model = await store.get<string>("gemini_model_translate") || await store.get<string>("gemini_model") || "models/gemini-1.5-flash";
      const targetLanguage = await store.get<string>("target_language") || "English";
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
        targetLanguage,
        develMode,
      });

      // If there are errors (even if auto-fixed), show the debugger
      if (result.errors.length > 0) {
        setDebuggerResult(result);
        setIsDebuggerOpen(true);
        // We don't apply the content yet, wait for user to "Accept" in the debugger
      } else {
        applyTranslationResult(result);
      }
    } catch (err) {
      console.error("Translation failed:", err);
      alert(`Translation failed: ${err}`);
    } finally {
      setLoadingMessage("");
      setIsLoading(false);
    }
  }, [activeFile]);

  const applyTranslationResult = useCallback(async (result: TranslationResult) => {
    // Load the translated content into the editor (user reviews before saving)
    setChapterContent(result.translated_xhtml);
    setEditorDirty(true);
    setRefreshKey(prev => prev + 1);

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
      alert(`Translation complete! ${result.new_terms.length} new terms added to Scratchpad. Review the translation in the editor, then click Save.`);
    } else {
      alert("Translation complete! Review the translation in the editor, then click Save.");
    }
  }, []);

  const handleExportEpub = useCallback(async () => {
    if (!bookInfo) return;
    const outputPath = await save({
      title: "Export EPUB",
      defaultPath: `${bookInfo.title || "export"}.epub`,
      filters: [{ name: "EPUB Files", extensions: ["epub"] }],
    });
    if (!outputPath) return;
    setIsLoading(true);
    setLoadingMessage(getThinkingMsg("package"));
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
    setLoadingMessage(getThinkingMsg("layout"));
    try {
      const store = await load("settings.json");
      const apiKey = await store.get<string>("gemini_api_key") || "";
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

      setLoadingMessage(getThinkingMsg("ai"));
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

      setLoadingMessage(`${getThinkingMsg("layout")} (Applying ${newFiles.length} file changes)`);
      for (const file of newFiles) {
        await invoke("save_file", { path: file.path, content: file.content });
      }

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
          <img src={logoImg} alt="Lazypub Logo" className="titlebar__icon" />
          <span className="titlebar__logo">Lazypub</span>
          <span className="titlebar__version">v{packageJson.version}</span>
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
                  Source
                </button>
                {activeFile?.match(/\.x?html?$/i) && activeFile.startsWith(bookInfo?.opf_dir || "") && (
                  <button 
                    className={`editor-area__tab ${viewMode === "preview" ? "editor-area__tab--active" : ""}`}
                    onClick={() => setViewMode("preview")}
                  >
                    Preview
                  </button>
                )}
              </div>
              <div className="editor-area__content">
                {activeFile.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i) ? (
                  <ImagePreview path={activeFile} />
                ) : viewMode === "editor" ? (
                  <Editor
                    content={chapterContent}
                    language={activeFile.endsWith(".css") ? "css" : "xml"}
                    onChange={handleEditorChange}
                  />
                ) : (
                  <Preview 
                    ref={previewRef}
                    projectDir={bookInfo ? bookInfo.project_dir : null} 
                    activeFile={activeFile} 
                    opfDir={bookInfo ? bookInfo.opf_dir : null}
                    refreshKey={refreshKey}
                    onLocationChange={setPreviewLocation}
                    onFileChange={handleSelectFile}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <img src={logoImg} alt="Lazypub Logo" className="empty-state__logo" />
              <h2 className="empty-state__title">No project open</h2>
              
              <div className="empty-state__actions">
                <button className="btn btn--primary" onClick={handleImportEpub}>Import EPUB</button>
                <button className="btn" onClick={() => handleOpenProject()}>Open Workspace</button>
              </div>

              {recentProjects.length > 0 && (
                <div className="empty-state__recent">
                  <h3>Recent Projects</h3>
                  <ul className="recent-list">
                    {recentProjects.map(p => (
                      <li key={p.path} onClick={() => handleOpenProject(p.path)}>
                        <span className="recent-name">{p.name}</span>
                        <span className="recent-path">{p.path}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Floating Toolbox - Contextually centered to editor view */}
          <div className="floating-toolbox">
            <button className="toolbox-item" onClick={() => handleOpenProject()} title="Open an existing project workspace">
              <span className="toolbox-item__icon"><FolderOpen /></span>
              <span className="toolbox-item__label">Open</span>
            </button>
            <button className="toolbox-item" onClick={handleImportEpub} title="Import a new EPUB file">
              <span className="toolbox-item__icon"><Package /></span>
              <span className="toolbox-item__label">Import</span>
            </button>

            {bookInfo && (
              <>
                <div className="toolbox-divider" />
                
                {activeFile?.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i) ? (
                  <>
                    <button className="toolbox-item toolbox-item--primary" onClick={handleExportAsset} disabled={isLoading} title="Export image to file">
                      <span className="toolbox-item__icon"><FolderOpen /></span>
                      <span className="toolbox-item__label">Export</span>
                    </button>
                  </>
                ) : viewMode === "editor" ? (
                  <>
                    <button 
                      className={`toolbox-item ${editorDirty ? "toolbox-item--primary" : ""}`} 
                      onClick={handleSave}
                      disabled={!activeFile || !editorDirty || isLoading}
                      title="Save changes to disk"
                    >
                      <span className="toolbox-item__icon"><Save /></span>
                      <span className="toolbox-item__label">Save</span>
                    </button>

                    <button className="toolbox-item" onClick={handleNormalizeLayout} disabled={isLoading} title="Fix layout, writing mode, and RTL/LTR">
                      <span className="toolbox-item__icon"><Wrench /></span>
                      <span className="toolbox-item__label">Layout</span>
                    </button>

                    {activeFile?.match(/\.x?html?$/i) && (
                      <button className="toolbox-item" onClick={handleExtractEntities} disabled={isLoading} title="Extract search terms from text">
                        <span className="toolbox-item__icon"><Search /></span>
                        <span className="toolbox-item__label">Extract</span>
                      </button>
                    )}

                    <button className="toolbox-item toolbox-item--primary" onClick={handleTranslateChapter} disabled={isLoading} title="Translate chapter via Gemini">
                      <span className="toolbox-item__icon"><Languages /></span>
                      <span className="toolbox-item__label">Translate</span>
                    </button>

                    <button className="toolbox-item" onClick={handleBeautify} disabled={isLoading} title="Format code indentation">
                        <span className="toolbox-item__icon"><Sparkles /></span>
                        <span className="toolbox-item__label">Format</span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Preview Controls */}
                    <button className="toolbox-item" onClick={() => previewRef.current?.prev()} title="Previous Page">
                      <span className="toolbox-item__icon"><ChevronLeft /></span>
                      <span className="toolbox-item__label">Prev</span>
                    </button>

                    <div className="toolbox-info" style={{ padding: '0 8px', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '100px', maxWidth: '140px' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase', marginBottom: '1px' }}>
                        {activeFile?.split('/').pop() || "—"}
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Page {previewLocation.index + 1} <span style={{ opacity: 0.5, fontWeight: '400' }}>/ {previewLocation.total || "?"}</span>
                      </div>
                    </div>

                    <button className="toolbox-item" onClick={() => previewRef.current?.next()} title="Next Page">
                      <span className="toolbox-item__icon"><ChevronRight /></span>
                      <span className="toolbox-item__label">Next</span>
                    </button>

                    <div className="toolbox-divider" />

                    <button className="toolbox-item" onClick={() => previewRef.current?.zoom(-10)} title="Zoom Out">
                      <span className="toolbox-item__icon"><ZoomOut /></span>
                      <span className="toolbox-item__label">Out</span>
                    </button>

                    <button className="toolbox-item" onClick={() => previewRef.current?.zoom(10)} title="Zoom In">
                      <span className="toolbox-item__icon"><ZoomIn /></span>
                      <span className="toolbox-item__label">In</span>
                    </button>
                  </>
                )}

                <div className="toolbox-divider" />

                <button className="toolbox-item" onClick={handleExportEpub} disabled={isLoading} title="Repackage as EPUB">
                  <span className="toolbox-item__icon"><Package /></span>
                  <span className="toolbox-item__label">Export</span>
                </button>
              </>
            )}

            <div className="toolbox-divider" />
            
            <button className="toolbox-item" onClick={() => setIsSettingsOpen(true)} title="Configure API keys and models">
              <span className="toolbox-item__icon"><Settings /></span>
              <span className="toolbox-item__label">Settings</span>
            </button>
          </div>
        </div>

        {/* Sidebar Right: Glossary */}
        <div className="sidebar-right">
          {bookInfo && (
            <Scratchpad 
              onTermClick={setEditingTerm} 
              onDeleteTerm={handleDeleteTerm}
              onAddTerm={handleAddNewTerm}
              onRequestReconciliation={handleExtractEntities} 
            />
          )}
        </div>
      </div>
      {isSettingsOpen && (
        <SettingsModal 
          onClose={() => setIsSettingsOpen(false)} 
        />
      )}

      {isDebuggerOpen && debuggerResult && (
        <XhtmlDebugger
          content={debuggerResult.translated_xhtml}
          errors={debuggerResult.errors}
          onClose={() => {
            setIsDebuggerOpen(false);
            setDebuggerResult(null);
          }}
          onAccept={() => {
            applyTranslationResult(debuggerResult);
            setIsDebuggerOpen(false);
            setDebuggerResult(null);
          }}
        />
      )}

      {isLoading && (
        <LoadingOverlay message={loadingMessage} />
      )}
    </div>
  );
}

export default App;
