import { useEffect, useRef } from "react";
import ePub, { Rendition } from "epubjs";

interface PreviewProps {
  epubBuffer: ArrayBuffer | null;
  activeFile: string | null;
}

export function Preview({ epubBuffer, activeFile }: PreviewProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);

  useEffect(() => {
    if (!epubBuffer || !viewerRef.current) return;

    console.log("Loading EpubJS with buffer size:", epubBuffer.byteLength);

    // Load book from memory buffer
    const book = ePub(epubBuffer);
    
    // Clear old rendition
    viewerRef.current.innerHTML = "";

    const rendition = book.renderTo(viewerRef.current, {
      width: "100%",
      height: "100%",
      spread: "none",
    });
    renditionRef.current = rendition;

    book.ready.then(() => {
      console.log("EpubJS Book is ready! Spine loaded.");
      // If we have an active file selected in the sidebar, try to navigate there
      if (activeFile) {
        console.log("Attempting to display active file:", activeFile);
        rendition.display(activeFile).catch((e) => {
          console.error("Could not display active file in Epub.js:", e);
          rendition.display();
        });
      } else {
        console.log("No active file, displaying default.");
        rendition.display();
      }
    }).catch(err => {
      console.error("EpubJS failed to parse the buffer:", err);
    });

    return () => {
      book.destroy();
    };
  }, [epubBuffer]); // Rebuild the viewer entirely when the zip buffer changes (on Save)

  useEffect(() => {
    if (renditionRef.current && activeFile) {
      renditionRef.current.display(activeFile).catch(err => {
        console.warn("Could not navigate to file in Epubjs", err);
      });
    }
  }, [activeFile]); // Only do lightweight navigation when clicking sidebar files

  const handlePrev = () => renditionRef.current?.prev();
  const handleNext = () => renditionRef.current?.next();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', gap: '8px', padding: '8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', justifyContent: 'center' }}>
        <button className="btn" onClick={handlePrev}>← Prev Page</button>
        <button className="btn" onClick={handleNext}>Next Page →</button>
      </div>
      <div
        ref={viewerRef}
        className="preview-frame"
        style={{
          flex: 1,
          backgroundColor: "#fff", // E-readers are typically white
          color: "#000",
          overflow: "hidden"
        }}
      />
    </div>
  );
}
