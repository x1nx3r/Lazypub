import { useState } from "react";
import { FileNode } from "../types";

interface SidebarProps {
  fileTree: FileNode[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

function FileTreeItem({ node, level, activeFile, onSelectFile }: { node: FileNode, level: number, activeFile: string | null, onSelectFile: (path: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  
  if (node.is_dir) {
    return (
      <div className="file-tree-dir">
        <div 
          className="file-tree-item" 
          style={{ paddingLeft: `${level * 12 + 8}px`, paddingRight: "8px", paddingTop: "4px", paddingBottom: "4px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", opacity: 0.8 }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span style={{ fontSize: "10px", width: "12px", textAlign: "center" }}>{isOpen ? "▼" : "▶"}</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div className="file-tree-children">
            {node.children.map((child, i) => (
              <FileTreeItem 
                key={i} 
                node={child} 
                level={level + 1} 
                activeFile={activeFile} 
                onSelectFile={onSelectFile} 
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  const isImage = node.name.match(/\.(jpg|jpeg|png|gif|svg)$/i);
  const isCss = node.name.match(/\.css$/i);
  const icon = isImage ? "[IMG]" : isCss ? "[CSS]" : "[TXT]";

  return (
    <div 
      className={`file-tree-item ${isActive ? "active" : ""}`}
      style={{ 
        paddingLeft: `${level * 12 + 26}px`, 
        paddingRight: "8px",
        paddingTop: "6px",
        paddingBottom: "6px",
        cursor: "pointer", 
        display: "flex", 
        alignItems: "center", 
        gap: "6px",
        background: isActive ? "var(--bg-tertiary)" : "transparent",
        color: isActive ? "var(--text-color)" : "var(--text-muted)",
        borderLeft: isActive ? "2px solid var(--accent-color)" : "2px solid transparent"
      }}
      onClick={() => onSelectFile(node.path)}
    >
      <span style={{ fontSize: "11px", color: "var(--text-muted)", width: "32px" }}>{icon}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "13px" }}>{node.name}</span>
    </div>
  );
}

export function Sidebar({ fileTree, activeFile, onSelectFile }: SidebarProps) {
  return (
    <aside className="sidebar" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="sidebar__header" style={{ padding: "16px", borderBottom: "1px solid var(--border-color)", borderRight: "1px solid var(--border-color)" }}>
        <div className="sidebar__title" style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)" }}>Explorer</div>
      </div>
      <div className="sidebar__files" style={{ flex: 1, overflowY: "auto", padding: "8px 0", borderRight: "1px solid var(--border-color)" }}>
        {fileTree.map((node, i) => (
          <FileTreeItem 
            key={i} 
            node={node} 
            level={0} 
            activeFile={activeFile} 
            onSelectFile={onSelectFile} 
          />
        ))}
      </div>
    </aside>
  );
}
