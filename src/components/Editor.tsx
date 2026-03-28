import MonacoEditor from "@monaco-editor/react";

interface EditorProps {
  content: string;
  language?: string;
  onChange: (value: string) => void;
}

export function Editor({ content, language = "xml", onChange }: EditorProps) {
  return (
    <MonacoEditor
      height="100%"
      language={language}
      theme="vs-dark"
      value={content}
      onChange={(value) => onChange(value ?? "")}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        minimap: { enabled: false },
        lineNumbers: "on",
        wordWrap: "on",
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 80 },
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        automaticLayout: true,
        tabSize: 2,
      }}
    />
  );
}
