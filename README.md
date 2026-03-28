# Lazypub: The EPUB Laziness Suite

Congratulations. You found a way to avoid actually reading Japanese while pretending you're "working" on a translation. Lazypub is a workbench for people who want to let AI do the heavy lifting of EPUB translation and layout normalization because manually editing XHTML is a special kind of hell.

With the new persistent architecture, Lazypub has moved past the "volatile memory" phase of its life. Projects are now actual folders on your hard drive, just like a real developer would have.

## Installation

### Arch Linux (AUR)
If you are on Arch, you can build the package using the provided PKGBUILD in the arch-build directory:
```bash
git clone https://github.com/x1nx3r/Lazypub.git
cd Lazypub/arch-build
makepkg -si
```

### Debian / Ubuntu
Download the latest .deb file from the Releases page and install it:
```bash
sudo apt install ./lazypub_0.1.2_amd64.deb
```

### Generic Linux (AppImage)
Download the .AppImage from the Releases page, make it executable, and run it.

## Key Features

- **Persistent Workspace Architecture**: Gone are the days of losing your progress because you closed the app. Import an EPUB into a dedicated folder, and all your HTML, CSS, and Glossary progress will be saved right there.
- **Recent Projects Dashboard**: The home screen tracks your last 10 project folders. One click and you're back to where you left off, assuming you haven't deleted the folder in a fit of rage.
- **Sarcastic Thinking Engine**: Since AI API calls take time, we've implemented a state-of-the-art "Thinking" system that provides deadpan, sarcastic feedback about the state of the software's simulated thought process while the models actually do the work.
- **XHTML Normalization**: AI fixes the messy CSS and OPF files that some publishers thought were a good idea. It's like a hazmat suit for your EPUB's structure.
- **Entity Extraction & Reconcile**: Automatically finds character names and locations, then crawls Japanese wikis to figure out who "That One Guy" actually is.
- **Glossary Persistence**: Your glossary (glossary.json) lives in your project root. Version control it, edit it manually, or just look at it to feel productive.
- **Translation Loop**: Translates chapter-by-chapter while strictly preserving XML tags. It even suggests new glossary terms so you can feel useful while clicking "Approve".

## The Workflow (How to not learn Japanese)

### 0. The Setup (Manual Configuration)
Go to the Settings page. This is where you put your Google AI Studio key. 
- **Model Selection**: You can set different Gemini models for Extraction, Translation, and Normalization. Use Flash for speed or Pro for those particularly stubborn Japanese structures.
- **Wiki Integration**: To assist the Entity Extraction, paste a link to a fandom wiki or similar Japanese resource (e.g., https://typemoon.fandom.com/). 
- **Developer Mode**: Toggle this to see the raw JSON requests and responses in your terminal. Disable it if you'd rather not see how the sausage is made.

### 1. The Import (Creating a Workspace)
Click **Import EPUB**. Select your target .epub and then pick an **empty folder** on your system. Lazypub will unpack everything there. This folder is now your persistent project root.

### 2. The Exorcism (Normalize Layout)
If your book is a vertical-RL disaster, click **Normalize Layout**. Gemini will rewrite the CSS and OPF to be horizontal-TB. This saves you from hours of manual Regex and existential dread.

### 3. The Harvest (Extract & Reconcile)
Open a chapter from the file tree. Click **Extract Entities**. Gemini will scan for proper nouns. It then checks your configured Wiki URL to map them to official English spellings and provide context.

### 4. The Audit (Glossary Management)
Go to the **Glossary** tab. You'll see "Pending" terms. Actually review them. Only "Approved" terms are used to guide the translation loop. If you skip this, expect the protagonist to have three different names by page ten.

### 5. The Heavy Lifting (Translate)
Click **Translate**. Gemini takes your approved terms and the raw XHTML. It translates the prose but leaves the structure intact. New terms found during translation are added to your Glossary as pending.

### 6. The Freedom (Export)
Once you've finished your masterpiece, click **Export EPUB**. Lazypub bundles your current folder state back into a valid .epub file for your E-reader.

## Getting an API Key
Since we aren't paying for your electricity, you'll need your own Google AI Studio key from [Google AI Studio](https://aistudio.google.com/).

## Build Instructions
This is a Tauri app (Vite + React + Rust).

```bash
bun install
bun run tauri dev
```

Good luck. You'll need it.
