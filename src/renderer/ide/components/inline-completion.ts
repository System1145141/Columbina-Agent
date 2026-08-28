import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, KeyBinding, keymap } from "@codemirror/view";
import { RangeSet } from "@codemirror/state";
import { subscribe, clearInlineCompletion, state, notify } from "../services/state";
import {
  scheduleInlineCompletion,
  cancelScheduledCompletion,
  acceptInlineCompletion,
  rejectInlineCompletion,
} from "../services/agent-bridge";

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "ide__ghost-text";
    span.textContent = this.text;
    return span;
  }

  eq(other: GhostTextWidget) {
    return other.text === this.text;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const completion = state.inlineCompletion;
  if (!completion.active || !completion.text) return Decoration.none;
  const cursor = view.state.selection.main.head;
  if (completion.from !== cursor) return Decoration.none;
  const widget = new GhostTextWidget(completion.text);
  return Decoration.set([Decoration.widget({ widget, side: 1 }).range(cursor)]);
}

const inlineCompletionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private unsub: (() => void) | null = null;

    constructor(readonly view: EditorView) {
      this.unsub = subscribe(() => this.onGlobalStateChange());
      this.syncFromState();
    }

    update(update: ViewUpdate) {
      const typed = update.transactions.some(
        (tr) => tr.isUserEvent("input.type") || tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop")
      );
      if (typed) {
        if (state.inlineCompletion.active) {
          clearInlineCompletion();
          notify();
        }
        scheduleInlineCompletion(this.view);
      }

      if (update.selectionSet) {
        cancelScheduledCompletion();
        if (state.inlineCompletion.active && !state.inlineCompletion.loading) {
          clearInlineCompletion();
          notify();
        }
      }

      this.syncFromState();
    }

    destroy() {
      this.unsub?.();
      cancelScheduledCompletion();
    }

    private onGlobalStateChange() {
      if (this.syncFromState()) {
        requestAnimationFrame(() => {
          // EditorView.destroyed 为私有成员；以 DOM 是否仍挂在文档判断视图存活
          if (!this.view.dom.isConnected) return;
          this.view.update([]);
        });
      }
    }

    private syncFromState(): boolean {
      const next = buildDecorations(this.view);
      // RangeSet 无实例 eq，用静态数组比较
      if (!RangeSet.eq([next], [this.decorations])) {
        this.decorations = next;
        return true;
      }
      return false;
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

const completionKeymap: KeyBinding[] = [
  {
    key: "Tab",
    run: (view) => {
      if (state.inlineCompletion.active && !state.inlineCompletion.loading && state.inlineCompletion.text) {
        return acceptInlineCompletion(view);
      }
      return false;
    },
  },
  {
    key: "Escape",
    run: (view) => {
      if (state.inlineCompletion.active) {
        rejectInlineCompletion();
        return true;
      }
      return false;
    },
  },
  {
    key: "Alt-\\",
    run: (view) => {
      cancelScheduledCompletion();
      if (state.inlineCompletion.active) {
        clearInlineCompletion();
        notify();
      }
      void scheduleInlineCompletion(view);
      return true;
    },
  },
];

export const inlineCompletionExtension = [inlineCompletionPlugin, keymap.of(completionKeymap)];
