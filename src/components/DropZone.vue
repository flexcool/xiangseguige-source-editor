<template>
  <div
    class="dropzone"
    :class="{ 'drag-over': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave="isDragging = false"
    @drop.prevent="onDrop"
    @click="triggerInput"
  >
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      @change="onChange"
    />
    <div class="dz-icon">{{ icon }}</div>
    <div class="dz-title">{{ title }}</div>
    <div class="dz-sub">{{ sub }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  accept: string;
  icon: string;
  title: string;
  sub: string;
}>();

const emit = defineEmits<{ file: [f: File] }>();

const inputRef = ref<HTMLInputElement>();
const isDragging = ref(false);

function triggerInput() {
  inputRef.value?.click();
}

function onChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    emit("file", f);
    (e.target as HTMLInputElement).value = "";
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) emit("file", f);
}
</script>

<style scoped>
.dropzone {
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
  background: var(--surface);
  user-select: none;
}
.dropzone:hover,
.drag-over {
  border-color: var(--accent);
  background: rgba(108, 143, 255, 0.06);
}
input {
  display: none;
}
.dz-icon {
  font-size: 32px;
  margin-bottom: 8px;
}
.dz-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text);
}
.dz-sub {
  font-size: 12px;
  color: var(--text3);
}
</style>
