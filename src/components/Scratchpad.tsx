import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { Term } from "../types";

interface ScratchpadProps {
  onTermClick: (term: Term) => void;
  onDeleteTerm: (id: string) => void;
  onAddTerm: () => void;
  onRequestReconciliation: () => void;
}

export function Scratchpad({ onTermClick, onDeleteTerm, onAddTerm, onRequestReconciliation }: ScratchpadProps) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const fetchGlossary = async () => {
    setIsLoading(true);
    try {
      const glossary = await invoke<Term[]>("get_glossary");
      setTerms(glossary);
    } catch (e) {
      console.error("Failed to fetch glossary", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      const store = await load("settings.json");
      const lang = await store.get<string>("target_language") || "English";
      setTargetLanguage(lang);
    };
    loadSettings();
    fetchGlossary();
    const unlisten = listen("glossary_updated", () => {
      fetchGlossary();
      loadSettings();
    });
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const pendingTerms = terms.filter(t => t.status === "pending");
  const approvedTerms = terms.filter(t => t.status === "approved");

  const handleToggleSelectAll = () => {
    if (selectedIds.size === pendingTerms.length && pendingTerms.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTerms.map(t => t.id)));
    }
  };

  const handleToggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) return;
    setIsSaving(true);
    try {
      const newGlossary = terms.map(t => {
        if (selectedIds.has(t.id) && t.status === "pending") {
          return { ...t, status: "approved" as const };
        }
        return t;
      });

      await invoke("update_glossary", { glossary: newGlossary });
      await emit("glossary_updated");
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to batch approve terms", err);
      alert("Failed to batch approve terms.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="scratchpad">
      <div className="scratchpad__header">
        <div className="flex flex-col">
          <h2 className="mb-0">Glossary</h2>
          <span className="text-xs text-secondary">{targetLanguage} Target</span>
        </div>
        <div className="flex gap-1">
          <button className="btn btn--sm" onClick={onAddTerm} title="Add Manual Term">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button className="btn btn--sm" onClick={fetchGlossary} title="Refresh">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          </button>
        </div>
      </div>

      {pendingTerms.length > 0 && (
        <div className="scratchpad__batch-actions">
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              checked={selectedIds.size === pendingTerms.length && pendingTerms.length > 0}
              onChange={handleToggleSelectAll}
            />
            <span className="text-sm text-secondary">{selectedIds.size} selected</span>
          </div>
          {selectedIds.size > 0 && (
            <button className="btn btn--sm btn--primary" onClick={handleBatchApprove} disabled={isSaving}>
              {isSaving ? "..." : "Approve"}
            </button>
          )}
        </div>
      )}

      <div className="scratchpad__content">
        {isLoading ? (
          <div className="loading-overlay">
            <div className="loading-spinner" />
          </div>
        ) : terms.length === 0 ? (
          <div className="empty-state empty-state--sm">
            <i>No terms extracted yet.</i>
            <button className="btn btn--primary btn--sm mt-2" onClick={onRequestReconciliation}>
              Extract Entities
            </button>
          </div>
        ) : (
          <div className="term-lists">
            {pendingTerms.length > 0 && (
              <div className="term-group">
                <h3 className="term-group__title">
                  <span className="dot dot--orange" /> Pending ({pendingTerms.length})
                </h3>
                <div className="term-list">
                  {pendingTerms.map(term => (
                    <div key={term.id} className="term-item" onClick={() => onTermClick(term)}>
                      <input 
                        type="checkbox" 
                        className="term-item__checkbox"
                        checked={selectedIds.has(term.id)}
                        onChange={(e) => handleToggleSelect(e as any, term.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="term-item__content">
                        <div className="term-item__ja">{term.ja}</div>
                        <div className="term-item__en">{term.en || "?" }</div>
                      </div>
                      <button 
                         className="term-item__delete" 
                         onClick={(e) => { e.stopPropagation(); onDeleteTerm(term.id); }}
                         title="Delete Term"
                      >
                         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="term-group">
              <h3 className="term-group__title">
                <span className="dot dot--green" /> Approved ({approvedTerms.length})
              </h3>
              <div className="term-list">
                {approvedTerms.map(term => (
                  <div key={term.id} className="term-item term-item--approved" onClick={() => onTermClick(term)}>
                    <div className="term-item__content">
                      <div className="term-item__ja">{term.ja}</div>
                      <div className="term-item__en">{term.en}</div>
                    </div>
                    <button 
                       className="term-item__delete" 
                       onClick={(e) => { e.stopPropagation(); onDeleteTerm(term.id); }}
                       title="Delete Term"
                    >
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
