# Chrome Extension MV3 Starter

## 解决什么问题

Chrome 扩展有一套独特的架构：background service worker、content script、popup 三者之间通过消息传递通信。Manifest V3 彻底改变了 V2 的模式（background page → service worker，`chrome.browserAction` → `chrome.action`，移除远程代码执行等），但绝大多数教程仍然基于 V2。

最常见的三个坑：

1. **消息类型不匹配** — `sendMessage` 和 `onMessage` 之间没有类型约束，运行时才发现 payload 结构不对
2. **Service worker 生命周期** — MV3 的 service worker 随时可能被终止，全局变量不可靠，`setInterval` 不可用
3. **Storage 无类型** — `chrome.storage` 返回 `any`，拼错 key 名编译器不会提醒

这个 starter 用 TypeScript 严格模式 + 判别联合类型解决以上所有问题。

## 为什么这样设计

| 决策 | 选择 | 权衡 |
|------|------|------|
| Manifest V3 only | V3 | V2 已弃用，Chrome Web Store 不再接受 V2 扩展 |
| 判别联合类型做消息传递 | Discriminated union on `type` field | 编译时捕获消息类型错误，代价是每加一种消息需要更新类型定义 |
| Storage 类型包装 | Typed wrapper over chrome.storage | 默认值 + 迁移 + onChange 类型收窄，代价是一层薄抽象 |
| 依赖注入所有 Chrome API | Interface abstractions | 测试不需要真实浏览器，代价是初始化时需要传入 API 对象 |
| Service worker 用 alarms 代替 setInterval | chrome.alarms | Service worker 随时会被终止，alarms 能存活 |
| textContent 默认注入 | Safe by default | 防止 XSS，如需 HTML 需显式 opt-in `trustContent` |
| 零运行时依赖 | devDeps only | 扩展需要极小的 bundle size |

## 快速使用

### 1. 定义消息类型

在 `src/types.ts` 中添加新的消息类型：

```typescript
// 添加新消息到 Message 联合类型
export interface MyCustomMessage {
  readonly type: "MY_CUSTOM";
  readonly data: string;
}

export type Message = /* 已有类型 */ | MyCustomMessage;

// 在 MessageResponseMap 中添加响应类型
export type MessageResponseMap = {
  // ...已有映射
  MY_CUSTOM: { processed: boolean };
};
```

### 2. Background Service Worker

```typescript
import { createServiceWorker } from "./background/service-worker";
import { createTypedStorage } from "./storage";

const storage = createTypedStorage({ backend: chrome.storage.local });

const sw = createServiceWorker({
  runtime: chrome.runtime,
  alarms: chrome.alarms,
  action: chrome.action,
  tabs: chrome.tabs,
});

sw.onMessage("GET_TAB_INFO", async () => {
  const tab = await sw.getActiveTab();
  return tab ?? { id: 0, url: "", title: "", active: false };
});

sw.onMessage("SET_STORAGE", async (msg) => {
  await storage.set(msg.key, msg.value);
  return { success: true };
});

// 定时任务（代替 setInterval）
sw.scheduleAlarm("cleanup-cache", 60);
sw.onAlarm("cleanup-cache", async () => {
  const cache = await storage.get("cache");
  const valid = cache.filter((e) => e.expiresAt > Date.now());
  await storage.set("cache", valid);
});

sw.start();
```

### 3. Content Script

```typescript
import { createContentScript } from "./content/content-script";
import { createDOMObserver, extractPageData } from "./content/content-script";

const cs = createContentScript({
  runtime: chrome.runtime,
  onInit: async (ctx) => {
    const pageData = extractPageData(document);
    await cs.sendMessage({
      type: "CONTENT_READY",
      url: ctx.url,
      title: pageData.title,
    });
  },
  onCleanup: () => {
    observer.stop();
  },
});

const observer = createDOMObserver({
  selector: ".target-element",
  onAdded: (elements) => {
    elements.forEach((el) => { /* 处理新元素 */ });
  },
});
observer.start();
cs.addCleanup(() => observer.stop());
```

### 4. Popup

```typescript
import { createPopup, detectTheme } from "./popup/popup";
import { createTypedStorage } from "./storage";

const storage = createTypedStorage({ backend: chrome.storage.local });

const popup = createPopup({
  runtime: chrome.runtime,
  storage,
  onStateChange: (state) => {
    // 更新 UI
    document.getElementById("status")!.textContent =
      state.enabled ? "Enabled" : "Disabled";
  },
});

await popup.init();

// 主题检测
const theme = detectTheme();
document.body.classList.add(`theme-${theme}`);
```

### 5. 生成 Manifest

```typescript
import { createManifest } from "./manifest";

const manifest = createManifest({
  name: "My Extension",
  version: "1.0.0",
  description: "Does cool things",
})
  .addPermissions("storage", "alarms")
  .addOptionalPermissions("tabs")
  .setServiceWorker("background.js", { type: "module" })
  .addContentScript({
    matches: ["https://*.example.com/*"],
    js: ["content.js"],
    run_at: "document_idle",
  })
  .setAction({ default_popup: "popup.html" })
  .toJSON();
```

## 模块结构

```
starters/chrome-extension/
├── src/
│   ├── types.ts                    # 共享类型（消息、存储、状态）
│   ├── manifest.ts                 # Manifest V3 生成器
│   ├── messaging.ts                # 类型安全消息传递
│   ├── storage.ts                  # 类型安全 Storage 包装
│   ├── background/
│   │   └── service-worker.ts       # Service worker 模式
│   ├── content/
│   │   └── content-script.ts       # Content script 模式
│   ├── popup/
│   │   └── popup.ts                # Popup 状态管理
│   ├── utils/
│   │   └── permissions.ts          # 权限管理
│   └── index.ts                    # 公共 API 导出
├── tests/
│   └── chrome-extension.test.ts    # 完整测试套件
├── package.json
├── tsconfig.json
├── .meta.yml
└── README.md
```

## 配置项

### StorageSchema（`src/types.ts`）

| Key | Type | Default | 说明 |
|-----|------|---------|------|
| `enabled` | `boolean` | `true` | 扩展启用状态 |
| `preferences` | `UserPreferences` | `{ theme: "system", notifications: true, language: "en" }` | 用户偏好 |
| `cache` | `CacheEntry[]` | `[]` | 带 TTL 的缓存数据 |
| `schemaVersion` | `number` | `1` | 存储 schema 版本（用于迁移） |

### Message Types（`src/types.ts`）

| Type | Payload | Response |
|------|---------|----------|
| `GET_TAB_INFO` | — | `TabInfo` |
| `GET_STORAGE` | `key` | `StorageSchema[key]` |
| `SET_STORAGE` | `key`, `value` | `{ success: boolean }` |
| `EXECUTE_ACTION` | `action`, `payload?` | `{ result: unknown }` |
| `CONTENT_READY` | `url`, `title` | `{ acknowledged: boolean }` |

要添加自定义消息类型，更新 `Message` 联合类型和 `MessageResponseMap`。

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | Chrome MV3 已成为唯一选择，需要一个类型安全的起步模板 |
