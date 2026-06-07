# HIPERA Ops 控制台

这里存放第二版 A 多 agent 工作流的运营文件。它不是代码后台，也不是独立软件，而是 Codex 调度多个 agent 时使用的任务板、锁、case log 和角色卡。

入口文件：

- `../HIPERA_MULTI_AGENT_WORKFLOW.md`
- `TASK_BOARD.md`
- `CASE_LOG.md`
- `LOCKS.md`
- `DISPATCH_RULES.md`
- `AGENTS/`

使用原则：

1. 简单问题不走多 agent。
2. 复杂/高风险问题先建 case。
3. 子 agent 只分析，不执行后台动作。
4. 主控执行前必须检查锁和用户确认。
5. 每次真实处理完复杂 case，都要更新 `CASE_LOG.md`。
