import { useState } from "react";
import { FileNode } from "../types";
import { 
  Folder, 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  FileCode, 
  Image as ImageIcon, 
  File 
} from "lucide-react";

interface SidebarProps {
  fileTree: FileNode[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

function FileTreeItem({ node, level, activeFile, onSelectFile }: { node: FileNode, level: number, activeFile: string | null, onSelectFile: (path: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const indentation = level * 12;

  if (node.is_dir) {
    return (
      <div className="file-tree-dir">
        <div 
          className="file-tree-item" 
          style={{ paddingLeft: `${indentation + 12}px` }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="file-tree-item__icon">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="file-tree-item__icon">
            <Folder size={14} />
          </span>
          <span className="file-tree-item__label">{node.name}</span>
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
  const isHtml = node.name.match(/\.x?html?$/i);
  
  let Icon = File;
  if (isImage) Icon = ImageIcon;
  else if (isCss) Icon = FileCode;
  else if (isHtml) Icon = FileText;

  return (
    <div 
      className={`file-tree-item ${isActive ? "file-tree-item--active" : ""}`}
      style={{ paddingLeft: `${indentation + 32}px` }}
      onClick={() => onSelectFile(node.path)}
    >
      <span className="file-tree-item__icon">
        <Icon size={14} />
      </span>
      <span className="file-tree-item__label">{node.name}</span>
    </div>
  );
}

export function Sidebar({ fileTree, activeFile, onSelectFile }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__title">Explorer</div>
      </div>
      <div className="sidebar__files">
        <div className="file-tree">
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
      </div>
    </aside>
  );
}
