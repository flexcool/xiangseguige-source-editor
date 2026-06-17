import { defineStore } from "pinia";
import { ref, watch } from "vue";

const LS_KEY = "xbs_ai_config";

export const DEFAULT_AI_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_AI_MODEL = "deepseek-v4-pro";

export type ThinkingMode = "auto" | "off";
export type ReasoningEffort = "high" | "max";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 自动尝试模型思考参数；不根据 baseUrl 猜供应商，失败时剥离扩展参数降级重试 */
  thinkingMode: ThinkingMode;
  /** 支持 high/max 的接口优先使用 max，兼容失败时自动回退 high/普通请求 */
  reasoningEffort: ReasoningEffort;
  /** 页面抓取代理地址。本地开发默认用 Vite proxy；生产环境需填 Cloudflare Worker URL */
  proxyUrl: string;
}

const PUBLIC_PROXY = "https://raspy-wind-b18e.igodu-love.workers.dev/";
export const DEV_PROXY = "/api/fetch-page";
export { PUBLIC_PROXY };

function defaultConfig(): AiConfig {
  return {
    baseUrl: DEFAULT_AI_BASE_URL,
    apiKey: "",
    model: DEFAULT_AI_MODEL,
    thinkingMode: "auto",
    reasoningEffort: "max",
    proxyUrl: import.meta.env.DEV ? "/api/fetch-page" : PUBLIC_PROXY,
  };
}

function normalizeConfig(raw: Partial<AiConfig>): AiConfig {
  const defaults = defaultConfig();
  return {
    ...defaults,
    ...raw,
    thinkingMode: raw.thinkingMode === "off" ? "off" : "auto",
    reasoningEffort: raw.reasoningEffort === "high" ? "high" : "max",
  };
}

function loadFromStorage(): AiConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw) as Partial<AiConfig>);
  } catch {
    // ignore
  }
  return defaultConfig();
}

export const useAiConfigStore = defineStore("aiConfig", () => {
  const config = ref<AiConfig>(loadFromStorage());

  watch(
    config,
    (val) => {
      localStorage.setItem(LS_KEY, JSON.stringify(val));
    },
    { deep: true },
  );

  function save(c: AiConfig) {
    config.value = normalizeConfig(c);
  }

  return { config, save };
});
