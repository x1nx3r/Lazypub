use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use thiserror::Error;
use zip::ZipArchive;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Error, Debug)]
pub enum EpubError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("XML parse error: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("XML attribute error: {0}")]
    XmlAttr(#[from] quick_xml::events::attributes::AttrError),
    #[error("UTF-8 error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("No OPF file found in container.xml")]
    NoOpfFound,
    #[error("Invalid EPUB structure: {0}")]
    InvalidStructure(String),
    #[error("Chapter not found: {0}")]
    ChapterNotFound(String),
}

// Make it serializable for Tauri IPC error propagation
impl Serialize for EpubError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Represents an unpacked EPUB project on disk.
pub struct EpubProject {
    /// The temp directory holding the extracted EPUB files.
    /// Kept alive so the directory isn't deleted until the project is dropped.
    pub _temp_dir: TempDir,
    /// Root path where EPUB contents are extracted.
    pub root_path: PathBuf,
    /// Path to the original .epub file that was opened.
    pub source_path: PathBuf,
    /// Parsed book manifest from the OPF file.
    pub manifest: BookManifest,
}

/// Parsed data from the content.opf file.
#[derive(Debug, Clone, Serialize)]
pub struct BookManifest {
    /// Book title from <dc:title>.
    pub title: String,
    /// Book author from <dc:creator>.
    pub author: String,
    /// Book language from <dc:language>.
    pub language: String,
    /// All manifest items keyed by their ID.
    pub items: HashMap<String, ManifestItem>,
    /// Ordered spine — the reading order of the book.
    pub spine: Vec<SpineItem>,
    /// Base directory of the OPF file (used to resolve relative hrefs).
    pub opf_dir: String,
}

/// A single item from the OPF <manifest>.
#[derive(Debug, Clone, Serialize)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
}

/// A single entry from the OPF <spine>.
#[derive(Debug, Clone, Serialize)]
pub struct SpineItem {
    pub idref: String,
    /// Resolved display title (derived from href basename).
    pub title: String,
    /// Index in spine order.
    pub index: usize,
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

/// Unpack an .epub file into a temporary directory and parse its manifest.
pub fn unpack_epub(epub_path: &Path) -> Result<EpubProject, EpubError> {
    let file = fs::File::open(epub_path)?;
    let mut archive = ZipArchive::new(file)?;

    let temp_dir = TempDir::new()?;
    let root = temp_dir.path().to_path_buf();

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let entry_path = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };

        let dest = root.join(&entry_path);

        if entry.is_dir() {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = fs::File::create(&dest)?;
            std::io::copy(&mut entry, &mut outfile)?;
        }
    }

    // Locate the OPF file via META-INF/container.xml
    let opf_relative = find_opf_path(&root)?;
    let opf_full = root.join(&opf_relative);
    let opf_dir = Path::new(&opf_relative)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let manifest = parse_opf(&opf_full, &opf_dir)?;

    Ok(EpubProject {
        _temp_dir: temp_dir,
        root_path: root,
        source_path: epub_path.to_path_buf(),
        manifest,
    })
}

/// Read the raw XHTML content of a chapter by its spine index.
pub fn read_chapter(project: &EpubProject, spine_index: usize) -> Result<String, EpubError> {
    let spine_item = project
        .manifest
        .spine
        .get(spine_index)
        .ok_or_else(|| EpubError::ChapterNotFound(format!("spine index {}", spine_index)))?;

    let manifest_item = project
        .manifest
        .items
        .get(&spine_item.idref)
        .ok_or_else(|| EpubError::ChapterNotFound(spine_item.idref.clone()))?;

    let chapter_path = if project.manifest.opf_dir.is_empty() {
        project.root_path.join(&manifest_item.href)
    } else {
        project
            .root_path
            .join(&project.manifest.opf_dir)
            .join(&manifest_item.href)
    };

    Ok(fs::read_to_string(&chapter_path)?)
}

/// Write modified XHTML content back to a chapter file.
pub fn save_chapter(
    project: &EpubProject,
    spine_index: usize,
    content: &str,
) -> Result<(), EpubError> {
    let spine_item = project
        .manifest
        .spine
        .get(spine_index)
        .ok_or_else(|| EpubError::ChapterNotFound(format!("spine index {}", spine_index)))?;

    let manifest_item = project
        .manifest
        .items
        .get(&spine_item.idref)
        .ok_or_else(|| EpubError::ChapterNotFound(spine_item.idref.clone()))?;

    let chapter_path = if project.manifest.opf_dir.is_empty() {
        project.root_path.join(&manifest_item.href)
    } else {
        project
            .root_path
            .join(&project.manifest.opf_dir)
            .join(&manifest_item.href)
    };

    fs::write(&chapter_path, content)?;
    Ok(())
}

/// Generic function to read any file content relative to the EPUB root
pub fn read_file(project: &EpubProject, rel_path: &str) -> Result<String, EpubError> {
    let full_path = project.root_path.join(rel_path);
    if !full_path.exists() {
        return Err(EpubError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "File not found",
        )));
    }
    Ok(fs::read_to_string(&full_path)?)
}

/// Generic function to save any file content relative to the EPUB root
pub fn save_file(project: &EpubProject, rel_path: &str, content: &str) -> Result<(), EpubError> {
    let full_path = project.root_path.join(rel_path);
    if !full_path.exists() {
        return Err(EpubError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "File not found",
        )));
    }
    fs::write(&full_path, content)?;
    Ok(())
}

/// Repackage the extracted EPUB back into a .epub file.
/// Follows EPUB spec: mimetype must be first entry, stored uncompressed.
pub fn repackage_epub(project: &EpubProject, output_path: &Path) -> Result<(), EpubError> {
    use std::io::Write;
    use zip::write::FileOptions;
    use zip::CompressionMethod;

    let file = fs::File::create(output_path)?;
    let mut zip_writer = zip::ZipWriter::new(file);

    // 1. Write mimetype first, uncompressed (EPUB spec requirement)
    let mimetype_path = project.root_path.join("mimetype");
    if mimetype_path.exists() {
        let options = FileOptions::<()>::default().compression_method(CompressionMethod::Stored);
        zip_writer.start_file("mimetype", options)?;
        let content = fs::read_to_string(&mimetype_path)?;
        zip_writer.write_all(content.as_bytes())?;
    }

    // 2. Write all other files with deflate compression
    let options = FileOptions::<()>::default().compression_method(CompressionMethod::Deflated);
    add_directory_to_zip(
        &mut zip_writer,
        &project.root_path,
        &project.root_path,
        &options,
    )?;

    zip_writer.finish()?;
    Ok(())
}

/// Repackage the extracted EPUB directly into a memory buffer instead of disk.
pub fn repackage_to_buffer(project: &EpubProject) -> Result<Vec<u8>, EpubError> {
    use std::io::Write;
    use zip::write::FileOptions;
    use zip::CompressionMethod;

    let mut cursor = std::io::Cursor::new(Vec::new());

    {
        let mut zip_writer = zip::ZipWriter::new(&mut cursor);

        // 1. Write mimetype first, uncompressed
        let mimetype_path = project.root_path.join("mimetype");
        if mimetype_path.exists() {
            let options =
                FileOptions::<()>::default().compression_method(CompressionMethod::Stored);
            zip_writer.start_file("mimetype", options)?;
            let content = fs::read_to_string(&mimetype_path)?;
            zip_writer.write_all(content.as_bytes())?;
        }

        // 2. Write all other files
        let options = FileOptions::<()>::default().compression_method(CompressionMethod::Deflated);
        add_directory_to_zip(
            &mut zip_writer,
            &project.root_path,
            &project.root_path,
            &options,
        )?;

        zip_writer.finish()?;
    }

    Ok(cursor.into_inner())
}

/// Fetch OPF and all CSS files for layout normalization
pub fn get_layout_files(project: &EpubProject) -> Result<Vec<LayoutFile>, EpubError> {
    let mut files = Vec::new();

    let opf_relative = find_opf_path(&project.root_path)?;
    let opf_content = fs::read_to_string(&project.root_path.join(&opf_relative))?;
    files.push(LayoutFile {
        path: opf_relative.clone(),
        content: opf_content,
    });

    for item in project.manifest.items.values() {
        if item.media_type == "text/css" {
            let path_relative = if project.manifest.opf_dir.is_empty() {
                item.href.clone()
            } else {
                format!("{}/{}", project.manifest.opf_dir, item.href)
            };

            let full_path = project.root_path.join(&path_relative);
            if full_path.exists() {
                let content = fs::read_to_string(&full_path)?;
                files.push(LayoutFile {
                    path: path_relative,
                    content,
                });
            }
        }
    }

    Ok(files)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

pub fn build_file_tree(root_path: &Path, current_path: &Path) -> Result<Vec<FileNode>, EpubError> {
    let mut nodes = Vec::new();
    if !current_path.is_dir() {
        return Ok(nodes);
    }

    for entry in fs::read_dir(current_path)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        let relative_path = path
            .strip_prefix(root_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace("\\", "/");

        let is_dir = path.is_dir();

        let children = if is_dir {
            Some(build_file_tree(root_path, &path)?)
        } else {
            None
        };

        nodes.push(FileNode {
            name,
            path: relative_path,
            is_dir,
            children,
        });
    }

    // Sort directories first, then alphabetically
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));

    Ok(nodes)
}

/// Recursively add files from a directory to the ZIP, skipping `mimetype`.
fn add_directory_to_zip<W: std::io::Write + std::io::Seek>(
    zip_writer: &mut zip::ZipWriter<W>,
    base_path: &Path,
    current_path: &Path,
    options: &zip::write::FileOptions<()>,
) -> Result<(), EpubError> {
    use std::io::Write;

    for entry in fs::read_dir(current_path)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base_path)
            .map_err(|e| EpubError::InvalidStructure(e.to_string()))?;

        let relative_str = relative.to_string_lossy().to_string();

        // Skip mimetype — already written first
        if relative_str == "mimetype" {
            continue;
        }

        if path.is_dir() {
            zip_writer.add_directory(&relative_str, options.clone())?;
            add_directory_to_zip(zip_writer, base_path, &path, options)?;
        } else {
            zip_writer.start_file(&relative_str, options.clone())?;
            let mut file = fs::File::open(&path)?;
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer)?;
            zip_writer.write_all(&buffer)?;
        }
    }

    Ok(())
}

/// Parse META-INF/container.xml to find the rootfile (OPF path).
fn find_opf_path(epub_root: &Path) -> Result<String, EpubError> {
    let container_path = epub_root.join("META-INF").join("container.xml");
    let xml_content = fs::read_to_string(&container_path)?;

    let mut reader = Reader::from_str(&xml_content);
    reader.config_mut().trim_text(true);

    loop {
        match reader.read_event() {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e))
                if e.local_name().as_ref() == b"rootfile" =>
            {
                for attr in e.attributes() {
                    let attr = attr?;
                    if attr.key.as_ref() == b"full-path" {
                        return Ok(String::from_utf8(attr.value.to_vec())?);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(EpubError::Xml(e)),
            _ => {}
        }
    }

    Err(EpubError::NoOpfFound)
}

/// Parse the OPF file to extract metadata, manifest items, and spine order.
fn parse_opf(opf_path: &Path, opf_dir: &str) -> Result<BookManifest, EpubError> {
    let xml_content = fs::read_to_string(opf_path)?;
    let mut reader = Reader::from_str(&xml_content);
    reader.config_mut().trim_text(true);

    let mut title = String::new();
    let mut author = String::new();
    let mut language = String::new();
    let mut items: HashMap<String, ManifestItem> = HashMap::new();
    let mut spine_idrefs: Vec<String> = Vec::new();

    // Track which element we're currently inside for text capture
    enum CurrentElement {
        None,
        Title,
        Creator,
        Language,
    }
    let mut current = CurrentElement::None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                match local.as_ref() {
                    b"title" => current = CurrentElement::Title,
                    b"creator" => current = CurrentElement::Creator,
                    b"language" => current = CurrentElement::Language,
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                match local.as_ref() {
                    b"item" => {
                        let mut id = String::new();
                        let mut href = String::new();
                        let mut media_type = String::new();

                        for attr in e.attributes() {
                            let attr = attr?;
                            match attr.key.as_ref() {
                                b"id" => id = String::from_utf8(attr.value.to_vec())?,
                                b"href" => href = String::from_utf8(attr.value.to_vec())?,
                                b"media-type" => {
                                    media_type = String::from_utf8(attr.value.to_vec())?
                                }
                                _ => {}
                            }
                        }

                        items.insert(
                            id.clone(),
                            ManifestItem {
                                id,
                                href,
                                media_type,
                            },
                        );
                    }
                    b"itemref" => {
                        for attr in e.attributes() {
                            let attr = attr?;
                            if attr.key.as_ref() == b"idref" {
                                spine_idrefs.push(String::from_utf8(attr.value.to_vec())?);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                let text = e
                    .unescape()
                    .map_err(|err| EpubError::Xml(err.into()))?
                    .to_string();
                match current {
                    CurrentElement::Title if title.is_empty() => title = text,
                    CurrentElement::Creator if author.is_empty() => author = text,
                    CurrentElement::Language if language.is_empty() => language = text,
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                match local.as_ref() {
                    b"title" | b"creator" | b"language" => current = CurrentElement::None,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(EpubError::Xml(e)),
            _ => {}
        }
    }

    // Build spine with display titles from manifest hrefs
    let spine: Vec<SpineItem> = spine_idrefs
        .into_iter()
        .enumerate()
        .map(|(index, idref)| {
            let display_title = items
                .get(&idref)
                .map(|item| {
                    Path::new(&item.href)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| item.href.clone())
                })
                .unwrap_or_else(|| idref.clone());

            SpineItem {
                idref,
                title: display_title,
                index,
            }
        })
        .collect();

    Ok(BookManifest {
        title,
        author,
        language,
        items,
        spine,
        opf_dir: opf_dir.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_container_xml() {
        let dir = TempDir::new().unwrap();
        let meta_inf = dir.path().join("META-INF");
        fs::create_dir_all(&meta_inf).unwrap();
        fs::write(
            meta_inf.join("container.xml"),
            r#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .unwrap();

        let result = find_opf_path(dir.path()).unwrap();
        assert_eq!(result, "OEBPS/content.opf");
    }

    #[test]
    fn test_parse_opf() {
        let dir = TempDir::new().unwrap();
        let oebps = dir.path().join("OEBPS");
        fs::create_dir_all(&oebps).unwrap();

        let opf_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="ch01" href="chapter01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch02" href="chapter02.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch01"/>
    <itemref idref="ch02"/>
  </spine>
</package>"#;

        fs::write(oebps.join("content.opf"), opf_content).unwrap();

        let manifest = parse_opf(&oebps.join("content.opf"), "OEBPS").unwrap();

        assert_eq!(manifest.title, "Test Book");
        assert_eq!(manifest.author, "Test Author");
        assert_eq!(manifest.language, "ja");
        assert_eq!(manifest.items.len(), 3);
        assert_eq!(manifest.spine.len(), 2);
        assert_eq!(manifest.spine[0].idref, "ch01");
        assert_eq!(manifest.spine[0].title, "chapter01");
        assert_eq!(manifest.spine[1].idref, "ch02");
    }
}
