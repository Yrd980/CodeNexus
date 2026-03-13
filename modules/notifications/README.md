# Notifications

## 解决什么问题

Startup 团队总是临时凑合通知系统——硬编码的邮件字符串、没有用户偏好管理、没有投递追踪。结果是：用户被垃圾通知淹没，重要通知又被忽略，客服每天都在回答"我为什么没收到通知"。这个模块提供一个完整的多渠道通知架构：模板引擎、用户偏好、投递追踪、批量摘要，零运行时依赖，任何 Startup 都能直接用。

## 为什么这样设计

**多渠道分发器（Dispatcher）**：因为"先只做邮件"的想法撑不过 6 个月——产品一定会要求加 push、SMS、站内信。分发器模式让你加新渠道只需实现一个 `ChannelProvider` 接口，不动核心逻辑。

**模板引擎**：硬编码通知字符串是维护噩梦。但引入 MJML/Handlebars 这种重型模板系统又过早。我们选择 Mustache 子集（变量插值、条件、循环），覆盖 90% 通知场景，且零依赖。需要复杂邮件布局？在上游渲染好 HTML 传进来。

**用户偏好管理**：GDPR 要求用户能控制通知。更务实的原因是——用户会退订你的产品如果你不让他们关掉营销通知。按通知类型 × 渠道的粒度是最佳平衡点：够细以至于用户满意，不至于细到配置爆炸。

**静默时段（Quiet Hours）**：凌晨 3 点推 push 通知是产品自杀。但紧急通知（如安全警报）必须穿透静默时段，所以有 priority = "urgent" 的旁路机制。

**频率限制**：用滑动窗口限制每用户每小时通知数。防止批量操作触发通知轰炸。

**投递追踪**：通知的生命周期是 pending → sent → delivered → read。没有这个追踪，你无法回答"用户到底收到没有"。内置失败重试（指数退避）。

**Mock Providers**：通知代码必须能测试。Mock 记录所有发送行为，让你在 CI 中验证逻辑而不发真邮件。

**权衡**：

- 模板引擎故意简单——不支持 partial/layout/inheritance。如果你需要，说明你该用专业邮件模板工具了。
- 偏好存储用内存实现——生产环境换成数据库实现 `PreferenceStore` 接口。
- 静默时段用本地时间比较——生产环境应该用 Intl/luxon 做时区转换。
- 没有队列集成——Startup 初期直接同步发送足够，需要异步时接入 `patterns/queue-worker`。

## 快速使用

```typescript
import {
  NotificationDispatcher,
  createMockProviders,
  type NotificationConfig,
  type Template,
} from "@codenexus/notifications";

// 1. 定义模板
const welcomeTemplate: Template = {
  id: "welcome",
  name: "Welcome Email",
  channel: "email",
  subject: "Welcome to {{appName}}, {{userName}}!",
  body: "Hi {{userName}}, thanks for joining {{appName}}. {{#if isPremium}}You have premium access!{{/if}}",
};

// 2. 配置（用 mock providers 开发/测试，生产换成真实 provider）
const providers = createMockProviders();
const config: NotificationConfig = {
  providers,
  defaultFrom: "hello@myapp.com",
  templates: { welcome: welcomeTemplate },
  defaultRateLimitPerHour: 0,
  retryDelayMs: 1000,
  maxRetries: 3,
};

// 3. 创建分发器
const dispatcher = new NotificationDispatcher(config);

// 4. 发送通知
const results = await dispatcher.send({
  userId: "user-123",
  templateId: "welcome",
  data: { userName: "Alice", appName: "MyStartup", isPremium: true },
});

console.log(results[0].result.success); // true

// 5. 多渠道发送
await dispatcher.send({
  userId: "user-123",
  templateId: "welcome",
  data: { userName: "Alice", appName: "MyStartup", isPremium: false },
  channels: ["email", "push", "in_app"],
});

// 6. 设置用户偏好
dispatcher.preferences.setChannelPreference(
  "user-123",
  "marketing",
  "email",
  { enabled: false },
);

dispatcher.preferences.setQuietHours("user-123", {
  startHour: 22,
  endHour: 8,
  timezone: "Asia/Shanghai",
});

// 7. 批量摘要模式
dispatcher.addToDigest({
  userId: "user-123",
  templateId: "welcome",
  data: { userName: "Alice", appName: "MyStartup" },
  groupKey: "daily-digest",
});
// ... 积累更多 ...
await dispatcher.flushDigest("digest-template-id");

// 8. 投递追踪
const stats = dispatcher.tracker.getAnalytics();
console.log(`Delivery rate: ${stats.deliveryRate}`);
console.log(`Read rate: ${stats.readRate}`);
```

### 实现自定义 Provider

```typescript
import type { ChannelProvider, Notification, SendResult } from "@codenexus/notifications";

class SendGridProvider implements ChannelProvider {
  readonly channel = "email" as const;

  async send(notification: Notification): Promise<SendResult> {
    try {
      // 调用 SendGrid API
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: notification.userId }] }],
          from: { email: "hello@myapp.com" },
          subject: notification.subject,
          content: [{ type: "text/html", value: notification.body }],
        }),
      });

      return {
        success: response.ok,
        messageId: response.headers.get("x-message-id") ?? undefined,
        error: response.ok ? undefined : await response.text(),
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
```

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `providers` | `Record<channel, ChannelProvider>` | — | 各渠道的投递实现 |
| `defaultFrom` | `string` | — | 默认发送者标识 |
| `templates` | `Record<string, Template>` | — | 通知模板字典 |
| `defaultRateLimitPerHour` | `number` | `0` | 全局频率限制（0=不限） |
| `retryDelayMs` | `number` | `1000` | 重试基础延迟（指数退避） |
| `maxRetries` | `number` | `3` | 最大重试次数 |

### 模板语法

| 语法 | 说明 | 示例 |
|------|------|------|
| `{{variable}}` | 变量插值 | `Hello {{name}}` |
| `{{obj.prop}}` | 嵌套属性 | `{{user.email}}` |
| `{{#if var}}...{{/if}}` | 条件块 | `{{#if premium}}VIP{{/if}}` |
| `{{#each list}}...{{/each}}` | 循环 | `{{#each items}}{{.name}}{{/each}}` |

### 用户偏好

| 功能 | 方法 | 说明 |
|------|------|------|
| 渠道开关 | `setChannelPreference()` | 按通知类型 × 渠道 启用/禁用 |
| 静默时段 | `setQuietHours()` | 非紧急通知在指定时段内不发送 |
| 频率限制 | `setFrequencyCap()` | 每用户每小时最大通知数 |

## 来源 & 致谢

- [Novu](https://github.com/novuhq/novu) — 多渠道通知基础设施的架构参考，学到了 provider 抽象 + 用户偏好的分层设计
- [Resend](https://resend.com) — 简洁模板引擎优于复杂邮件构建器的理念

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Novu 架构模式提炼，简化为 Startup 可直接使用的通知模块 |
