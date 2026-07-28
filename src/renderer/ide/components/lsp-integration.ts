import { linter, type Diagnostic } from "@codemirror/lint";
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip, keymap, ViewPlugin, EditorView, type ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { getLspClient, type LspClient, type LspDiagnostic, type LspRange } from "../services/lsp-client";
import { state, notify, setLspDiagnostics, getLspDiagnostics } from "../services/state";
import { getFileExtension } from "../services/file-service";
import { openFileAt } from "../services/file-service";

const extToLanguageId: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  py: "python",
};

export function getLanguageId(filePath: string): string | null {
  const ext = getFileExtension(filePath);
  return extToLanguageId[ext] || null;
}

function filePathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("file://")) return normalized;
  return `file://${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function uriToFilePath(uri: string): string {
  if (uri.startsWith("file:///")) return uri.slice("file:///".length);
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
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
  const workspacePath = state.currentFolder;
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
      const items = rawItems as { label: string; detail?: string; documentation?: string | { kind: string; value: string }; insertText?: string }[];
      if (items.length === 0) return null;
      const options: Completion[] = items.map((item) => ({
        label: item.label,
        detail: item.detail,
        info: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
        apply: item.insertText || item.label,
      }));
      return { from: context.pos, options } as CompletionResult;
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

export function lspExtension(filePath: string): Extension[] {
  if (!state.currentFolder || !getLanguageId(filePath)) return [];

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
