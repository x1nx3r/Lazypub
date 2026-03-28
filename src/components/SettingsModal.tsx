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
      const savedDevel = await store.get<boolean>("devel_mode");
      
      if (savedKey) setApiKey(savedKey);
      if (savedWiki) setWikiUrl(savedWiki);
      if (savedExtract) setModelExtract(savedExtract);
      if (savedTranslate) setModelTranslate(savedTranslate);
      if (savedNormalize) setModelNormalize(savedNormalize);
      if (typeof savedDevel === "boolean") setDevelMode(savedDevel);
    }
    loadSettings();
  }, []);

  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      alert("Please enter your API Key first!");
      return;
    }
    
    setIsFetchingModels(true);
    try {
      const models = await invoke<string[]>("list_ai_models", { 
        apiKey: apiKey.trim(),
        develMode 
      });
      setAvailableModels(models);
    } catch (e) {
      console.error("Failed to fetch models", e);
      alert(`Failed to fetch models: ${e}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

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
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ margin: 0 }}>Model Selections</label>
                <button 
                  className="btn btn--sm" 
                  onClick={handleFetchModels}
                  disabled={isFetchingModels || !apiKey}
                >
                  {isFetchingModels ? "Fetching..." : "Refresh Models List"}
                </button>
             </div>

             <div className="model-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label htmlFor="model-extract" className="help-text" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Entity Extraction</label>
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

                <div className="form-group">
                  <label htmlFor="model-translate" className="help-text" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Chapter Translation</label>
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

                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="model-normalize" className="help-text" style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Layout Normalization (Heavy Task)</label>
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

          <div className="form-group">
            <label htmlFor="wiki-url">Target MediaWiki URL</label>
            <input 
              id="wiki-url"
              type="text" 
              value={wikiUrl} 
              onChange={(e) => setWikiUrl(e.target.value)}
              placeholder="https://ja.wikipedia.org/w/"
              className="text-input"
            />
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              id="devel-mode"
              type="checkbox" 
              checked={develMode} 
              onChange={(e) => setDevelMode(e.target.checked)}
            />
            <label htmlFor="devel-mode" style={{ margin: 0 }}>Enable Developer Mode (Verbose Logging)</label>
          </div>
          {develMode && (
            <p className="help-text" style={{ marginTop: '-12px', marginBottom: '20px', paddingLeft: '24px' }}>
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
