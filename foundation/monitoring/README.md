# foundation/monitoring

## 解决什么问题

"It broke in production" → "Where? Why? What was the request?"

没有结构化日志、指标和链路追踪，排查生产问题就是考古。`console.log` 在开发时方便，但在生产环境面对每秒数百请求、跨多个服务时完全失效——你需要 JSON 格式（机器可解析）、维度指标（按 method/status/endpoint 切片）、分布式追踪（跨服务关联一个请求的完整链路）。

这个模块提供四个核心能力：**结构化日志**、**指标采集**、**分布式追踪**、**健康检查**，全部零运行时依赖。

## 为什么这样设计

| 决策 | 原因 | 权衡 |
|------|------|------|
| JSON 日志输出 | 文本日志在超过 10 req/s 后就无法 grep 了。JSON 可以被 ELK、Datadog、CloudWatch 等直接索引 | 人眼不友好，所以提供 `text` 格式用于开发 |
| Prometheus 兼容指标 | 事实上的标准，所有现代监控栈都能 scrape | 没有 push 模式，需要 /metrics 端点 |
| W3C Trace Context | 跨服务追踪需要标准格式，W3C 是 OpenTelemetry、Jaeger、Zipkin 都支持的 | 比私有格式多几个字节的 header 开销 |
| 内置 PII 脱敏 | GDPR/合规不是可选项，密码、token、身份证号不应该出现在日志里 | 按 key 名匹配，不能处理所有场景 |
| 健康检查分 readiness/liveness | Kubernetes 需要两者：readiness 控制流量，liveness 控制重启 | 简单应用可能觉得多余 |
| 零运行时依赖 | 可观测性太基础了，不应该依赖重量级库。启动快、bundle 小 | 没有 OTLP 直接导出，需要自己实现 exporter |

## 快速使用

### 安装

```bash
cd foundation/monitoring
npm install
npm run build
```

### 结构化日志

```typescript
import { createLogger } from "./src/index.js";

// 生产环境：JSON 输出
const logger = createLogger({
  level: "info",
  format: "json",
  redactPaths: ["password", "token", "authorization"],
  defaultContext: { service: "user-api", version: "1.2.0" },
});

logger.info("Server started", { port: 3000 });
// {"level":"info","message":"Server started","timestamp":"2026-03-14T...","context":{"service":"user-api","version":"1.2.0","port":3000}}

// 子日志器：继承上下文 + 添加新上下文
const reqLogger = logger.child({ requestId: "req-abc-123" });
reqLogger.info("Handling request", { method: "POST", path: "/api/users" });

// PII 自动脱敏
reqLogger.warn("Login failed", { username: "alice", password: "s3cret" });
// password 字段会输出为 "[REDACTED]"

// 关联追踪 ID
reqLogger.setTraceContext("trace-id-xyz", "span-id-123");
reqLogger.info("Database query completed"); // 自动带上 traceId, spanId
```

### 指标采集

```typescript
import { createMetrics } from "./src/index.js";

const metrics = createMetrics({ prefix: "myapp", defaultLabels: { env: "production" } });

// Counter: 单调递增
metrics.counter("http_requests_total", { method: "GET", status: "200" });

// Gauge: 当前值
metrics.gauge("active_connections", 42);

// Histogram: 值分布
metrics.registerHistogram("request_duration_seconds", "HTTP request duration", {
  boundaries: [0.01, 0.05, 0.1, 0.5, 1, 5],
});
metrics.histogram("request_duration_seconds", 0.127, { endpoint: "/api/users" });

// Prometheus 文本格式（挂到 /metrics 端点）
const output = metrics.toPrometheus();
```

### 分布式追踪

```typescript
import { createTracer, createInMemoryExporter, toTraceParent } from "./src/index.js";

const tracer = createTracer({
  serviceName: "order-service",
  sampleRate: 0.1, // 采样 10% 的请求
  exporter: myOtlpExporter, // 替换为你的后端
});

// 从入站请求的 traceparent header 继续追踪
const span = tracer.startSpanFromHeader("handle-order", req.headers["traceparent"]);
if (span) {
  span.setAttribute("http.method", "POST");
  span.setAttribute("order.id", orderId);

  // 创建子 span
  const dbSpan = span.startChild("db.query");
  // ... 执行数据库查询 ...
  dbSpan.setStatus("ok");
  dbSpan.end();

  // 传播到下游服务
  const outboundHeader = toTraceParent(span.traceContext());
  // 设置到出站请求的 traceparent header

  span.setStatus("ok");
  span.end();
}
```

### 健康检查

```typescript
import { createHealthCheck } from "./src/index.js";

const health = createHealthCheck({
  dependencies: {
    postgres: async () => {
      await db.query("SELECT 1");
      return { status: "healthy" };
    },
    redis: async () => {
      await redis.ping();
      return { status: "healthy" };
    },
    stripe: async () => {
      // 外部服务降级不应该让应用不可用
      try {
        await fetch("https://api.stripe.com/healthcheck");
        return { status: "healthy" };
      } catch {
        return { status: "degraded", message: "Stripe API unreachable" };
      }
    },
  },
});

// Kubernetes readiness probe: GET /healthz/ready
app.get("/healthz/ready", async (req, res) => {
  const result = await health.readiness();
  res.status(result.status === "healthy" ? 200 : 503).json(result);
});

// Kubernetes liveness probe: GET /healthz/live
app.get("/healthz/live", async (req, res) => {
  const result = await health.liveness();
  res.status(200).json(result);
});
```

## 配置项

### Logger

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `level` | `LogLevel` | `"info"` | 最低输出级别 |
| `format` | `"json" \| "text"` | `"json"` | 输出格式 |
| `redactPaths` | `string[]` | `[]` | 需要脱敏的 key 名 |
| `defaultContext` | `Record<string, unknown>` | `{}` | 每条日志自动附带的上下文 |
| `output` | `(line: string) => void` | `stdout` | 自定义输出函数 |

### Metrics

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `prefix` | `string` | `undefined` | 指标名前缀 |
| `defaultLabels` | `Record<string, string>` | `{}` | 所有指标自动附带的标签 |

### Tracer

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `serviceName` | `string` | (必填) | 服务名 |
| `sampleRate` | `number` | `1` | 采样率 (0-1) |
| `exporter` | `TraceExporter` | `undefined` | Span 导出后端 |

### Health Check

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dependencies` | `Record<string, () => Promise<...>>` | `{}` | 依赖检查函数 |

## 来源 & 致谢

- [pinojs/pino](https://github.com/pinojs/pino) — JSON-first structured logging with child loggers is the right abstraction
- [OpenTelemetry](https://opentelemetry.io/) — W3C Trace Context + span model covers all distributed tracing needs
- [Prometheus](https://prometheus.io/docs/instrumenting/exposition_formats/) — Prometheus text exposition format

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 pino、OpenTelemetry 概念和 Prometheus 指标模式中综合提炼，创建零依赖的可观测性基础模块 |
