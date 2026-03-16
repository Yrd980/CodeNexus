# 🦞 OpenClaw 第一性原理验证 Rubric

> 当 OpenClaw 准备提炼产物或形成 PR hypothesis 时，用这个 rubric 判断现有验证是否只是“容易过”，还是真的足以支撑结论。

## 核心原则

测试不是表演。  
如果验证只证明“测试会绿”，而没有证明“设计在现实中成立”，那就不够。

## 三层验证

### 1. Runtime Truth

必须回答：

- 是否按 README 或最小启动路径真实运行过
- 是否确认不是纸上产物

### 2. Assumption Break

必须回答：

- 至少一个关键假设被故意打破了吗
- 系统是否在正确边界失败

### 3. Portability

必须回答：

- 从原项目提炼出来后，是否还偷偷依赖原项目内部上下文
- 放进陌生上下文时，接口是否仍然自洽

## 输出

```json
{
  "runtime_truth": {
    "done": true,
    "notes": ["说明"]
  },
  "assumption_break": {
    "done": true,
    "notes": ["说明"]
  },
  "portability": {
    "done": true,
    "notes": ["说明"]
  },
  "overall_assessment": "strong",
  "blocking_decision": "proceed | research-more | stop",
  "gaps": [
    "缺口 1"
  ],
  "immediate_actions": [
    "下一步最该做什么"
  ]
}
```

## 结论规则

- `strong`：三层验证都具备，且没有明显空洞
- `partial`：有单测和部分证据，但还不能支撑强结论
- `weak`：主要是 happy path 或静态阅读，不能用于高信心提炼 / PR

## 动作规则

- `proceed`：可以继续提炼或继续 PR 审核
- `research-more`：继续补 runtime truth / assumption break / portability
- `stop`：先暂停，不要再用文档或测试包装结论

## 明确警告

出现以下情况时，应判为 `weak` 或 `partial`：

- 只有 unit tests，没有 runtime truth
- 只有 happy path，没有 assumption break
- 只看代码，没有检查 portability risk
- 只用容易通过的边界值测试包装一个并未真实跑通的结论
