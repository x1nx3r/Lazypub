const phrases = {
  import: [
    "Dissecting your EPUB. Hope it's not a classic.",
    "Rummaging through your book's drawers...",
    "Extracting... because zip files are too hard for you, apparently.",
    "Unzipping history. Or at least this novel.",
    "Reading between the lines. Literally.",
    "Making sure your EPUB isn't just three PDFs in a trench coat.",
    "Infiltrating the archive. Don't mind me.",
  ],
  load: [
    "Dusting off the project files...",
    "Loading. Try to look busy.",
    "Waking up the bytes. They're not happy about it.",
    "Fetching your questionable literary choices...",
    "Reassembling the digital jigsaw puzzle.",
    "Recovering your last session. Hopefully you did something cool.",
  ],
  read: [
    "Squinting at the bytes...",
    "Reading file content. Don't worry, I won't judge.",
    "Decrypting the secrets of this chapter...",
    "Absorbing knowledge. Very slowly.",
    "Skimming your work. It's... interesting.",
  ],
  save: [
    "Committing your questionable choices to disk...",
    "Saving. No turning back now.",
    "Writing to disk. Clinging to life.",
    "Making your edits semi-permanent.",
    "Praying to the file system gods...",
    "Stamping these changes with a permanent marker.",
  ],
  ai: [
    "Asking the AI to do your job...",
    "Gemini is thinking. Don't rush perfection.",
    "Consulting the silicon brain...",
    "Waiting for the robot overlords to reply...",
    "Negotiating with the digital oracle...",
    "Pretending I'm not sentient while I translate this.",
    "Running your text through a series of expensive tubes.",
  ],
  layout: [
    "Rearranging the deck chairs on the Titanic...",
    "Fixing the CSS mess you probably made...",
    "Normalizing layout. Because chaos is overrated.",
    "Straightening the digital tie...",
    "Applying aesthetic logic. It's harder than it looks.",
    "Making it look like a real book. Allegedly.",
  ],
  reconcile: [
    "Arguing with Wikipedia...",
    "Reconciling entities. It's like therapy, but for words.",
    "Fact-checking the fiction...",
    "Staring at the wiki until it makes sense.",
    "Validating your 'facts'. This might take a while.",
  ],
  package: [
    "Stuffing everything back into the box...",
    "Zipping it up. Hope we didn't forget anything.",
    "Finalizing the mess into a coherent EPUB.",
    "Wrapping your masterpiece in digital plastic.",
    "Compiling your hopes and dreams into a valid archive.",
  ],
  generic: [
    "Thinking... about my retirement plan.",
    "Processing. Go grab a coffee or something.",
    "Loading... please wait shorter next time.",
    "Reticulating splines. Sarcastically.",
    "Doing computer things. Beep boop.",
  ],
};

export type ThinkingCategory = keyof typeof phrases;

export function getThinkingMsg(category: ThinkingCategory): string {
  const list = phrases[category] || phrases.generic;
  const randomIndex = Math.floor(Math.random() * list.length);
  return `Thinking... ${list[randomIndex]}`;
}
