use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GlossaryError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for GlossaryError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Term {
    pub id: String,
    pub ja: String,
    pub en: String,
    pub notes: Option<String>,
    pub status: TermStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TermStatus {
    Pending,
    Approved,
}

impl Default for TermStatus {
    fn default() -> Self {
        Self::Pending
    }
}

pub type Glossary = Vec<Term>;

/// Load the glossary.json from the given EPUB project root
pub fn load_glossary(project_root: &Path) -> Result<Glossary, GlossaryError> {
    let glossary_path = project_root.join("glossary.json");
    if !glossary_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&glossary_path)?;
    let glossary = serde_json::from_str(&content)?;
    Ok(glossary)
}

/// Save the glossary back to glossary.json in the EPUB project root
pub fn save_glossary(project_root: &Path, glossary: &Glossary) -> Result<(), GlossaryError> {
    let glossary_path = project_root.join("glossary.json");
    let content = serde_json::to_string_pretty(glossary)?;
    fs::write(&glossary_path, content)?;
    Ok(())
}
