use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum WikiError {
    #[error("Request error: {0}")]
    Request(#[from] reqwest::Error),
}

impl Serialize for WikiError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Deserialize, Debug)]
struct QueryResponse {
    query: Option<QueryData>,
}

#[derive(Deserialize, Debug)]
struct QueryData {
    pages: Option<std::collections::HashMap<String, PageData>>,
    search: Option<Vec<SearchResult>>,
}

#[derive(Deserialize, Debug)]
struct PageData {
    revisions: Option<Vec<RevisionData>>,
}

#[derive(Deserialize, Debug)]
struct RevisionData {
    #[serde(rename = "*")]
    content: Option<String>,
}

#[derive(Deserialize, Debug)]
struct SearchResult {
    title: String,
}

/// Helper to ensure the API URL is properly formatted for MediaWiki
fn build_api_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("api.php") {
        base.to_string()
    } else {
        format!("{}/api.php", base)
    }
}

/// Search the wiki for a specific Japanese term
pub async fn query_wiki_search(
    wiki_url: &str,
    query: &str,
    devel_mode: bool,
) -> Result<Vec<String>, WikiError> {
    let url = build_api_url(wiki_url);
    let client = Client::new();

    let req = client.get(&url).query(&[
        ("action", "query"),
        ("list", "search"),
        ("srsearch", query),
        ("format", "json"),
        ("utf8", "1"),
    ]);

    crate::devel_log(devel_mode, &format!(">>> [Wiki API] Search GET: {:?}", req));

    let res = req.send().await?;
    let text = res.text().await.unwrap_or_default();

    crate::devel_log(
        devel_mode,
        &format!("<<< [Wiki API] Search Response JSON:\n{}", text),
    );

    let json: QueryResponse = serde_json::from_str(&text).unwrap_or(QueryResponse { query: None });

    let mut results = Vec::new();
    if let Some(query_data) = json.query {
        if let Some(search) = query_data.search {
            for item in search {
                results.push(item.title);
            }
        }
    }

    Ok(results)
}

/// Scrape the raw Markdown/Wikitext content of a specific page
pub async fn scrape_wiki_page(
    wiki_url: &str,
    title: &str,
    devel_mode: bool,
) -> Result<String, WikiError> {
    let url = build_api_url(wiki_url);
    let client = Client::new();

    let req = client.get(&url).query(&[
        ("action", "query"),
        ("prop", "revisions"),
        ("rvprop", "content"),
        ("rvslots", "main"),
        ("titles", title),
        ("format", "json"),
        ("utf8", "1"),
    ]);

    crate::devel_log(devel_mode, &format!(">>> [Wiki API] Scrape GET: {:?}", req));

    let res = req.send().await?;
    let text = res.text().await.unwrap_or_default();

    crate::devel_log(
        devel_mode,
        &format!("<<< [Wiki API] Scrape Response JSON:\n{}", text),
    );

    let json: QueryResponse = serde_json::from_str(&text).unwrap_or(QueryResponse { query: None });

    if let Some(query_data) = json.query {
        if let Some(pages) = query_data.pages {
            // Get the first (and usually only) page from the map
            if let Some((_, page)) = pages.into_iter().next() {
                if let Some(revisions) = page.revisions {
                    if let Some(rev) = revisions.into_iter().next() {
                        if let Some(content) = rev.content {
                            return Ok(content);
                        }
                    }
                }
            }
        }
    }

    Ok(String::new())
}
