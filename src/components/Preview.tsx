import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import ePub, { Rendition } from "epubjs";

import { convertFileSrc } from "@tauri-apps/api/core";

interface PreviewProps {
  projectDir: string | null;
  activeFile: string | null;
  opfDir: string | null;
  refreshKey?: number;
  onLocationChange?: (info: { index: number; total: number; label: string }) => void;
  onFileChange?: (path: string) => void;
}

export interface PreviewHandle {
  next: () => void;
  prev: () => void;
  zoom: (delta: number) => void;
  jumpTo: (href: string) => void;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(({ projectDir, activeFile, opfDir, refreshKey, onLocationChange, onFileChange }, ref) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [_fontSize, setFontSize] = useState(100);

  // Helper to normalize path relative to OPF dir
  const normalizePath = (path: string) => {
    if (!opfDir) return path;
    const prefix = opfDir.endsWith('/') ? opfDir : `${opfDir}/`;
    if (path.startsWith(prefix)) {
      return path.substring(prefix.length);
    }
    return path;
  };

  // Helper to restore absolute ZIP path from OPF-relative path
  const restorePath = (path: string) => {
    if (!opfDir) return path;
    const prefix = opfDir.endsWith('/') ? opfDir : `${opfDir}/`;
    return prefix + path;
  };

  const displayFile = (path: string) => {
    if (!renditionRef.current) return;
    const normalized = normalizePath(path);
    renditionRef.current.display(normalized).catch(() => {
      // Fallback to original if normalized fails
      renditionRef.current?.display(path).catch(err => {
        console.warn("EpubJS navigation failed completely:", err);
      });
    });
  };

  useImperativeHandle(ref, () => ({
    next: () => renditionRef.current?.next(),
    prev: () => renditionRef.current?.prev(),
    zoom: (delta: number) => {
      setFontSize(prev => {
        const next = Math.min(Math.max(prev + delta, 50), 250);
        renditionRef.current?.themes.fontSize(`${next}%`);
        return next;
      });
    },
    jumpTo: (href: string) => {
      displayFile(href);
    }
  }));

  useEffect(() => {
    if (!projectDir || !viewerRef.current) return;

    let normalizedPath = projectDir.replace(/\\/g, '/');
    let safeUrl = convertFileSrc(normalizedPath);
    
    // Ensure URL has trailing slash so epubjs treats it as a directory root
    if (!safeUrl.endsWith('/')) {
        safeUrl += '/';
    }

    const book = ePub(safeUrl);
    viewerRef.current.innerHTML = "";

    const rendition = book.renderTo(viewerRef.current, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
      allowScriptedContent: true,
    });
    renditionRef.current = rendition;

    // Track location changes
    rendition.on("relocated", (location: any) => {
      // Check if file has changed (autonext)
      if (onFileChange && location.start.href) {
        const zipPath = restorePath(location.start.href);
        // We compare with the prop directly to avoid loops
        if (zipPath !== activeFile) {
          onFileChange(zipPath);
        }
      }

      if (onLocationChange && book.locations) {
        const locs = book.locations as any;
        const index = locs.locationFromCfi(location.start.cfi);
        const total = locs.length();
        const label = location.start.displayed.page || (typeof index === 'number' ? index + 1 : 1);
        onLocationChange({ index: Number(index), total, label: label.toString() });
      }
    });

    book.ready.then(() => {
      const spine = (book.spine as any);
      const items = spine.items || (spine.spineItems);
      console.log("EpubJS Spine Items:", items ? items.map((i: any) => i.href) : "unknown");
      
      return book.locations.generate(1024);
    }).then(() => {
      if (activeFile && activeFile.match(/\.x?html?$/i)) {
        displayFile(activeFile);
      } else {
        rendition.display();
      }
    }).catch(err => {
      console.error("EpubJS initialization error:", err);
    });

    return () => {
      book.destroy();
    };
  }, [projectDir, refreshKey]);

  useEffect(() => {
    if (renditionRef.current && activeFile) {
      const isRenderable = activeFile.match(/\.x?html?$/i);
      if (isRenderable) {
        displayFile(activeFile);
      }
    }
  }, [activeFile]);

  return (
    <div
      ref={viewerRef}
      className="preview-frame"
      style={{
        flex: 1,
        backgroundColor: "#fff",
        color: "#000",
        overflow: "hidden",
        paddingBottom: "100px" // More space for the toolbox
      }}
    />
  );
});
