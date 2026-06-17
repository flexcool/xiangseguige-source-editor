import { ref } from "vue";
import type { AiConfig } from "@/stores/aiConfig";

export interface GenerateStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

export interface GeneratedSource {
  raw: Record<string, unknown>;
  warning?: string;
}

// ──────────────────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────────────────

async function fetchPage(url: string, proxyUrl: string): Promise<string> {
  const endpoint =
    proxyUrl.replace(/\/$/, "") + "?url=" + encodeURIComponent(url);
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("代理请求失败: " + res.status);
  const data = (await res.json()) as {
    html?: string;
    error?: string;
    status?: number;
  };
  if (data.error) throw new Error(data.error);
  if (!data.html) throw new Error("未获取到页面内容");
  return data.html;
}

// ──────────────────────────────────────────────────────────
// HTML processing utilities
// ──────────────────────────────────────────────────────────

function cleanHtml(html: string, maxLen = 20000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "[img]")
    .replace(/\s{2,}/g, " ")
    .slice(0, maxLen);
}

function extractText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, "\n")
    .trim();
}

// ──────────────────────────────────────────────────────────
// Heuristic URL extraction
// ──────────────────────────────────────────────────────────

interface Anchor {
  href: string;
  text: string;
  score: number;
}

interface SearchCandidate {
  url: string;
  note: string;
}

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function collectAnchors(html: string): Array<{ href: string; text: string }> {
  const re = /<a[^>]+href=["']([^"'\s>]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results: Array<{ href: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript") ||
      href === "/"
    )
      continue;
    results.push({ href, text });
  }
  return results;
}

function getAttr(tag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(re)?.[1]?.trim() ?? "";
}

function uniqueCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function withQuery(url: string, key: string, value: string): string | null {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.href;
  } catch {
    return null;
  }
}

function extractSearchFormHints(html: string, siteUrl: string): string[] {
  const forms: string[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && forms.length < 8) {
    const attrs = m[1];
    const body = m[2];
    const action = getAttr(attrs, "action") || siteUrl;
    const method = (getAttr(attrs, "method") || "GET").toUpperCase();
    const names = Array.from(body.matchAll(/\bname=["']([^"']+)["']/gi))
      .map((item) => item[1])
      .filter(Boolean);
    forms.push(
      `${method} ${resolveUrl(action, siteUrl)} input=${names.join(",") || "未知"}`,
    );
  }
  return forms;
}

function buildSearchCandidates(
  homeHtml: string,
  siteUrl: string,
  bookName: string,
): SearchCandidate[] {
  const base = new URL(siteUrl);
  const candidates: SearchCandidate[] = [
    {
      url: `${base.origin}/search.html?q=${encodeURIComponent(bookName)}`,
      note: "常见 q 搜索",
    },
    {
      url: `${base.origin}/search?q=${encodeURIComponent(bookName)}`,
      note: "常见 /search",
    },
    {
      url: `${base.origin}/search?key=${encodeURIComponent(bookName)}`,
      note: "常见 key 搜索",
    },
    {
      url: `${base.origin}/search?keyword=${encodeURIComponent(bookName)}`,
      note: "常见 keyword 搜索",
    },
    {
      url: `${base.origin}/search?searchkey=${encodeURIComponent(bookName)}`,
      note: "常见 searchkey 搜索",
    },
    {
      url: `${base.origin}/modules/article/search.php?searchkey=${encodeURIComponent(bookName)}`,
      note: "杰奇/小说站常见搜索",
    },
    {
      url: `${base.origin}/s?key=${encodeURIComponent(bookName)}`,
      note: "常见 /s 搜索",
    },
    {
      url: `${base.origin}/so/${encodeURIComponent(bookName)}.html`,
      note: "常见 /so 静态搜索",
    },
    {
      url: `${base.origin}/search/${encodeURIComponent(bookName)}/`,
      note: "常见 path 搜索",
    },
  ];

  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRe.exec(homeHtml)) !== null) {
    const attrs = formMatch[1];
    const body = formMatch[2];
    const action = resolveUrl(getAttr(attrs, "action") || siteUrl, siteUrl);
    const names = Array.from(body.matchAll(/\bname=["']([^"']+)["']/gi)).map(
      (item) => item[1],
    );
    const key =
      names.find((name) =>
        /search|keyword|key|wd|word|query|q|name|book/i.test(name),
      ) ?? names[0];
    if (!key) continue;
    const url = withQuery(action, key, bookName);
    if (url) candidates.unshift({ url, note: `首页搜索表单 ${key}` });
  }

  for (const anchor of collectAnchors(homeHtml)) {
    if (!/(search|so|sousuo|查找|搜索)/i.test(anchor.href + anchor.text))
      continue;
    const url = resolveUrl(anchor.href, siteUrl);
    for (const key of ["q", "keyword", "key", "searchkey", "wd", "word"]) {
      const candidateUrl = withQuery(url, key, bookName);
      if (candidateUrl) {
        candidates.push({
          url: candidateUrl,
          note: `首页搜索链接补 ${key}`,
        });
      }
    }
  }

  return uniqueCandidates(candidates);
}

function findBookUrl(
  searchHtml: string,
  searchUrl: string,
  bookName: string,
): string | null {
  const anchors = collectAnchors(searchHtml);
  const scored: Anchor[] = anchors.map(({ href, text }) => {
    let score = 0;
    if (text.includes(bookName)) score += 12;
    else if (bookName.length >= 2 && text.includes(bookName.slice(0, 2)))
      score += 5;
    if (/\/(book|xs|novel|info|detail|view|article|read)\//i.test(href))
      score += 5;
    if (/\/\d{3,}(\/|\.html?)?$/.test(href)) score += 4;
    if (/\.html?$/.test(href)) score += 1;
    if (
      /\/(search|login|register|user|category|tag|page|sort|order)/i.test(href)
    )
      score -= 20;
    if (/\/(about|contact|help|faq|privacy|terms)/i.test(href)) score -= 10;
    if (/[?&]page?=/i.test(href)) score -= 5;
    if (text.length > 0 && text.length < 40) score += 2;
    if (text.length > 50) score -= 3;
    return { href, text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((a) => a.score >= 3);
  if (!best) return null;
  return resolveUrl(best.href, searchUrl);
}

function findFirstChapterUrl(html: string, chapterListUrl: string): string | null {
  const anchors = collectAnchors(html);
  const scored: Anchor[] = anchors.map(({ href, text }) => {
    let score = 0;
    if (/^第[零一二三四五六七八九十百千\d]+章/.test(text)) score += 15;
    if (/^(序章|楔子|引子|前言|卷首语|第一章|第1章)/.test(text)) score += 13;
    if (/第.{0,4}章/.test(text)) score += 8;
    if (/\/(read|chapter|content|p|c|chap)\//i.test(href)) score += 5;
    if (/\d+\.html?$/.test(href)) score += 2;
    if (/\/(login|register|user|search|about)/i.test(href)) score -= 20;
    return { href, text, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((a) => a.score >= 5);
  if (!best) return null;
  return resolveUrl(best.href, chapterListUrl);
}

function extractAdCandidates(chapterHtml: string): string[] {
  const text = extractText(chapterHtml);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.length < 200);

  const adPatterns = [
    /收藏|书签|加入书架|推荐票|月票/,
    /手机版|手机阅读|移动端|wap/i,
    /www\.|https?:|\.com|\.net|\.cn|\.org/i,
    /请记住|本书网址|本站|更新最快|最快更新/,
    /txt|epub|mobi|电子书|下载/i,
    /广告|支持正版|赞助商/,
    /回车键|章节错误|字体大小|背景颜色/,
    /关注|微信|公众号|二维码/,
    /如果你觉得.*好看|觉得不错|推荐给|分享给/,
    /温馨提示|特别声明|版权声明/,
  ];

  return lines.filter((line) => adPatterns.some((p) => p.test(line)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRule(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const rule = source[key];
  return isRecord(rule) ? rule : null;
}

function ensureRuleShell(
  source: Record<string, unknown>,
  key: string,
  warnings: string[],
) {
  const rule = getRule(source, key);
  if (!rule) return;
  if (rule.actionID !== key) {
    rule.actionID = key;
    warnings.push(`${key}.actionID 已修正为 ${key}`);
  }
  if (!rule.parserID) rule.parserID = "DOM";
  if (!rule.responseFormatType && key !== "relatedWord") {
    rule.responseFormatType = "html";
  }
  if (rule.validConfig === undefined && key !== "relatedWord") {
    rule.validConfig = "";
  }
}

function validateGeneratedSource(
  source: Record<string, unknown>,
  base: URL,
  siteUrl: string,
): string[] {
  const warnings: string[] = [];

  if (!source.sourceName) {
    source.sourceName = base.hostname;
    warnings.push("sourceName 缺失，已用域名代替");
  }
  if (!source.sourceUrl) source.sourceUrl = siteUrl;
  if (source.enable === undefined) source.enable = 1;
  if (!source.weight) source.weight = "9000";
  if (!source.miniAppVersion) source.miniAppVersion = "2.53.2";
  if (!source.lastModifyTime) source.lastModifyTime = "0";
  if (!source.sourceType) source.sourceType = "text";
  if (source.httpHeaders === undefined) source.httpHeaders = "";

  for (const key of [
    "searchBook",
    "bookDetail",
    "chapterList",
    "chapterContent",
  ]) {
    ensureRuleShell(source, key, warnings);
  }

  for (const key of [
    "shudanDetail",
    "shupingList",
    "shupingHome",
    "searchShudan",
    "relatedWord",
  ]) {
    if (!isRecord(source[key])) {
      source[key] = { actionID: key, parserID: "DOM" };
      warnings.push(`${key} 缺失，已补默认空规则`);
    } else {
      ensureRuleShell(source, key, warnings);
    }
  }
  if (!isRecord(source.bookWorld)) source.bookWorld = {};
  if (!isRecord(source.shudanList)) source.shudanList = {};

  for (const key of ["searchBook", "bookDetail"]) {
    const rule = getRule(source, key);
    if (!rule) continue;
    if ("state" in rule) {
      rule.status = rule.status ?? rule.state;
      delete rule.state;
      warnings.push(`${key}.state 已修正为 status`);
    }
    if ("lastChapter" in rule) {
      rule.lastChapterTitle = rule.lastChapterTitle ?? rule.lastChapter;
      delete rule.lastChapter;
      warnings.push(`${key}.lastChapter 已修正为 lastChapterTitle`);
    }
  }

  const bookDetail = getRule(source, "bookDetail");
  const bookDetailUrlRule = String(bookDetail?.detailUrl ?? "");
  if (
    bookDetailUrlRule.includes("/@href") &&
    !bookDetailUrlRule.includes("@js") &&
    !bookDetailUrlRule.includes("http")
  ) {
    warnings.push("bookDetail.detailUrl 可能是相对链接，建议追加 ||@js: 基于 params.responseUrl 拼接");
  }

  const chapterContent = getRule(source, "chapterContent");
  if (chapterContent && "filter" in chapterContent) {
    warnings.push("chapterContent.filter 不是有效字段，请改到 content 的 |@js: 过滤中");
  }

  const chapterList = getRule(source, "chapterList");
  const chapterUrlRule = String(chapterList?.url ?? "");
  if (
    chapterUrlRule.includes("/@href") &&
    !chapterUrlRule.includes("@js") &&
    !chapterUrlRule.includes("http")
  ) {
    warnings.push("chapterList.url 可能是相对链接，建议追加 ||@js: 基于 params.responseUrl 拼接");
  }

  const searchBook = getRule(source, "searchBook");
  const searchDetailUrlRule = String(searchBook?.detailUrl ?? "");
  if (
    searchDetailUrlRule.includes("/@href") &&
    !searchDetailUrlRule.includes("@js") &&
    !searchDetailUrlRule.includes("http")
  ) {
    warnings.push("searchBook.detailUrl 可能是相对链接，建议追加 ||@js: 基于 params.responseUrl 拼接");
  }

  const requiredRules: Array<[string, string[]]> = [
    ["searchBook", ["list", "detailUrl"]],
    ["chapterList", ["list", "title", "url"]],
    ["chapterContent", ["content"]],
  ];
  for (const [ruleName, fields] of requiredRules) {
    const rule = getRule(source, ruleName);
    if (!rule) continue;
    for (const field of fields) {
      if (rule[field] === undefined || rule[field] === "") {
        warnings.push(`${ruleName}.${field} 缺失，可能无法正常抓取`);
      }
    }
  }

  return warnings;
}

// ──────────────────────────────────────────────────────────
// LLM communication
// ──────────────────────────────────────────────────────────

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  stream: boolean;
  thinking?: { type: "enabled" };
  reasoning_effort?: "high" | "max";
};

type ChatCompletionDelta = {
  content?: string;
  reasoning_content?: string;
};

type ChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
    delta?: ChatCompletionDelta;
  }>;
};

type StreamChunkKind = "content" | "reasoning" | "notice" | "reset";
type RequestMode =
  | { kind: "thinking"; effort: "high" | "max" }
  | { kind: "thinkingOnly" }
  | { kind: "reasoning"; effort: "high" | "max" }
  | { kind: "plain"; temperature?: number };

class LlmApiError extends Error {
  constructor(
    public status: number,
    public responseText: string,
  ) {
    super(`LLM API 错误 ${status}: ${responseText.slice(0, 200)}`);
  }
}

function buildRequestBody(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  stream: boolean,
  mode: RequestMode,
): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream,
  };

  if (mode.kind === "thinking") {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = mode.effort;
    return body;
  }

  if (mode.kind === "thinkingOnly") {
    body.thinking = { type: "enabled" };
    return body;
  }

  if (mode.kind === "reasoning") {
    body.reasoning_effort = mode.effort;
    return body;
  }

  if (mode.temperature !== undefined) {
    body.temperature = mode.temperature;
  }
  return body;
}

function buildRequestModes(config: AiConfig): RequestMode[] {
  if (config.thinkingMode === "off") {
    return [{ kind: "plain", temperature: 0.2 }, { kind: "plain" }];
  }

  const efforts: Array<"high" | "max"> =
    config.reasoningEffort === "max" ? ["max", "high"] : ["high"];

  return [
    ...efforts.map((effort) => ({ kind: "thinking" as const, effort })),
    { kind: "thinkingOnly" },
    ...efforts.map((effort) => ({ kind: "reasoning" as const, effort })),
    { kind: "plain", temperature: 0.2 },
    { kind: "plain" },
  ];
}

function shouldRetryWithoutThinking(error: unknown): boolean {
  if (!(error instanceof LlmApiError)) return false;
  if (error.status < 400 || error.status >= 500) return false;

  const text = error.responseText.toLowerCase();
  return [
    "thinking",
    "reasoning_effort",
    "response_format",
    "temperature",
    "unknown parameter",
    "unsupported parameter",
    "invalid parameter",
    "unrecognized",
    "未知参数",
    "无效参数",
    "不支持",
    "not support",
    "not supported",
  ].some((marker) => text.includes(marker));
}

function buildSystemPrompt(): string {
  return `你是香色闺阁（XBS）书源规则专家。根据用户提供的真实小说网站 HTML，生成完整的 XBS 书源 JSON。
所有字段名和语法必须严格遵守以下规范（来源：真实 XBS 书源 demo.json 与香色闺阁规则文档）。

━━━ 工作原则 ━━━

1. 只根据用户提供的 HTML 与 URL 证据生成规则；没有证据的选择器不要猜。
2. 优先生成最小可用的小说书源：searchBook、bookDetail、chapterList、chapterContent 必须尽量可用。
3. bookWorld / 书单 / 书评 / relatedWord 只有在页面证据明确时才补全；否则输出空对象或默认空规则壳。
4. 所有 DOM 解析选择器只用 XPath，不用 CSS 选择器。
5. URL 相对路径必须可靠处理，优先基于 params.responseUrl 拼接，而不是盲目 config.host + result。
6. 搜索方式必须来自首页 form、已成功抓取的搜索 URL、或真实搜索结果页结构；不要发明 POST 字段。
7. 输出必须是单个合法 JSON 对象，不要 markdown、不要解释文字、不要注释。
8. 可选模块必须有明确证据才补全：分类/排行列表补 bookWorld，书单/专题页面补 shudan，评论入口或评论列表补 shuping，相关搜索/联想词补 relatedWord；只有入口标题没有列表结构时不要补。
9. 如果 HTML 明确是漫画 / 音频 / 视频站点，sourceType 要跟随真实站点类型，不要一律写 text。

━━━ 顶层结构模板 ━━━

{
  "sourceName": "网站名称",
  "sourceUrl": "https://www.example.com",
  "enable": 1,
  "weight": "9000",
  "miniAppVersion": "2.53.2",
  "lastModifyTime": "0",
  "desc": "",
  "password": "",
  "sourceType": "text",
  "httpHeaders": "",
  "searchBook": { ... },
  "bookDetail": { ... },
  "chapterList": { ... },
  "chapterContent": { ... },
  "bookWorld": {},
  "shudanList": {},
  "shudanDetail": { "actionID": "shudanDetail", "parserID": "DOM" },
  "shupingList": { "actionID": "shupingList", "parserID": "DOM" },
  "shupingHome": { "actionID": "shupingHome", "parserID": "DOM" },
  "searchShudan": { "actionID": "searchShudan", "parserID": "DOM" },
  "relatedWord": { "actionID": "relatedWord", "parserID": "DOM" }
}

sourceType 可选值：text（默认小说）/ comic（漫画）/ audio（听书）/ video（视频）

━━━ 子规则公共字段 ━━━

每个子规则（searchBook/bookDetail/chapterList/chapterContent）都包含：
  "actionID": "<与键名相同>",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "validConfig": ""

━━━ searchBook ━━━

{
  "actionID": "searchBook",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "requestInfo": "https://www.example.com/search?q=%@keyWord&page=%@pageIndex",
  "list": "//ul[@class='book-list']//li",
  "bookName": "//h3/a/text()",
  "author": "//span[@class='author']/text()",
  "detailUrl": "//h3/a/@href",
  "cover": "//img/@src",
  "desc": "//p[@class='intro']/text()",
  "status": "//span[@class='status']/text()",
  "cat": "//span[@class='cat']/text()",
  "wordCount": "//span[@class='words']/text()",
  "lastChapterTitle": "//span[@class='last']/text()",
  "moreKeys": { "pageSize": 10, "maxPage": 3 },
  "validConfig": ""
}

requestInfo 占位符：%@keyWord（搜索词）、%@pageIndex（页码，从 1 开始）
POST 搜索示例：
  "requestInfo": "@js:\\nlet url=config.host+'/search.html';\\nreturn {url:url,POST:true,httpParams:{keyword:params.keyWord},forbidCookie:true,cacheTime:3600};"
cover 字段若需由 detailUrl 计算（无直接 img）：
  "cover": "//h3/a/@href ||@js:\\nlet id=result.match(/(\\\\d+)/)[0];return config.host+'/files/image/'+id+'s.jpg'"

━━━ bookDetail ━━━

{
  "actionID": "bookDetail",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "bookName": "//meta[@property='og:novel:book_name']/@content",
  "author": "//meta[@property='og:novel:author']/@content",
  "cover": "//meta[@property='og:image']/@content",
  "desc": "//meta[@property='og:description']/@content",
  "cat": "//meta[@property='og:novel:category']/@content",
  "lastChapterTitle": "//meta[@property='og:novel:latest_chapter_name']/@content",
  "status": "//meta[@property='og:novel:status']/@content",
  "wordCount": "//span[@class='wordcount']/text()",
  "validConfig": ""
}

优先使用 og:novel:* meta 标签（小说站标配）。字段名注意：
  ✓ lastChapterTitle（正确）  ✗ lastChapter（错误）
  ✓ status（正确）            ✗ state（错误）

━━━ chapterList ━━━

{
  "actionID": "chapterList",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "list": "//div[@id='list']//dd",
  "title": "//a/text()",
  "url": "//a/@href",
  "nextPageUrl": "//a[text()='下一页']/@href",
  "moreKeys": { "maxPage": 500, "skipCount": 0 },
  "validConfig": ""
}

- 如章节列表和书籍详情在同一页面 → 不填 requestInfo（App 自动用 detailUrl）
- 如是独立目录页 → 填 requestInfo（URL 字符串，不支持 @bookUrl@ 占位符）
- 章节 url 是相对路径时，在选择器末尾加 JS 后处理：
    "url": "//a/@href ||@js:\\nreturn params.responseUrl.replace(/\\\\/[^\\\\/]*$/, '') + '/' + result;"
  或直接拼接 host：
    "url": "//a/@href ||@js:\\nreturn config.host + result;"
- nextPageUrl：目录有多页时填写（XPath 选取"下一页"链接）
- moreKeys.maxPage：目录最大翻页次数（通常 500）
- moreKeys.skipCount：跳过列表开头 N 个非章节项（去干扰行）

━━━ chapterContent ━━━

{
  "actionID": "chapterContent",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "content": "//div[@id='content']",
  "nextPageUrl": "//a[text()='下一页']/@href",
  "moreKeys": { "maxPage": 6 },
  "validConfig": ""
}

- content 是正文容器选择器（选整个 div，App 自动提取文本）
- 广告过滤：在 content 选择器末尾使用 |@js: 进行 replace 处理（不存在 filter 字段！）：
    "content": "//div[@id='content'] |@js:\\nreturn result.replace(/广告词.*/g,'').replace(/请收藏.*/g,'');"
  注意：|@js: 是过滤（不备选），||@js: 是有备选时的后处理，两者用途不同
- nextPageUrl：章节有多页时填写
- moreKeys.maxPage：章节最大翻页次数（通常 3~6）
- 若需 WebView 渲染（反爬严重站点）：
    "requestInfo": "@js:\\nreturn {url:result,webView:'',webViewSkipUrls:['hm.baidu.com'],webViewJsDelay:2,forbidCookie:true};"

━━━ 选择器语法完整说明（只用 XPath，不用 CSS）━━━

基础：
  //div[@id='list']/dl/dd        节点路径
  //a/text()                     取文本内容
  //img/@src                     取属性值
  //meta[@property='og:image']/@content

|| 双管道：备选（第一个无结果时尝试第二个）
  "list": "//*[@class='grid']//tr || //*[@class='listBox']//li"

||@js: 双管道接 JS（有备选 + 后处理，result 为 XPath 结果字符串）
  "cover": "//img/@data-src ||@js:\\nreturn result || params.responseUrl;"

|@replace: 单管道文本替换（去除结果中的指定前缀）
  "status": "//p[@class='info']/span[3]|@replace:状态："

|@js: 单管道接 JS（仅处理，不备选，result 为 XPath 结果字符串）
  "content": "//div[@id='content'] |@js:\\nreturn result.replace(/\\\\n/g,'\\n');"

━━━ @js: requestInfo 返回对象字段 ━━━

{
  url: String,            // 请求 URL（必填）
  POST: Boolean,          // true = POST，默认 GET
  httpParams: Object,     // 请求参数（GET 追加 / POST body）
  httpHeaders: Object,    // 请求头
  forbidCookie: Boolean,  // 禁止 Cookie
  cacheTime: Number,      // 缓存秒数
  webView: String,        // 启用 WebView（填 "" 或 true）
  webViewSkipUrls: Array, // WebView 黑名单 URL
  webViewJsDelay: Number  // WebView 等待 JS 秒数
}

@js: 中可用变量：config.host、config.httpHeaders、params.keyWord、
params.pageIndex、params.filters、params.responseUrl、result（上步结果）

━━━ httpHeaders ━━━

顶层 httpHeaders 对所有子规则生效，子规则级 httpHeaders 覆盖顶层：
  "httpHeaders": {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1",
    "Referer": "https://www.example.com"
  }
不需要时填 ""（空字符串）。

━━━ JSParser（复杂站点自定义解析，searchBook 专用）━━━

当站点搜索结果结构复杂、XPath 难以覆盖时，在 searchBook 中使用 JSParser 字段编写完整 JS 函数：

"JSParser": "function parse(config, params, result) {\\n  let list = [];\\n  let xml = params.nativeTool.XPathParserWithSource(result);\\n  let items = xml.queryWithXPath(\\"//div[@class='book-list']//li\\");\\n  for (let i in items) {\\n    list.push({\\n      bookName: items[i].queryWithXPath(\\"//h3/a/text()\\")[0].content(),\\n      detailUrl: items[i].queryWithXPath(\\"//h3/a/@href\\")[0].content(),\\n      author:    items[i].queryWithXPath(\\"//span[@class='author']/text()\\")[0].content(),\\n      cover:     items[i].queryWithXPath(\\"//img/@src\\")[0].content(),\\n      status:    items[i].queryWithXPath(\\"//span[@class='status']/text()\\")[0].content()\\n    });\\n  }\\n  return { list };\\n}"

JSParser 函数参数：config（站点配置）、params（含 nativeTool / responseUrl）、result（响应 HTML 字符串）
params.nativeTool.XPathParserWithSource(html).queryWithXPath(xpath) 返回节点数组，每个节点有 .content() 方法

━━━ bookWorld（分类/发现页，非必须，可留空 {}）━━━

"bookWorld": {
  "分类名": {
    "actionID": "bookWorld",
    "parserID": "DOM",
    "responseFormatType": "html",
    "host": "https://www.example.com",
    "requestInfo": "https://www.example.com/list/%@filter/%@pageIndex.html",
    "list": "//div[@class='book-list']//li",
    "bookName": "//h3/a/text()",
    "author": "//span[@class='author']/text()",
    "cover": "//img/@src",
    "detailUrl": "//h3/a/@href",
    "status": "//span[@class='status']/text()",
    "_sIndex": 1,
    "moreKeys": {
      "pageSize": "20",
      "requestFilters": "玄幻::xuanhuan\\n仙侠::xianxia\\n言情::yanqing"
    },
    "validConfig": ""
  }
}

requestFilters 三种格式（moreKeys.requestFilters）：
  格式一 dict：{"榜单A": "url片段A", "榜单B": "url片段B"}   → value 直接替换 %@filter
  格式二 array：[{"key":"cat","items":[{"title":"玄幻","value":"1"},...]}]  → @js: 中用 params.filters.cat
  格式三 换行字符串："玄幻::1\\n仙侠::2\\n言情::3"    → value 替换 %@filter；多 key 时加 _keyName 行分隔

━━━ 输出要求 ━━━
只输出一个合法 JSON 对象，不含任何解释文字、markdown 代码块或注释。
必须执行自检：
- searchBook.requestInfo 使用真实搜索 URL 或首页 form 推导。
- searchBook.list 是每本书的容器，不是整个列表外壳。
- detailUrl、chapterList.url 若为相对链接，必须用 ||@js: 基于 params.responseUrl 或 config.host 转绝对 URL。
- chapterList 不要把“最新章节/相关推荐/倒序按钮”等非章节项当章节；必要时使用 moreKeys.skipCount。
- chapterContent.content 选正文容器，广告过滤写在 content 的 |@js:，不要输出 filter 字段。
- 字段名必须是 status、lastChapterTitle，不能输出 state、lastChapter。
- shudanDetail、shupingList、shupingHome、searchShudan、relatedWord 至少保留 { "actionID": "...", "parserID": "DOM" } 壳。`;
}

async function callLLM(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  onChunk?: (text: string, kind: StreamChunkKind) => void,
): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const modes = buildRequestModes(config);
  let lastError: unknown;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    if (index > 0 && lastError && modes.length > 1) {
      onChunk?.("", "reset");
      onChunk?.("\n\n[已调整思考扩展参数并自动重试]\n\n", "notice");
    }

    try {
      return await requestChatCompletion(
        baseUrl,
        config,
        buildRequestBody(config, systemPrompt, userPrompt, !!onChunk, mode),
        onChunk,
      );
    } catch (e) {
      lastError = e;
      if (
        shouldRetryWithoutThinking(e) &&
        (mode.kind !== "plain" || mode.temperature !== undefined)
      ) {
        continue;
      }
      throw e;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function requestChatCompletion(
  baseUrl: string,
  config: AiConfig,
  body: ChatCompletionRequest,
  onChunk?: (text: string, kind: StreamChunkKind) => void,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new LlmApiError(res.status, errText);
  }

  if (!onChunk) {
    const data = (await res.json()) as ChatCompletionResponse;
    return data.choices[0]?.message?.content ?? "";
  }

  if (!res.body) throw new Error("LLM API 未返回响应流");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let reasoningStarted = false;
  let contentStarted = false;
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data) as ChatCompletionResponse;
        const reasoning = obj.choices[0]?.delta?.reasoning_content ?? "";
        const delta = obj.choices[0]?.delta?.content ?? "";
        if (reasoning) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            onChunk("[思考]\n", "reasoning");
          }
          onChunk(reasoning, "reasoning");
        }
        if (delta) {
          if (reasoningStarted && !contentStarted) {
            contentStarted = true;
            onChunk("\n\n[输出]\n", "content");
          }
          full += delta;
          onChunk(delta, "content");
        }
      } catch {
        // skip malformed SSE line
      }
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data: ")) {
    try {
      const data = tail.slice(6).trim();
      if (data && data !== "[DONE]") {
        const obj = JSON.parse(data) as ChatCompletionResponse;
        const reasoning = obj.choices[0]?.delta?.reasoning_content ?? "";
        const delta = obj.choices[0]?.delta?.content ?? "";
        if (reasoning) {
          if (!reasoningStarted) {
            reasoningStarted = true;
            onChunk("[思考]\n", "reasoning");
          }
          onChunk(reasoning, "reasoning");
        }
        if (delta) {
          if (reasoningStarted && !contentStarted) {
            contentStarted = true;
            onChunk("\n\n[输出]\n", "content");
          }
          full += delta;
          onChunk(delta, "content");
        }
      }
    } catch {
      // ignore trailing partial frame
    }
  }
  return full;
}

function parseJsonFromResponse(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  cleaned = cleaned.replace(/^```\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned) as Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────
// Composable
// ──────────────────────────────────────────────────────────

export function useAiSourceGenerator() {
  const steps = ref<GenerateStep[]>([]);
  const running = ref(false);
  const streamText = ref("");
  const result = ref<GeneratedSource | null>(null);
  const error = ref<string | null>(null);

  function setStep(index: number, patch: Partial<GenerateStep>) {
    if (steps.value[index]) Object.assign(steps.value[index], patch);
  }

  async function generate(
    siteUrl: string,
    testBook: string,
    aiConfig: AiConfig,
  ): Promise<GeneratedSource | null> {
    running.value = true;
    result.value = null;
    error.value = null;
    streamText.value = "";

    const bookName = testBook.trim() || "斗罗大陆";

    let base: URL;
    try {
      base = new URL(siteUrl);
    } catch {
      error.value = "站点 URL 格式错误";
      running.value = false;
      return null;
    }

    if (!aiConfig.proxyUrl) {
      error.value =
        "请先在配置中填写页面抓取代理 URL（部署 Cloudflare Worker 后填入）";
      running.value = false;
      return null;
    }

    const proxy = aiConfig.proxyUrl;

    steps.value = [
      { label: "获取站点首页", status: "pending" },
      { label: `搜索《${bookName}》`, status: "pending" },
      { label: "获取书籍详情页", status: "pending" },
      { label: "获取章节列表", status: "pending" },
      { label: "读取第一章正文", status: "pending" },
      { label: "AI 分析生成书源", status: "pending" },
      { label: "解析并验证 JSON", status: "pending" },
    ];

    let homeHtml = "";
    let searchHtml = "";
    let searchUrl = "";
    let searchNote = "";
    let searchFormHints: string[] = [];
    let bookDetailHtml = "";
    let bookDetailUrl = "";
    let chapterListHtml = "";
    let chapterListUrl = "";
    let chapterHtml = "";
    let firstChapterUrl = "";
    let adCandidates: string[] = [];

    try {
      // ── Step 0: Homepage ────────────────────────────────
      setStep(0, { status: "running" });
      try {
        homeHtml = await fetchPage(siteUrl, proxy);
        searchFormHints = extractSearchFormHints(homeHtml, siteUrl);
        setStep(0, { status: "done", detail: `${homeHtml.length} 字符` });
      } catch (e) {
        setStep(0, { status: "error", detail: String(e) });
        throw e;
      }

      // ── Step 1: Search ──────────────────────────────────
      setStep(1, { status: "running" });
      try {
        const candidates = buildSearchCandidates(homeHtml, siteUrl, bookName);
        for (const candidate of candidates) {
          try {
            const html = await fetchPage(candidate.url, proxy);
            if (html.length > 500 && html.includes(bookName.slice(0, 2))) {
              searchHtml = html;
              searchUrl = candidate.url;
              searchNote = candidate.note;
              break;
            }
          } catch {
            // try next
          }
        }
        setStep(1, {
          status: "done",
          detail: searchHtml
            ? `${searchHtml.length} 字符 · ${searchNote}`
            : `未找到搜索结果，尝试 ${candidates.length} 个候选`,
        });
      } catch {
        setStep(1, { status: "done", detail: "跳过" });
      }

      // ── Step 2: Book detail ─────────────────────────────
      setStep(2, { status: "running" });
      if (searchHtml) {
        try {
          bookDetailUrl = findBookUrl(searchHtml, searchUrl || siteUrl, bookName) ?? "";
          if (bookDetailUrl) {
            bookDetailHtml = await fetchPage(bookDetailUrl, proxy);
            setStep(2, { status: "done", detail: bookDetailUrl });
          } else {
            setStep(2, {
              status: "done",
              detail: "未能从搜索结果提取书籍链接，跳过",
            });
          }
        } catch (e) {
          setStep(2, {
            status: "done",
            detail: `获取失败: ${String(e).slice(0, 80)}`,
          });
        }
      } else {
        setStep(2, { status: "done", detail: "无搜索结果，跳过" });
      }

      // ── Step 3: Chapter list ────────────────────────────
      setStep(3, { status: "running" });
      if (bookDetailHtml) {
        if (
          /第[零一二三四五六七八九十百千\d]+章|第[一1]卷/.test(bookDetailHtml)
        ) {
          chapterListHtml = bookDetailHtml;
          chapterListUrl = bookDetailUrl;
          setStep(3, { status: "done", detail: "与书籍详情同页面" });
        } else {
          const catalogCandidates = [
            bookDetailUrl.replace(/\/info\/(\d+)\/?.*$/, "/catalog/$1/"),
            bookDetailUrl.replace(/\/book\/(\d+)\/?.*$/, "/catalog/$1/"),
            bookDetailUrl.replace(/\.html?$/, "/catalog.html"),
            bookDetailUrl.replace(/\.html?$/, "/"),
            bookDetailUrl + "catalog/",
          ].filter((u, i, arr) => u !== bookDetailUrl && arr.indexOf(u) === i);

          let found = false;
          for (const url of catalogCandidates) {
            try {
              const html = await fetchPage(url, proxy);
              if (/第[零一二三四五六七八九十百千\d]+章|第[一1]卷/.test(html)) {
                chapterListHtml = html;
                chapterListUrl = url;
                setStep(3, { status: "done", detail: `独立页面: ${url}` });
                found = true;
                break;
              }
            } catch {
              // skip
            }
          }
          if (!found) {
            chapterListHtml = bookDetailHtml;
            chapterListUrl = bookDetailUrl;
            setStep(3, {
              status: "done",
              detail: "使用书籍详情页（无独立目录页）",
            });
          }
        }
      } else {
        setStep(3, { status: "done", detail: "无书籍详情，跳过" });
      }

      // ── Step 4: First chapter ───────────────────────────
      setStep(4, { status: "running" });
      if (chapterListHtml) {
        try {
          firstChapterUrl =
            findFirstChapterUrl(chapterListHtml, chapterListUrl || siteUrl) ?? "";
          if (firstChapterUrl) {
            chapterHtml = await fetchPage(firstChapterUrl, proxy);
            adCandidates = extractAdCandidates(chapterHtml);
            setStep(4, {
              status: "done",
              detail: `${chapterHtml.length} 字符，广告候选词 ${adCandidates.length} 条`,
            });
          } else {
            setStep(4, { status: "done", detail: "未能提取章节链接，跳过" });
          }
        } catch (e) {
          setStep(4, {
            status: "done",
            detail: `获取失败: ${String(e).slice(0, 80)}`,
          });
        }
      } else {
        setStep(4, { status: "done", detail: "无章节列表，跳过" });
      }

      // ── Step 5: AI generation ───────────────────────────
      setStep(5, { status: "running" });

      const parts: string[] = [];
      parts.push(`站点主 URL: ${siteUrl}`);
      parts.push(
        `\n\n【站点首页 HTML】\n${cleanHtml(homeHtml, 8000)}`,
      );
      parts.push(
        `\n\n【首页搜索线索】\n- 表单线索: ${searchFormHints.length ? searchFormHints.join(" | ") : "无"}\n- 搜索候选数: ${buildSearchCandidates(homeHtml, siteUrl, bookName).length}`,
      );

      if (searchHtml) {
        parts.push(
          `\n\n【已命中的搜索结果页】\n- URL: ${searchUrl}\n- 说明: ${searchNote}\n${cleanHtml(searchHtml, 8000)}`,
        );
      }

      if (bookDetailHtml) {
        parts.push(
          `\n\n【书籍详情页 HTML】\n- URL: ${bookDetailUrl}\n${cleanHtml(bookDetailHtml, 6000)}`,
        );
      }

      if (chapterListHtml) {
        parts.push(
          `\n\n【章节列表页 HTML】\n- URL: ${chapterListUrl}\n${cleanHtml(chapterListHtml, 8000)}`,
        );
      }

      if (chapterHtml) {
        parts.push(
          `\n\n【第一章正文 HTML】\n- URL: ${firstChapterUrl}\n${cleanHtml(chapterHtml, 8000)}`,
        );
      }

      if (adCandidates.length > 0) {
        parts.push(
          `\n\n【疑似广告/噪声文本】\n${adCandidates.slice(0, 20).join("\n")}`,
        );
      }

      parts.push(`\n\n任务：
请根据以上证据生成一个可直接导入的完整香色闺阁书源 JSON。
优先级：
1. 正确性高于覆盖率。
2. 先保证 searchBook / bookDetail / chapterList / chapterContent 可用。
3. 只有在页面证据充分时再补 bookWorld、shudan、shuping、relatedWord。
4. 遇到相对路径，优先用 ||@js: 基于 params.responseUrl 处理。
5. 章节列表和正文中出现的“上一页/下一页/目录/最新章节/加入书架/推荐票”等噪声要排除。
6. 正文广告过滤必须写进 content 的 |@js:，不要使用 filter 字段。
7. 字段命名必须严格遵守文档，尤其是 status、lastChapterTitle、sourceType、httpHeaders。
8. 若某规则没有足够证据，宁可输出空壳，也不要猜。
`);

      let llmText = "";
      try {
        llmText = await callLLM(
          aiConfig,
          buildSystemPrompt(),
          parts.join(""),
          (chunk, kind) => {
            if (kind === "reset") {
              streamText.value = "";
              return;
            }
            streamText.value += chunk;
          },
        );
        setStep(5, { status: "done" });
      } catch (e) {
        setStep(5, { status: "error", detail: String(e) });
        throw e;
      }

      // ── Step 6: Parse JSON ──────────────────────────────
      setStep(6, { status: "running" });
      let raw: Record<string, unknown>;
      try {
        raw = parseJsonFromResponse(llmText || streamText.value);
        setStep(6, { status: "done" });
      } catch (e) {
        setStep(6, {
          status: "error",
          detail: "JSON 解析失败: " + String(e),
        });
        throw new Error(
          "模型返回内容不是合法 JSON，请重试或手动调整。\n" + String(e),
        );
      }

      const warnings = validateGeneratedSource(raw, base, siteUrl);

      const out: GeneratedSource = {
        raw,
        warning: warnings.length ? warnings.join("；") : undefined,
      };
      result.value = out;
      return out;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      running.value = false;
    }
  }

  function reset() {
    steps.value = [];
    running.value = false;
    streamText.value = "";
    result.value = null;
    error.value = null;
  }

  return { steps, running, streamText, result, error, generate, reset };
}
