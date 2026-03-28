import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ImagePreviewProps {
  path: string;
}

export const ImagePreview = ({ path }: ImagePreviewProps) => {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadImg = async () => {
      setIsLoading(true);
      try {
        // We pass the path as both active_file and empty relative_path
        const uri = await invoke<string>("read_resource", { 
          activeFile: path, 
          relativePath: "" 
        });
        setDataUri(uri);
      } catch (err) {
        console.error("Failed to load image preview:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadImg();
  }, [path]);

  if (isLoading) {
    return (
      <div className="empty-state">
        <div className="loading-spinner" />
        <p>Loading image...</p>
      </div>
    );
  }

  if (!dataUri) {
    return (
      <div className="empty-state">
        <p>Failed to load image preview.</p>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100%', 
      padding: '40px',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: 'var(--radius-lg)'
    }}>
      <div style={{ 
        background: 'repeating-conic-gradient(#333 0% 25%, #444 0% 50%) 50% / 20px 20px',
        padding: '20px',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        maxWidth: '100%',
        maxHeight: '100%',
        display: 'flex'
      }}>
        <img 
          src={dataUri} 
          alt={path} 
          style={{ 
            maxWidth: '100%', 
            maxHeight: '100%', 
            objectFit: 'contain',
            borderRadius: '4px'
          }} 
        />
      </div>
    </div>
  );
};
