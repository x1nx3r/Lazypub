import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Term } from "../types";

interface ScratchpadProps {
  onTermClick: (term: Term) => void;
  onRequestReconciliation: () => void;
}

export function Scratchpad({ onTermClick, onRequestReconciliation }: ScratchpadProps) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
    fetchGlossary();
    const unlisten = listen("glossary_updated", () => {
      fetchGlossary();
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
        <h2>Glossary</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn--sm" onClick={fetchGlossary} title="Refresh">↻</button>
        </div>
      </div>

      {pendingTerms.length > 0 && (
        <div className="scratchpad__batch-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="checkbox" 
              checked={selectedIds.size === pendingTerms.length && pendingTerms.length > 0}
              onChange={handleToggleSelectAll}
            />
            <span className="text-sm text-muted">{selectedIds.size} selected</span>
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
                        <div className="term-item__en">{term.en || "—"}</div>
                      </div>
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
