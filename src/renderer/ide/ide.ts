import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";

declare global {
  interface Window {
    ide?: {
      open: () => void;
      close: () => void;
      minimize: () => void;
      toggleMaximize: () => void;
      pickFolder: () => Promise<string | null>;
      readDir: (dirPath: string) => Promise<IdeDirEntry[]>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      getFileInfo: (filePath: string) => Promise<{ isDirectory: boolean; size: number }>;
    };
  }
}

interface IdeDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: IdeDirEntry[];
}

const openFolderBtn = document.getElementById("open-folder-btn") as HTMLButtonElement;
const folderPathEl = document.getElementById("folder-path") as HTMLSpanElement;
const fileTreeEl = document.getElementById("file-tree") as HTMLElement;
const editorEl = document.getElementById("editor") as HTMLElement;
const statusBarEl = document.getElementById("status-bar") as HTMLElement;

document.getElementById("min-btn")?.addEventListener("click", () => window.ide?.minimize());
document.getElementById("max-btn")?.addEventListener("click", () => window.ide?.toggleMaximize());
document.getElementById("close-btn")?.addEventListener("click", () => window.ide?.close());

let currentFolder = "";
let currentFile = "";
let editorView: EditorView | null = null;

function detectLanguage(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
      return javascript({ typescript: ext === "ts" || ext === "tsx", jsx: ext === "jsx" || ext === "tsx" });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
    case "htm":
      return html();
    case "md":
    case "markdown":
      return markdown();
    default:
      return [];
  }
}

function createEditor(initialContent = "", filePath = "") {
  if (editorView) {
    editorView.destroy();
  }
  const extensions = [
    lineNumbers(),
    oneDark,
    keymap.of([...defaultKeymap, indentWithTab]),
    detectLanguage(filePath),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && currentFile) {
        statusBarEl.textContent = `已修改: ${currentFile}`;
      }
    }),
  ];
  editorView = new EditorView({
    state: EditorState.create({ doc: initialContent, extensions }),
    parent: editorEl,
  });
}

async function openFile(filePath: string) {
  try {
    const content = await window.ide!.readFile(filePath);
    currentFile = filePath;
    createEditor(content, filePath);
    statusBarEl.textContent = filePath;
  } catch (err) {
    statusBarEl.textContent = `读取失败: ${String(err)}`;
  }
}

function buildTree(entries: IdeDirEntry[], container: HTMLElement, level = 0) {
  const ul = document.createElement("ul");
  ul.className = "ide__tree-list";
  ul.style.paddingLeft = level === 0 ? "0" : "12px";

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "ide__tree-item";

    const span = document.createElement("span");
    span.className = entry.isDirectory ? "ide__tree-folder" : "ide__tree-file";
    span.textContent = entry.name;
    span.title = entry.path;

    if (entry.isDirectory) {
      span.addEventListener("click", async () => {
        const expanded = li.classList.toggle("is-expanded");
        if (expanded && !li.dataset.loaded) {
          const children = await window.ide!.readDir(entry.path);
          buildTree(children, li, level + 1);
          li.dataset.loaded = "true";
        }
      });
    } else {
      span.addEventListener("click", () => openFile(entry.path));
    }

    li.appendChild(span);
    ul.appendChild(li);
  }

  container.appendChild(ul);
}

async function loadFolder(dirPath: string) {
  currentFolder = dirPath;
  folderPathEl.textContent = dirPath;
  fileTreeEl.innerHTML = "";
  statusBarEl.textContent = "加载中...";
  try {
    const entries = await window.ide!.readDir(dirPath);
    buildTree(entries, fileTreeEl);
    statusBarEl.textContent = `已打开: ${dirPath}`;
  } catch (err) {
    statusBarEl.textContent = `加载失败: ${String(err)}`;
  }
}

openFolderBtn.addEventListener("click", async () => {
  const folder = await window.ide?.pickFolder();
  if (folder) await loadFolder(folder);
});

createEditor(`// Columbina IDE Spike\n// 点击"打开文件夹"开始浏览代码。`, "");
statusBarEl.textContent = "Columbina IDE Spike 就绪";
