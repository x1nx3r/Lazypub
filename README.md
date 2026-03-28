# Lazypub

Congratulations. You found a way to avoid actually reading Japanese while pretending you're "working" on a translation. Lazypub is a workbench for people who want to let AI do the heavy lifting of EPUB translation and layout normalization because manually editing XHTML is a special kind of hell.

## What this actually does
*   **XHTML Normalization**: AI fixes the messy CSS and OPF files that some publishers thought were a good idea. It's like a hazmat suit for your EPUB's structure.
*   **Entity Extraction**: Automatically finds proper nouns so you don't have to Google things yourself.
*   **Wiki-Crawl**: Crawls Japanese wikis to provide context for those obscure terms you definitely didn't know.
*   **Translation Loop**: Translates chapter-by-chapter while strictly preserving tags. It even suggests new glossary terms so you can feel productive while clicking "Approve".
*   **EPUB Export**: Packages everything back into a real `.epub` file so you can finally put it on your E-reader and forget you ever used this app.

## How you're gonna be using this (The Workflow)

Assuming you've actually managed to get an API key and haven't given up yet, here is how you actually translate a book without learning a single Kanji.
0.  **The Setup** : On the setting page you can setup several fields, first put the api key you got from Google AI Studio there, then to setup the entity extration properly get the link of a fandom wiki of the series you wanna translate, say if you wanna translate a Fate Strange Fake novel, you'd put `https://typemoon.fandom.com/` into the field. You can also toggle the developer mode to see what you sends and what the AI sends back. Just disable it, ignorance is a bliss
1.  **The Sacrifice**: Click **Open EPUB** and feed it a Japanese novel. If it's a messy "KADOKAWA" or "Syosetu" export, prepare for the next step.
2.  **The Exorcism**: Click **🪄 Normalize Layout**. This sends the entire CSS and OPF structure to Gemini. It will rewrite them to be "normal" (i.e., readable by Epub.js and not a complete disaster). It saves you from 3 hours of manual Regex.
3.  **The Harvest**: Open a chapter from the file tree. Click **✨ Extract Entities**. Gemini will scan the text for proper nouns, names, and places. It then crawls Japanese wikis to figure out who "That One Guy" actually is.
4.  **The Audit**: Go to the **Glossary** tab. You'll see a bunch of "Pending" terms. Actually look at them. If the translation is wrong, fix it. Set them to **Approved**. Only approved terms are used to guide the translation, so if you skip this, don't complain when the protagonist's name changes three times in one paragraph.
5.  **The Heavy Lifting**: Click **🌐 Translate**. Gemini takes your approved glossary and the raw XHTML. It translates the prose but leaves the tags alone (usually).
6.  **The Manual Labor**: The translated text replaces your editor content but **isn't saved yet**. Read it. If Gemini hallucinated a new character, fix it in the editor.
7.  **The Committal**: Click **Save**. This updates the internal file tree and refreshes the **Preview** tab. You can now actually see what the page looks like.
8.  **The Rinse and Repeat**: Do this for every chapter. Yes, all of them. AI is fast, but it doesn't has a "Translate Entire Book and Make me a Sandwich" button yet.
9.  **The Freedom**: Once you've finished the last chapter, click **💾 Export EPUB**. Give it a filename and you're done. Go outside.

## Getting an API Key (The "I'm broke" speedrun)
Since we aren't paying for your electricity, you'll need your own Google AI Studio key.

1.  Go to [Google AI Studio](https://aistudio.google.com/).
2.  Click the "Get API key" button that is probably staring you in the face.
3.  Create a project (or just use the default one, we don't care).
4.  Copy that string of random characters.
5.  Paste it into the ⚙️ Settings in Lazypub.

## Model Advice
If you value your sanity and your wallet:
*   **Use `models/gemini-3.1-flash`**: It's fast, it's basically free at low volumes, and it's plenty smart enough for this. 
*   **Avoid the "Pro" models**: You won't have access to it anyway if you're on free tier
*   **Track your usage** : You can track your usage on the same place you get your api from

## How to build (if you must)
This is a [Tauri](https://tauri.app/) app. You'll need Rust and Node.js.

```bash
bun install
bun run tauri dev
```

Good luck. You'll need it.
