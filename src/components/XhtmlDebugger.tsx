import React from "react";
import { X, AlertTriangle, CheckCircle, Code } from "lucide-react";

interface XhtmlDebuggerProps {
  content: string;
  errors: string[];
  onClose: () => void;
  onAccept: () => void;
}

export const XhtmlDebugger: React.FC<XhtmlDebuggerProps> = ({ content, errors, onClose, onAccept }) => {
  return (
    <div className="xhtml-debugger-overlay">
      <div className="xhtml-debugger">
        <header className="xhtml-debugger__header">
          <div className="xhtml-debugger__title">
            <AlertTriangle className="icon--warning" />
            <span>XHTML Validation Debugger</span>
          </div>
          <button className="xhtml-debugger__close" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="xhtml-debugger__body">
          <div className="xhtml-debugger__status">
            {errors.length > 0 ? (
              <div className="status-box status-box--error">
                <AlertTriangle size={18} />
                <div className="status-box__content">
                  <p><strong>{errors.length} Critical errors found.</strong> The AI output contains structural issues that might break the EPUB or the preview.</p>
                  <ul>
                    {errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="status-box status-box--success">
                <CheckCircle size={18} />
                <div className="status-box__content">
                  <p><strong>Validation Passed (Auto-fixed).</strong> Structural issues were detected but have been successfully repaired by the backend.</p>
                </div>
              </div>
            )}
          </div>

          <div className="xhtml-debugger__code-container">
            <div className="code-header">
              <Code size={14} />
              <span>Generated XHTML Source</span>
            </div>
            <pre className="xhtml-debugger__code">
              <code>{content}</code>
            </pre>
          </div>
        </div>

        <footer className="xhtml-debugger__footer">
          <div className="footer-info">
            Continuing with errors might cause the chapter to fail to render in some readers.
          </div>
          <div className="footer-actions">
            <button className="btn" onClick={onClose}>Discard Result</button>
            <button className="btn btn--primary" onClick={onAccept}>Keep Anyway</button>
          </div>
        </footer>
      </div>
    </div>
  );
};
