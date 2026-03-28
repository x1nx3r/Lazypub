import { useState } from "react";
import { Term } from "../types";

interface TermEditorModalProps {
  term: Term;
  onClose: () => void;
  onSave: (updatedTerm: Term) => void;
}

export function TermEditorModal({ term, onClose, onSave }: TermEditorModalProps) {
  const [enTranslation, setEnTranslation] = useState(term.en || "");
  const [notes, setNotes] = useState(term.notes || "");
  const [status, setStatus] = useState<"pending" | "approved">(term.status);

  const handleSave = () => {
    onSave({
      ...term,
      en: enTranslation.trim(),
      notes: notes.trim() || null,
      status,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Edit Term Verification</h2>
          <button className="btn btn--icon" onClick={onClose}>✕</button>
        </div>
        
        <div className="modal__body">
          <div className="form-group">
            <label>Original Japanese Term</label>
            <input 
              type="text" 
              value={term.ja} 
              disabled
              className="text-input text-input--disabled"
              style={{ backgroundColor: "var(--bg-tertiary)" }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="en-translation">English Translation</label>
            <input 
              id="en-translation"
              type="text" 
              value={enTranslation} 
              onChange={(e) => setEnTranslation(e.target.value)}
              placeholder="E.g., Holy Grail"
              className="text-input"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="term-notes">Context / Notes</label>
            <textarea 
              id="term-notes"
              value={notes} 
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes or references for this translation..."
              className="text-input"
              style={{ minHeight: "80px", resize: "vertical" }}
            />
          </div>

          <div className="form-group">
            <label>Verification Status</label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0, fontWeight: 'normal' }}>
                <input 
                  type="radio" 
                  name="status" 
                  value="pending" 
                  checked={status === "pending"} 
                  onChange={() => setStatus("pending")} 
                />
                Pending
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0, fontWeight: 'normal' }}>
                <input 
                  type="radio" 
                  name="status" 
                  value="approved" 
                  checked={status === "approved"} 
                  onChange={() => setStatus("approved")} 
                />
                Approved
              </label>
            </div>
            <p className="help-text">Marking it as approved will move it to the Verified list.</p>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
