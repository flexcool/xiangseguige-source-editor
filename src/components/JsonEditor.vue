<template>
  <div class="editor-wrap">
    <div
      ref="editorEl"
      class="cm-host"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  searchKeymap,
  highlightSelectionMatches,
} from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";

const props = defineProps<{ modelValue: string; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();

const editorEl = ref<HTMLDivElement>();
let view: EditorView | null = null;

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
          ...completionKeymap,
        ]),
        json(),
        oneDark,
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged && !props.readonly) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "'JetBrains Mono','Fira Code','SF Mono',monospace",
          },
          ".cm-content": { padding: "12px 0" },
        }),
        ...(props.readonly ? [EditorState.readOnly.of(true)] : []),
      ],
    }),
    parent: editorEl.value!,
  });
});

onBeforeUnmount(() => view?.destroy());

watch(
  () => props.modelValue,
  (val) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === val) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: val } });
  },
);
</script>

<style scoped>
.editor-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.cm-host {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* override codemirror bg to match theme */
:deep(.cm-editor) {
  height: 100%;
  background: var(--surface) !important;
}
:deep(.cm-gutters) {
  background: var(--surface2) !important;
  border-right: 1px solid var(--border) !important;
}
:deep(.cm-activeLineGutter),
:deep(.cm-activeLine) {
  background: rgba(108, 143, 255, 0.05) !important;
}
</style>
