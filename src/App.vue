<template>
  <div id="app-shell">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-icon">📖</span>
        <div class="logo-text">
          <div class="logo-main">XBS Editor</div>
          <div class="logo-sub">香色闺阁书源</div>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: store.activeTab === item.key }"
          @click="store.activeTab = item.key as any"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
          <span
            v-if="item.key === 'sources' && store.sourceCount > 0"
            class="nav-badge"
          >
            {{ store.sourceCount }}
          </span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <a
          href="https://github.com/urzeye/xbs-editor"
          target="_blank"
          rel="noopener noreferrer"
          class="footer-link"
        >
          <span>GitHub</span>
          <span class="ext-icon">↗</span>
        </a>
        <div class="footer-note">本地处理 · 无服务器</div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="main-area">
      <!-- Top bar -->
      <header class="topbar">
        <div class="topbar-title">
          <span>{{ currentNavItem?.icon }}</span>
          {{ currentNavItem?.label }}
        </div>
        <div class="topbar-actions">
          <template v-if="store.activeTab === 'editor'">
            <label class="btn btn-sm btn-muted">
              📂 导入 XBS
              <input
                type="file"
                accept=".xbs"
                @change="onXbsFile"
              />
            </label>
            <label class="btn btn-sm btn-muted">
              📄 导入 JSON
              <input
                type="file"
                accept=".json"
                @change="onJsonFile"
              />
            </label>
            <button
              class="btn btn-sm btn-primary"
              :disabled="!store.xbsBuffer"
              @click="store.downloadXbs"
            >
              ⬇ 导出 XBS
            </button>
            <button
              class="btn btn-sm btn-success"
              :disabled="!store.jsonText"
              @click="store.downloadJson"
            >
              ⬇ 导出 JSON
            </button>
          </template>
        </div>
      </header>

      <!-- Tab content -->
      <div class="content">
        <EditorView v-show="store.activeTab === 'editor'" />
        <div
          v-show="store.activeTab === 'sources'"
          class="sources-wrap"
        >
          <SourceTable v-if="store.sourceCount > 0" />
          <div
            v-else
            class="empty-sources"
          >
            <span>📚</span>
            <p>暂无书源数据</p>
            <p class="hint">请先在编辑器中导入并解密 XBS 文件</p>
            <button
              class="btn btn-sm btn-primary mt"
              @click="store.activeTab = 'editor'"
            >
              前往编辑器
            </button>
          </div>
        </div>
      </div>
    </div>

    <ToastContainer :toasts="store.toasts" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useEditorStore } from "@/stores/editor";
import EditorView from "@/views/EditorView.vue";
import SourceTable from "@/components/SourceTable.vue";
import ToastContainer from "@/components/ToastContainer.vue";

const store = useEditorStore();

const navItems = [
  { key: "editor", icon: "⚡", label: "加解密编辑器" },
  { key: "sources", icon: "📚", label: "书源管理" },
];

const currentNavItem = computed(() =>
  navItems.find((n) => n.key === store.activeTab),
);

function onXbsFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    store.loadXbsFile(f);
    (e.target as HTMLInputElement).value = "";
  }
}
function onJsonFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    store.loadJsonFile(f);
    (e.target as HTMLInputElement).value = "";
  }
}
</script>

<style>
/* ── Global Reset & CSS Variables ── */
:root {
  --bg: #0c0e16;
  --surface: #13151f;
  --surface2: #1a1d2a;
  --border: #252838;
  --accent: #6c8fff;
  --accent2: #a78bfa;
  --green: #34d399;
  --red: #f87171;
  --yellow: #fbbf24;
  --text: #e2e8f0;
  --text2: #94a3b8;
  --text3: #64748b;
}
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html,
body,
#app {
  height: 100%;
}
body {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", sans-serif;
  background: var(--bg);
  color: var(--text);
}
</style>

<style scoped>
#app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}
.logo-icon {
  font-size: 24px;
}
.logo-main {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.logo-sub {
  font-size: 11px;
  color: var(--text3);
}

.nav {
  flex: 1;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text2);
  font-size: 13.5px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.nav-item:hover {
  background: var(--surface2);
  color: var(--text);
}
.nav-item.active {
  background: rgba(108, 143, 255, 0.15);
  color: var(--accent);
}
.nav-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.nav-label {
  flex: 1;
  font-weight: 500;
}
.nav-badge {
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.footer-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text3);
  text-decoration: none;
  font-size: 12px;
  padding: 5px 0;
}
.footer-link:hover {
  color: var(--accent);
}
.ext-icon {
  font-size: 11px;
}
.footer-note {
  font-size: 11px;
  color: var(--text3);
  margin-top: 4px;
}

/* ── Main area ── */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 52px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.topbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.topbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbar-actions label {
  cursor: pointer;
}
.topbar-actions input {
  display: none;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.sources-wrap {
  flex: 1;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty-sources {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text3);
}
.empty-sources span {
  font-size: 40px;
}
.empty-sources p {
  font-size: 15px;
  color: var(--text2);
}
.empty-sources .hint {
  font-size: 13px;
  color: var(--text3);
}
.mt {
  margin-top: 8px;
}

/* Global btn */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
}
.btn:active {
  transform: scale(0.96);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}
.btn-sm {
  padding: 6px 12px;
  font-size: 12.5px;
}
.btn-primary {
  background: linear-gradient(135deg, var(--accent), #4f6ef7);
  color: #fff;
}
.btn-primary:hover {
  filter: brightness(1.12);
}
.btn-success {
  background: linear-gradient(135deg, #059669, #34d399);
  color: #fff;
}
.btn-success:hover {
  filter: brightness(1.1);
}
.btn-muted {
  background: var(--surface2);
  color: var(--text2);
  border: 1px solid var(--border);
}
.btn-muted:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
