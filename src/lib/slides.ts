/**
 * Slideshow basics: split a markdown document into pages at headings
 * (Obsidian Slides style — each H1/H2 starts a new slide).
 */

export interface Slide {
  /** Page title (the heading text, or "Slide N" when none). */
  title: string;
  /** Full page source including its heading line. */
  content: string;
}

/** Split markdown into slides. Fenced code blocks are tracked so a `#` inside
 *  a fence never starts a page. A doc with no headings is a single slide. */
export function splitSlides(markdown: string): Slide[] {
  const slides: Slide[] = [];
  const lines = markdown.split("\n");
  let inFence = false;
  let current: string[] = [];
  let currentTitle = "";

  const flush = () => {
    if (current.length > 0 || slides.length > 0 || currentTitle) {
      slides.push({ title: currentTitle || `Slide ${slides.length + 1}`, content: current.join("\n") });
    }
    current = [];
    currentTitle = "";
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        flush();
        currentTitle = m[2].trim();
        current.push(line);
        continue;
      }
    }
    current.push(line);
  }
  flush();

  // A heading-only slide with no body is still a slide; the flush above
  // created it. Trim trailing empty slides.
  while (slides.length > 0 && slides[slides.length - 1].content.trim() === "") {
    slides.pop();
  }
  return slides.length > 0 ? slides : [{ title: "Slide 1", content: markdown }];
}