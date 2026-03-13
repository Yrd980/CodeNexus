# Full-Text Search Engine

## 解决什么问题

几乎所有应用都需要搜索功能。但在 Day 1 就上 Elasticsearch 是过度工程化——你需要维护一个 Java 集群、处理索引同步、学习 DSL 查询语法。大多数 Startup 在 10 万文档以内，完全可以用一个进程内的搜索引擎覆盖 80% 的场景。

这个模块实现了搜索引擎的核心原语：倒排索引、TF-IDF 评分、模糊匹配、分面搜索。零运行时依赖，TypeScript 严格模式，可以直接导入到任何 Node.js 项目中。

## 为什么这样设计

**倒排索引（Inverted Index）** — 这是所有搜索引擎的基础数据结构。Elasticsearch、Lucene、MeiliSearch 底层都是倒排索引。理解它，你就理解了搜索的本质：把"文档 -> 词"的关系反转为"词 -> 文档列表"。

**TF-IDF 评分（带平滑 IDF）** — 最简单且有效的相关性评分。词频（TF）衡量"这个词在这篇文档中有多重要"，逆文档频率（IDF）衡量"这个词在整个语料库中有多稀有"。我们使用 `log(1 + N/df)` 平滑公式，确保即使是单文档场景也能正确评分。

**模糊匹配（Levenshtein Distance）** — 用户会打错字。编辑距离是最通用的模糊匹配算法，支持插入、删除、替换操作。可配置阈值，不会影响精确搜索的性能。

**分面搜索（Faceted Search）** — 搜索 UI 的另一半。用户不仅需要输入关键词，还需要按分类、标签、价格区间等维度筛选结果。分面从搜索结果集中实时计算，确保计数准确。

**进程内，非分布式** — 这是一个有意的权衡。进程内意味着零网络延迟、零部署复杂度、零运维成本。当你的数据量超过 10 万条，再考虑迁移到 MeiliSearch 或 Elasticsearch。

### 权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 进程内而非独立服务 | 零延迟、零运维 | 不适合超大数据集、不跨进程共享 |
| TF-IDF 而非 BM25 | 简单直观、容易理解和调试 | BM25 对长文档的归一化更好 |
| Levenshtein 而非 n-gram | 精确控制编辑距离 | 大词汇表时遍历较慢 |
| 运行时计算分面而非预计算 | 始终准确、无同步问题 | 大结果集时计算成本高 |

## 快速使用

```typescript
import { createSearchEngine } from "@codenexus/search";

// 1. 创建搜索引擎
const engine = createSearchEngine({
  fields: ["title", "body", "tags"],
  weights: { title: 3, body: 1, tags: 2 },
  fuzzyThreshold: 0.2, // 允许 20% 的编辑距离
});

// 2. 添加文档
engine.addAll([
  {
    id: "1",
    title: "Getting Started with TypeScript",
    body: "TypeScript adds static types to JavaScript...",
    tags: ["typescript", "javascript", "tutorial"],
    category: "programming",
  },
  {
    id: "2",
    title: "React Hooks Deep Dive",
    body: "Understanding useState, useEffect, and custom hooks...",
    tags: ["react", "hooks", "frontend"],
    category: "frontend",
  },
]);

// 3. 搜索
const { results, totalCount } = engine.search("typescript");

// 4. 精确短语搜索
const phraseResults = engine.search('"static types"');

// 5. 字段限定搜索
const titleOnly = engine.search("title:typescript");

// 6. OR 搜索
const orResults = engine.search("typescript react", { operator: "OR" });

// 7. 分面搜索
const withFacets = engine.search("programming", {
  operator: "OR",
  facets: [{ field: "category" }, { field: "tags", limit: 5 }],
  facetFilters: { category: "programming" },
});

// 8. 分页
const page2 = engine.search("guide", { offset: 10, limit: 10 });

// 9. 模糊搜索（容错拼写错误）
const fuzzyResults = engine.search("typscript", { fuzzy: true });

// 10. 增量更新
engine.update({ id: "1", title: "Updated Title", body: "...", tags: [], category: "updated" });
engine.remove("2");
```

## 配置项

### SearchConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fields` | `string[]` | (必填) | 要索引的文档字段列表 |
| `weights` | `Record<string, number>` | 所有字段权重 1 | 字段权重，影响搜索评分 |
| `fuzzyThreshold` | `number` (0-1) | `0` | 模糊匹配阈值，0=精确匹配 |
| `tokenizer` | `TokenizerFn` | 内置分词器 | 自定义分词函数 |
| `stopWords` | `string[]` | 英语停用词 | 自定义停用词列表 |
| `idField` | `string` | `"id"` | 文档唯一标识字段名 |
| `scoringStrategy` | `"tfidf" \| "bm25"` | `"tfidf"` | 评分算法 |

### SearchOptions

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | `number` | `10` | 返回结果数量上限 |
| `offset` | `number` | `0` | 跳过结果数量（分页） |
| `fuzzy` | `boolean` | 取决于 fuzzyThreshold | 是否启用模糊匹配 |
| `maxFuzzyDistance` | `number` | `2` | 最大编辑距离 |
| `operator` | `"AND" \| "OR"` | `"AND"` | 多词查询的布尔运算符 |
| `facets` | `FacetConfig[]` | `[]` | 分面配置 |
| `facetFilters` | `Record<string, string \| string[]>` | `{}` | 分面过滤条件 |

## 架构

```
Query: "typescript guide"
         │
         ▼
   ┌─────────────┐
   │ Query Parser │  → terms: ["typescript", "guide"]
   └─────┬───────┘    phrases: [], fieldTerms: {}
         │
         ▼
   ┌──────────────┐
   │  Tokenizer   │  → lowercase, strip punctuation, remove stop words
   └─────┬────────┘
         │
         ▼
   ┌──────────────────┐
   │  Inverted Index   │  → "typescript" → [{doc:1, field:"title", tf:1}, ...]
   │  (term → postings)│    "guide"      → [{doc:1, field:"title", tf:1}, ...]
   └─────┬────────────┘
         │
         ▼
   ┌──────────────┐
   │  TF-IDF      │  → score = (1 + log(tf)) * log(1 + N/df) * fieldWeight
   │  Scoring     │
   └─────┬────────┘
         │
         ▼
   ┌──────────────┐
   │  Facets +    │  → category: [{value:"programming", count:2}, ...]
   │  Filtering   │
   └─────┬────────┘
         │
         ▼
   ┌──────────────┐
   │  Highlights  │  → title: "Introduction to <mark>TypeScript</mark>"
   │  + Pagination│
   └──────────────┘
```

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 MiniSearch/Lunr.js 的设计中提炼核心模式，为 Startup 提供零依赖的搜索基础 |
| 2026-03-14 | IDF 公式从 `log(N/df)` 改为 `log(1+N/df)` | 标准 IDF 在单文档语料库中返回 0，平滑公式确保任何规模都能正确评分 |
