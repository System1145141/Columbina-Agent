import { linter, type Diagnostic } from "@codemirror/lint";
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip, keymap, ViewPlugin, EditorView, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, EditorState, type Extension, type Text } from "@codemirror/state";
import { getLspClient, removeLspClient, type LspClient, type LspDiagnostic, type LspRange } from "../services/lsp-client";
import { state, subscribe, notify, setLspDiagnostics, getLspDiagnostics, getRootForPath, getLanguageIdForFile, EXT_TO_LANGUAGE_ID, type IdeSearchResult, type OutlineSymbol } from "../services/state";
import { getFileExtension, openFileAt, readFile, writeFile, encodeLineEndings } from "../services/file-service";
import { showReferencesResults } from "./file-tree";

let lastLspRootsKey = "";
subscribe(() => {
  const key = state.roots.map((r) => r.id).join("|");
  if (key === lastLspRootsKey) return;
  const prevIds = new Set(lastLspRootsKey ? lastLspRootsKey.split("|") : []);
  lastLspRootsKey = key;
  for (const id of prevIds) {
    if (!state.roots.some((r) => r.id === id)) {
      for (const languageId of Object.values(EXT_TO_LANGUAGE_ID)) {
        removeLspClient(languageId, id);
      }
    }
  }
});

export function getLanguageId(filePath: string): string | null {
  return getLanguageIdForFile(filePath);
}

function filePathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("file://")) return normalized;
  return `file://${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function uriToFilePath(uri: string): string {
  let p: string;
  if (uri.startsWith("file:///")) {
    p = uri.slice("file:///".length);
    // Windows: file:///C:/... → C:/...; Unix: file:///path → /path
    p = /^[A-Za-z]:/.test(p) ? p : `/${p}`;
  } else if (uri.startsWith("file://")) {
    // file://host/path → /path (忽略 host)
    p = uri.slice("file://".length);
    const slash = p.indexOf("/");
    p = slash >= 0 ? p.slice(slash) : "";
  } else {
    p = uri;
  }
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function cmPosToLsp(doc: Text, pos: number): { line: number; character: number } {
  const lineObj = doc.lineAt(pos);
  return { line: lineObj.number - 1, character: pos - lineObj.from };
}

function lspPosToCm(doc: Text, pos: { line: number; character: number }): number {
  if (pos.line < 0) return 0;
  if (pos.line >= doc.lines) return doc.length;
  const lineObj = doc.line(pos.line + 1);
  return Math.min(lineObj.from + Math.max(0, pos.character), lineObj.to);
}

function lspRangeToCm(doc: Text, range: LspRange): { from: number; to: number } {
  return { from: lspPosToCm(doc, range.start), to: lspPosToCm(doc, range.end) };
}

function lspSeverityToCm(severity?: number): Diagnostic["severity"] {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "warning";
  }
}

function convertDiagnostic(doc: Text, diag: LspDiagnostic): Diagnostic | null {
  try {
    const { from, to } = lspRangeToCm(doc, diag.range);
    return {
      from,
      to,
      severity: lspSeverityToCm(diag.severity),
      message: diag.message,
      source: diag.source,
    };
  } catch {
    return null;
  }
}

const lspDiagnosticsUpdated = StateEffect.define<void>();

const activeEditors = new Map<string, EditorView>();
const editorFilePaths = new WeakMap<EditorView, string>();
const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
const responseTrackedClients = new WeakSet<LspClient>();
const diagnosticsSubscribedClients = new WeakSet<LspClient>();
const lspVersions = new Map<string, number>();

function getNextVersion(filePath: string): number {
  const version = (lspVersions.get(filePath) || 0) + 1;
  lspVersions.set(filePath, version);
  return version;
}

function ensureResponseHandler(client: LspClient): void {
  if (responseTrackedClients.has(client)) return;
  responseTrackedClients.add(client);
  client.onData(({ message }) => {
    if (typeof message.id === "number" && pendingRequests.has(message.id)) {
      const { resolve, reject } = pendingRequests.get(message.id)!;
      pendingRequests.delete(message.id);
      if (message.error) reject(message.error);
      else resolve(message.result);
    }
  });
}

function sendLspRequest(client: LspClient, method: string, params?: unknown): Promise<unknown> {
  ensureResponseHandler(client);
  const id = client.sendRequest(method, params);
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("LSP 请求超时"));
      }
    }, 10000);
  });
}

function ensureDiagnosticsHandler(client: LspClient): void {
  if (diagnosticsSubscribedClients.has(client)) return;
  diagnosticsSubscribedClients.add(client);
  client.onDiagnostics(({ uri, diagnostics }) => {
    const filePath = uriToFilePath(uri);
    setLspDiagnostics(filePath, diagnostics);
    notify();
    const view = activeEditors.get(filePath);
    if (view) {
      view.dispatch({ effects: lspDiagnosticsUpdated.of() });
    }
  });
}

function getLspContext(filePath: string): { client: LspClient; languageId: string; workspacePath: string } | null {
  const languageId = getLanguageId(filePath);
  const root = getRootForPath(filePath);
  const workspacePath = root?.path;
  if (!languageId || !workspacePath) return null;
  const client = getLspClient(languageId, workspacePath);
  ensureResponseHandler(client);
  ensureDiagnosticsHandler(client);
  return { client, languageId, workspacePath };
}

function lspLinter(filePath: string) {
  return (view: EditorView): Diagnostic[] => {
    const diags = getLspDiagnostics(filePath);
    return diags.map((d) => convertDiagnostic(view.state.doc, d)).filter((d): d is Diagnostic => d !== null);
  };
}

function lspCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const filePath = editorFilePaths.get(context.view);
  if (!filePath) return Promise.resolve(null);
  const ctx = getLspContext(filePath);
  if (!ctx) return Promise.resolve(null);

  const pos = cmPosToLsp(context.state.doc, context.pos);
  return sendLspRequest(ctx.client, "textDocument/completion", {
    textDocument: { uri: filePathToUri(filePath) },
    position: pos,
  })
    .then((result) => {
      if (!result) return null;
      const rawItems = Array.isArray(result) ? result : (result as { items?: unknown[] }).items || [];
      const items = rawItems as {
        label: string;
        detail?: string;
        documentation?: string | { kind: string; value: string };
        insertText?: string;
        textEdit?: { range: LspRange; newText: string };
        filterText?: string;
      }[];
      if (items.length === 0) return null;

      // 默认替换范围：从当前单词起始位置到光标位置
      const wordBefore = context.matchBefore(/[\w$]*$/);
      const defaultFrom = wordBefore ? wordBefore.from : context.pos;

      const options: Completion[] = items.map((item) => {
        let applyText = item.textEdit?.newText ?? item.insertText ?? item.label;
        let from = defaultFrom;

        if (item.textEdit?.range) {
          from = lspPosToCm(context.state.doc, item.textEdit.range.start);
        }

        return {
          label: item.filterText || item.label,
          detail: item.detail,
          info: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
          apply: applyText,
          boost: item.textEdit ? 1 : 0,
        } as Completion;
      });

      return { from: defaultFrom, options, validFor: /[\w$]+/ } as CompletionResult;
    })
    .catch((err) => {
      console.error("[LSP] completion failed:", err);
      return null;
    });
}

function hoverContentsToString(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (!contents || typeof contents !== "object") return "";
  if ("value" in contents) return String((contents as { value: string }).value);
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : (c as { value: string }).value))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const lspHover = hoverTooltip(async (view, pos) => {
  const filePath = editorFilePaths.get(view);
  if (!filePath) return null;
  const ctx = getLspContext(filePath);
  if (!ctx) return null;

  const lspPos = cmPosToLsp(view.state.doc, pos);
  try {
    const result = (await sendLspRequest(ctx.client, "textDocument/hover", {
      textDocument: { uri: filePathToUri(filePath) },
      position: lspPos,
    })) as { contents: unknown } | null;
    if (!result) return null;
    const text = hoverContentsToString(result.contents);
    if (!text.trim()) return null;
    return {
      pos,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "ide__lsp-tooltip";
        dom.textContent = text;
        return { dom };
      },
    };
  } catch (err) {
    console.error("[LSP] hover failed:", err);
    return null;
  }
});

function parseDefinitionResult(result: unknown): { uri: string; range: LspRange }[] {
  if (!result) return [];
  if (Array.isArray(result)) return result as { uri: string; range: LspRange }[];
  return [result as { uri: string; range: LspRange }];
}

interface LspTextEdit {
  range: LspRange;
  newText: string;
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: unknown[];
}

function collectWorkspaceChanges(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const map = new Map<string, LspTextEdit[]>();
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      map.set(uriToFilePath(uri), edits as LspTextEdit[]);
    }
  }
  if (Array.isArray(edit.documentChanges)) {
    for (const docChange of edit.documentChanges) {
      if (docChange && typeof docChange === "object" && "textDocument" in docChange && "edits" in docChange) {
        const td = (docChange as { textDocument: { uri: string }; edits: LspTextEdit[] }).textDocument;
        const edits = (docChange as { edits: LspTextEdit[] }).edits;
        map.set(uriToFilePath(td.uri), edits);
      }
    }
  }
  return map;
}

function applyTextEditsToText(text: string, edits: LspTextEdit[]): string {
  let docState = EditorState.create({ doc: text });
  const sorted = [...edits].sort((a, b) => {
    const aFrom = lspPosToCm(docState.doc, a.range.start);
    const bFrom = lspPosToCm(docState.doc, b.range.start);
    return bFrom - aFrom;
  });
  for (const edit of sorted) {
    const from = lspPosToCm(docState.doc, edit.range.start);
    const to = lspPosToCm(docState.doc, edit.range.end);
    docState = docState.update({ changes: { from, to, insert: edit.newText } }).state;
  }
  return docState.doc.toString();
}

function lspPosToOffset(text: string, pos: { line: number; character: number }): number {
  let line = 0;
  let character = 0;
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return offset;
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
    offset++;
  }
  return offset;
}

function applyTextEditsToRawText(text: string, edits: LspTextEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  let result = text;
  for (const edit of sorted) {
    const from = lspPosToOffset(result, edit.range.start);
    const to = lspPosToOffset(result, edit.range.end);
    result = result.slice(0, from) + edit.newText + result.slice(to);
  }
  return result;
}

function applyTextEditsToView(view: EditorView, edits: LspTextEdit[]): void {
  const sorted = [...edits].sort((a, b) => {
    const aFrom = lspPosToCm(view.state.doc, a.range.start);
    const bFrom = lspPosToCm(view.state.doc, b.range.start);
    return bFrom - aFrom;
  });
  for (const edit of sorted) {
    const from = lspPosToCm(view.state.doc, edit.range.start);
    const to = lspPosToCm(view.state.doc, edit.range.end);
    view.dispatch({ changes: { from, to, insert: edit.newText } });
  }
}

function showStatusMessage(message: string, duration = 3000): void {
  state.statusMessage = message;
  notify();
  setTimeout(() => {
    state.statusMessage = "";
    notify();
  }, duration);
}

function moveCursorTo(view: EditorView, line: number, col: number): void {
  try {
    const doc = view.state.doc;
    if (line < 1 || line > doc.lines) return;
    const lineObj = doc.line(line);
    const pos = Math.min(lineObj.from + Math.max(0, col - 1), lineObj.to);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  } catch {
    // ignore invalid cursor positions
  }
}

export async function goToDefinition(view?: EditorView, pos?: number): Promise<void> {
  const targetView = view || state.editorView;
  if (!targetView) return;
  const filePath = editorFilePaths.get(targetView);
  if (!filePath) return;
  const ctx = getLspContext(filePath);
  if (!ctx) return;

  const targetPos = pos ?? targetView.state.selection.main.head;
  const lspPos = cmPosToLsp(targetView.state.doc, targetPos);

  try {
    const result = await sendLspRequest(ctx.client, "textDocument/definition", {
      textDocument: { uri: filePathToUri(filePath) },
      position: lspPos,
    });
    const locations = parseDefinitionResult(result);
    if (locations.length === 0) return;
    const loc = locations[0];
    const targetFilePath = uriToFilePath(loc.uri);
    const line = loc.range.start.line + 1;
    const col = loc.range.start.character + 1;
    if (targetFilePath === filePath) {
      moveCursorTo(targetView, line, col);
    } else {
      await openFileAt(targetFilePath, line, col);
    }
  } catch (err) {
    console.error("[LSP] goToDefinition failed:", err);
  }
}

export async function renameSymbol(view: EditorView, newName: string): Promise<void> {
  const filePath = editorFilePaths.get(view);
  if (!filePath) return;
  const ctx = getLspContext(filePath);
  if (!ctx) return;

  const lspPos = cmPosToLsp(view.state.doc, view.state.selection.main.head);
  try {
    const result = (await sendLspRequest(ctx.client, "textDocument/rename", {
      textDocument: { uri: filePathToUri(filePath) },
      position: lspPos,
      newName,
    })) as LspWorkspaceEdit | null;
    if (!result) {
      showStatusMessage("重命名失败: 语言服务器返回空结果");
      return;
    }

    const changes = collectWorkspaceChanges(result);
    if (changes.size === 0) {
      showStatusMessage("未找到可重命名的符号");
      return;
    }

    for (const [targetPath, edits] of changes) {
      const tab = state.tabs.get(targetPath);
      if (tab && targetPath === state.activeTabId && state.editorView) {
        applyTextEditsToView(state.editorView, edits);
        tab.currentContent = state.editorView.state.doc.toString();
      } else if (tab) {
        tab.currentContent = applyTextEditsToText(tab.currentContent, edits);
        notifyLspChange(targetPath, tab.currentContent);
      } else {
        try {
          const content = await readFile(targetPath);
          const updated = applyTextEditsToRawText(content, edits);
          const writeResult = await writeFile(targetPath, updated);
          if (!writeResult.ok) {
            console.error(`[LSP] rename write failed for ${targetPath}:`, writeResult.error);
          }
        } catch (err) {
          console.error(`[LSP] rename failed for ${targetPath}:`, err);
        }
        continue;
      }
      // 已打开文件统一写盘，保持与未打开文件行为一致
      const output = encodeLineEndings(tab.currentContent, tab.lineEnding);
      const writeResult = await writeFile(targetPath, output);
      if (writeResult.ok) {
        tab.initialContent = tab.currentContent;
        tab.modified = false;
      } else {
        console.error(`[LSP] rename write failed for ${targetPath}:`, writeResult.error);
      }
      notify();
    }

    showStatusMessage(`已重命名为 ${newName}`);
  } catch (err) {
    console.error("[LSP] renameSymbol failed:", err);
    showStatusMessage(`重命名失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function findReferences(view?: EditorView): Promise<void> {
  const targetView = view || state.editorView;
  if (!targetView) return;
  const filePath = editorFilePaths.get(targetView);
  if (!filePath) return;
  const ctx = getLspContext(filePath);
  if (!ctx) return;

  const lspPos = cmPosToLsp(targetView.state.doc, targetView.state.selection.main.head);
  try {
    const result = await sendLspRequest(ctx.client, "textDocument/references", {
      textDocument: { uri: filePathToUri(filePath) },
      position: lspPos,
      context: { includeDeclaration: true },
    });
    const locations = parseDefinitionResult(result);
    if (locations.length === 0) {
      showStatusMessage("未找到引用");
      return;
    }

    const fileContents = new Map<string, string[]>();
    const results: IdeSearchResult[] = [];
    for (const loc of locations) {
      const targetFilePath = uriToFilePath(loc.uri);
      const line = loc.range.start.line + 1;
      const column = loc.range.start.character + 1;
      let lines = fileContents.get(targetFilePath);
      if (!lines) {
        try {
          const content = await readFile(targetFilePath);
          lines = content.split("\n");
        } catch {
          lines = [];
        }
        fileContents.set(targetFilePath, lines);
      }
      const text = lines[line - 1]?.trim() || "";
      results.push({ filePath: targetFilePath, line, column, text });
    }

    showReferencesResults(results);
  } catch (err) {
    console.error("[LSP] findReferences failed:", err);
    showStatusMessage(`查找引用失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function formatDocument(view?: EditorView): Promise<void> {
  const targetView = view || state.editorView;
  if (!targetView) return;
  const filePath = editorFilePaths.get(targetView);
  if (!filePath) return;
  const ctx = getLspContext(filePath);
  if (!ctx) return;

  try {
    const result = await sendLspRequest(ctx.client, "textDocument/formatting", {
      textDocument: { uri: filePathToUri(filePath) },
      options: { tabSize: state.ideSettings.tabSize, insertSpaces: state.ideSettings.insertSpaces !== false },
    });
    const edits = Array.isArray(result) ? (result as LspTextEdit[]) : [];
    if (edits.length === 0) {
      showStatusMessage("无需格式化");
      return;
    }
    applyTextEditsToView(targetView, edits);
    showStatusMessage("格式化完成");
  } catch (err) {
    console.error("[LSP] formatDocument failed:", err);
    showStatusMessage(`格式化失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function lspExtension(filePath: string): Extension[] {
  if (state.roots.length === 0 || !getLanguageId(filePath)) return [];

  const trackEditor = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        editorFilePaths.set(view, filePath);
        activeEditors.set(filePath, view);
      }
      update(_update: ViewUpdate) {}
      destroy() {
        editorFilePaths.delete(this.view);
        activeEditors.delete(filePath);
      }
    }
  );

  return [
    linter(lspLinter(filePath), {
      needsRefresh: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(lspDiagnosticsUpdated))),
    }),
    autocompletion({ override: [lspCompletionSource] }),
    lspHover,
    keymap.of([
      {
        key: "F12",
        run: () => {
          void goToDefinition();
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      click: (event, view) => {
        if ((event.ctrlKey || event.metaKey) && event.button === 0) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            event.preventDefault();
            void goToDefinition(view, pos);
          }
          return true;
        }
        return false;
      },
    }),
    trackEditor,
  ];
}

export async function notifyLspOpen(filePath: string, content: string): Promise<void> {
  const ctx = getLspContext(filePath);
  if (!ctx) return;
  const result = await ctx.client.start();
  if (!result.ok) {
    console.error("[LSP] start failed:", result.error);
    if (!state.lspStatusMessage) {
      state.lspStatusMessage = `LSP: ${result.error}`;
      notify();
      setTimeout(() => {
        state.lspStatusMessage = "";
        notify();
      }, 5000);
    }
    return;
  }
  ctx.client.textDocumentDidOpen(filePath, content, getNextVersion(filePath));
}

export function notifyLspChange(filePath: string, content: string): void {
  const ctx = getLspContext(filePath);
  if (!ctx) return;
  ctx.client.textDocumentDidChange(filePath, [{ text: content }], getNextVersion(filePath));
}

export function notifyLspSave(filePath: string): void {
  const ctx = getLspContext(filePath);
  if (!ctx) return;
  ctx.client.textDocumentDidSave(filePath);
}

export function notifyLspClose(filePath: string): void {
  const ctx = getLspContext(filePath);
  if (!ctx) return;
  ctx.client.textDocumentDidClose(filePath);
  lspVersions.delete(filePath);
}

// ── 大纲 / 符号列表 ──

function parseSymbolItem(item: unknown): OutlineSymbol | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.name !== "string") return null;

  // DocumentSymbol：selectionRange 定位到名称
  const selRange = rec.selectionRange as { start?: { line?: number; character?: number } } | undefined;
  if (selRange?.start && typeof selRange.start.line === "number") {
    const children = Array.isArray(rec.children) ? rec.children.map(parseSymbolItem).filter((s): s is OutlineSymbol => !!s) : [];
    return {
      name: rec.name,
      detail: typeof rec.detail === "string" ? rec.detail : undefined,
      kind: typeof rec.kind === "number" ? rec.kind : 0,
      line: selRange.start.line + 1,
      col: (selRange.start.character ?? 0) + 1,
      children,
    };
  }

  // SymbolInformation：location.range 定位
  const loc = rec.location as { range?: { start?: { line?: number; character?: number } } } | undefined;
  if (loc?.range?.start && typeof loc.range.start.line === "number") {
    return {
      name: rec.name,
      detail: undefined,
      kind: typeof rec.kind === "number" ? rec.kind : 0,
      line: loc.range.start.line + 1,
      col: (loc.range.start.character ?? 0) + 1,
      children: [],
    };
  }

  return null;
}

function parseDocumentSymbols(result: unknown): OutlineSymbol[] {
  if (!Array.isArray(result)) return [];
  return result.map(parseSymbolItem).filter((s): s is OutlineSymbol => !!s);
}

/** 请求 documentSymbol 并更新大纲状态；失败时清空（如无 LSP/语言不支持） */
export async function refreshOutline(filePath: string): Promise<void> {
  const ctx = getLspContext(filePath);
  if (!ctx) {
    state.outlineFilePath = filePath;
    state.outlineSymbols = [];
    state.outlineVersion++;
    notify();
    return;
  }
  try {
    // 确保语言服务器已启动（首次打开文件时服务器可能还在启动中）
    const started = await ctx.client.start();
    if (!started.ok) throw new Error(started.error || "启动语言服务器失败");
    const result = await sendLspRequest(ctx.client, "textDocument/documentSymbol", {
      textDocument: { uri: filePathToUri(filePath) },
    });
    state.outlineFilePath = filePath;
    state.outlineSymbols = parseDocumentSymbols(result);
    state.outlineVersion++;
    notify();
  } catch (err) {
    console.error("[LSP] documentSymbol failed:", err);
    state.outlineFilePath = filePath;
    state.outlineSymbols = [];
    state.outlineVersion++;
    notify();
  }
}
