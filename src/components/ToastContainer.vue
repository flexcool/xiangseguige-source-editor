<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          :class="['toast', `toast-${t.type}`]"
        >
          <span class="toast-icon">{{ ICONS[t.type] }}</span>
          <span>{{ t.msg }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { ToastItem } from "@/lib/types";

defineProps<{ toasts: ToastItem[] }>();

const ICONS = { ok: "✅", err: "❌", info: "ℹ️", warn: "⚠️" };
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9999;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 16px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  min-width: 200px;
  max-width: 360px;
  pointer-events: auto;
}
.toast-ok {
  background: #064e3b;
  border: 1px solid #065f46;
  color: #34d399;
}
.toast-err {
  background: #450a0a;
  border: 1px solid #7f1d1d;
  color: #f87171;
}
.toast-info {
  background: #1e1b4b;
  border: 1px solid #312e81;
  color: #a5b4fc;
}
.toast-warn {
  background: #451a03;
  border: 1px solid #78350f;
  color: #fbbf24;
}
.toast-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
