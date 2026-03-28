/** Types shared between frontend components, mirroring Rust structs */

export interface SpineItem {
  idref: string;
  title: string;
  index: number;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

export interface OpenResult {
  title: string;
  author: string;
  language: string;
  spine: SpineItem[];
  file_tree: FileNode[];
  opf_dir: string;
}

export interface Term {
  id: string;
  ja: string;
  en: string;
  notes?: string | null;
  status: "pending" | "approved";
}

export interface LayoutFile {
  path: string;
  content: string;
}

export interface NewTerm {
  ja: string;
  en: string;
  notes?: string;
}

export interface TranslationResult {
  translated_xhtml: string;
  new_terms: NewTerm[];
}
