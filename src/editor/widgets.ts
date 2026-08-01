import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { renderMarkdown, highlightCode } from "./markdown";
import { markdownContextFacet, imageToSrc } from "./media";

export class CodeBlockWidget extends WidgetType {
  readonly language: string;

  constructor(
    readonly code: string,
    lang: string,
  ) {
    super();
    this.language = lang.toLowerCase();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.code === this.code && other.language === this.language;
  }

  toDOM(_view: EditorView): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "cm-codeblock";

    if (this.language) {
      const tag = document.createElement("div");
      tag.className = "cm-codeblock-lang";
      tag.textContent = this.language;
      pre.appendChild(tag);
    }

    const code = document.createElement("code");
    code.innerHTML = highlightCode(this.code, this.language);
    pre.appendChild(code);
    return pre;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(_view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-table";
    div.innerHTML = renderMarkdown(this.raw);
    return div;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(_view: EditorView): HTMLElement {
    const label = document.createElement("label");
    label.className = "cm-task-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = true; // clicks handled by CM6 event handler
    label.appendChild(input);
    return label;
  }

  ignoreEvent(e: Event): boolean {
    return e.type === "mousedown" || e.type === "mouseup" || e.type === "click";
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-image-wrap";

    const img = document.createElement("img");
    img.className = "cm-image";
    img.alt = this.alt;
    // Some CDNs (e.g. Aliyun OSS / nlark) enable hotlink protection and reject
    // requests carrying a Referer. Strip it so remote images load.
    img.referrerPolicy = "no-referrer";
    const ctx = view.state.facet(markdownContextFacet)[0];
    img.src = imageToSrc(this.src, ctx);

    img.addEventListener("error", () => {
      wrap.classList.add("cm-image-broken");
      const placeholder = document.createElement("span");
      placeholder.className = "cm-image-placeholder";
      placeholder.textContent = `[图片: ${this.src}]`;
      placeholder.title = "图片加载失败：文件不存在或路径错误";
      wrap.replaceChild(placeholder, img);
    });

    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
