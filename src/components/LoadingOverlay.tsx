import { useEffect, useRef, useState } from "react";
import "./LoadingOverlay.css";

interface LoadingOverlayProps {
  message: string;
  /** Live reasoning stream from the model, if it exposes one */
  reasoning?: string;
  /** "thinking" = reasoning phase, "writing" = model is producing final output */
  phase?: "thinking" | "writing";
}

export function LoadingOverlay({ message, reasoning = "", phase = "thinking" }: LoadingOverlayProps) {
  const [elapsed, setElapsed] = useState(0);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  // Follow the tail unless the user scrolled up to read
  useEffect(() => {
    const el = tailRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [reasoning]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="loading-overlay-modal">
      <div className="loading-overlay-modal__card">
        <div className="loading-overlay-modal__row">
          <div className="loading-overlay-modal__spinner" />
          <span className="loading-overlay-modal__message">{message}</span>
          <span className="loading-overlay-modal__elapsed">{mm}:{ss}</span>
        </div>
        {phase === "writing" ? (
          <div className="loading-overlay-modal__writing">Writing output…</div>
        ) : reasoning ? (
          <div
            className="loading-overlay-modal__reasoning"
            ref={tailRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {reasoning}
            <span className="loading-overlay-modal__caret" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
