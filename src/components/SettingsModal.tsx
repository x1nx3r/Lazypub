import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [wikiUrl, setWikiUrl] = useState("https://ja.wikipedia.org/w/");
  const [modelExtract, setModelExtract] = useState("models/gemini-1.5-flash");
  const [modelTranslate, setModelTranslate] = useState("models/gemini-1.5-flash");
  const [modelNormalize, setModelNormalize] = useState("models/gemini-1.5-flash");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [develMode, setDevelMode] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const store = await load("settings.json");
      const savedKey = await store.get<string>("gemini_api_key");
      const savedWiki = await store.get<string>("wiki_url");
      const savedExtract = await store.get<string>("gemini_model_extract") || await store.get<string>("gemini_model");
      const savedTranslate = await store.get<string>("gemini_model_translate") || await store.get<string>("gemini_model");
      const savedNormalize = await store.get<string>("gemini_model_normalize") || await store.get<string>("gemini_model");
      const savedLang = await store.get<string>("target_language") || "English";
      const savedDevel = await store.get<boolean>("devel_mode");
      
      if (savedKey) setApiKey(savedKey);
      if (savedWiki) setWikiUrl(savedWiki);
      if (savedExtract) setModelExtract(savedExtract);
      if (savedTranslate) setModelTranslate(savedTranslate);
      if (savedNormalize) setModelNormalize(savedNormalize);
      setTargetLanguage(savedLang);
      if (typeof savedDevel === "boolean") setDevelMode(savedDevel);
    }
    loadSettings();
  }, []);

  const handleFetchModels = async (keyToUse?: string) => {
    const key = keyToUse || apiKey.trim();
    if (!key || !key.startsWith("AIzaSy")) return;
    
    setIsFetchingModels(true);
    try {
      const models = await invoke<string[]>("list_ai_models", { 
        apiKey: key,
        develMode 
      });
      setAvailableModels(models);
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Auto-fetch on mount if API key exists
  useEffect(() => {
    async function init() {
      const store = await load("settings.json");
      const savedKey = await store.get<string>("gemini_api_key");
      if (savedKey && savedKey.startsWith("AIzaSy")) {
        handleFetchModels(savedKey);
      }
    }
    init();
  }, []);

  // Debounced fetch when API key changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (apiKey.startsWith("AIzaSy") && availableModels.length === 0) {
        handleFetchModels();
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [apiKey]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const store = await load("settings.json");
      await store.set("gemini_api_key", apiKey.trim());
      await store.set("wiki_url", wikiUrl.trim());
      await store.set("gemini_model_extract", modelExtract);
      await store.set("gemini_model_translate", modelTranslate);
      await store.set("gemini_model_normalize", modelNormalize);
      // Keep legacy for backward compatibility if needed by older code
      await store.set("gemini_model", modelExtract); 
      await store.set("target_language", targetLanguage);
      await store.set("devel_mode", develMode);
      await store.save();
      onClose();
    } catch (e) {
      console.error("Failed to save settings", e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Settings</h2>
          <button className="btn btn--icon" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal__body">
          <div className="form-group">
            <label htmlFor="api-key">Google AI Studio API Key (Gemini)</label>
            <input 
              id="api-key"
              type="password" 
              value={apiKey} 
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="text-input"
            />
            <p className="help-text">Your key is stored securely in your local AppData via Tauri Store.</p>
          </div>

          <div className="form-group">
             <div className="flex justify-between items-center mb-2">
                <label className="mb-0">Model Selections</label>
                <button 
                  className="btn btn--sm" 
                  onClick={() => handleFetchModels()}
                  disabled={isFetchingModels || !apiKey}
                >
                  {isFetchingModels ? "Fetching..." : "Refresh Models List"}
                </button>
             </div>

             <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="form-group mb-0">
                  <label htmlFor="model-extract" className="text-xs font-bold uppercase tracking-wider text-muted mb-1">Entity Extraction</label>
                  <select 
                    id="model-extract"
                    value={modelExtract}
                    onChange={(e) => setModelExtract(e.target.value)}
                    className="text-input"
                  >
                    {availableModels.length === 0 && <option value={modelExtract}>{modelExtract}</option>}
                    {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>

                <div className="form-group mb-0">
                  <label htmlFor="model-translate" className="text-xs font-bold uppercase tracking-wider text-muted mb-1">Chapter Translation</label>
                  <select 
                    id="model-translate"
                    value={modelTranslate}
                    onChange={(e) => setModelTranslate(e.target.value)}
                    className="text-input"
                  >
                    {availableModels.length === 0 && <option value={modelTranslate}>{modelTranslate}</option>}
                    {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>

                <div className="form-group mb-0" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="model-normalize" className="text-xs font-bold uppercase tracking-wider text-muted mb-1">Layout Normalization (Heavy Task)</label>
                  <select 
                    id="model-normalize"
                    value={modelNormalize}
                    onChange={(e) => setModelNormalize(e.target.value)}
                    className="text-input"
                  >
                    {availableModels.length === 0 && <option value={modelNormalize}>{modelNormalize}</option>}
                    {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>
             </div>
          </div>

          <div className="form-group border-t border-subtle pt-4 mt-4 grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="target-lang">Target Language</label>
              <select 
                id="target-lang"
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="text-input"
              >
                <option value="English">English</option>
                <option value="Indonesian">Indonesian</option>
              </select>
            </div>
            <div>
              <label htmlFor="wiki-url">Wiki URL (e.g. ja.wikipedia.org)</label>
              <input 
                id="wiki-url"
                type="text" 
                value={wikiUrl} 
                onChange={(e) => setWikiUrl(e.target.value)}
                placeholder="https://ja.wikipedia.org/w/"
                className="text-input"
              />
            </div>
          </div>

          <div className="form-group flex items-center gap-2 mb-0">
            <input 
              id="devel-mode"
              type="checkbox" 
              checked={develMode} 
              onChange={(e) => setDevelMode(e.target.checked)}
            />
            <label htmlFor="devel-mode" className="mb-0">Enable Developer Mode (Verbose Logging)</label>
          </div>
          {develMode && (
            <p className="help-text px-6">
              When enabled, the Rust backend will print all raw API requests and responses (Gemini, MediaWiki) to the terminal.
            </p>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
