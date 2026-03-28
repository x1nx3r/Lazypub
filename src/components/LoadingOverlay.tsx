import "./LoadingOverlay.css";

interface LoadingOverlayProps {
  message: string;
}

export function LoadingOverlay({ message }: LoadingOverlayProps) {
  return (
    <div className="loading-overlay-modal">
      <div className="loading-overlay-modal__card">
        <div className="loading-overlay-modal__spinner" />
        <p className="loading-overlay-modal__message">{message}</p>
      </div>
    </div>
  );
}
