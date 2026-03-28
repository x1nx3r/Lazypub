import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [wikiUrl, setWikiUrl] = useState("https://ja.wikipedia.org/w/");
  const [selectedModel, setSelectedModel] = useState("models/gemini-1.5-flash");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [develMode, setDevelMode] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const store = await load("settings.json");
      const savedKey = await store.get<string>("gemini_api_key");
      const savedWiki = await store.get<string>("wiki_url");
      const savedModel = await store.get<string>("gemini_model");
      const savedDevel = await store.get<boolean>("devel_mode");
      
      if (savedKey) setApiKey(savedKey);
      if (savedWiki) setWikiUrl(savedWiki);
      if (savedModel) setSelectedModel(savedModel);
      if (savedDevel !== null) setDevelMode(savedDevel);
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
      
      // Select the first one if we don't have one selected and models exist
      if (models.length > 0 && !models.includes(selectedModel)) {
        setSelectedModel(models[0]);
      }
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
      await store.set("gemini_model", selectedModel);
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
            <label htmlFor="api-key">Google AI Studio API Key (Gemini) 🔑</label>
            <input 
              id="api-key"
              type="password" 
              value={apiKey} 
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="text-input"
            />
            <p className="help-text">Your key is stored securely in your local AppData via Tauri Store. It is only sent directly to Google APIs.</p>
          </div>

          <div className="form-group">
            <label htmlFor="model-select">Gemini Model Version 🤖</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <select 
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="text-input"
                style={{ flex: 1 }}
              >
                {availableModels.length === 0 && (
                  <option value={selectedModel}>{selectedModel} (Unverified)</option>
                )}
                {availableModels.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <button 
                className="btn btn--sm" 
                onClick={handleFetchModels}
                disabled={isFetchingModels || !apiKey}
              >
                {isFetchingModels ? "..." : "Fetch"}
              </button>
            </div>
            <p className="help-text">Select the model you want to use for Entity Extraction and Reconciliation.</p>
          </div>

          <div className="form-group">
            <label htmlFor="wiki-url">Target MediaWiki URL 🌐</label>
            <input 
              id="wiki-url"
              type="text" 
              value={wikiUrl} 
              onChange={(e) => setWikiUrl(e.target.value)}
              placeholder="https://ja.wikipedia.org/w/"
              className="text-input"
            />
            <p className="help-text">Point this to the target Fandom/Wikipedia `api.php` base URL.</p>
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
