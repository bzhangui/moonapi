# 独立状态行为引擎（0.2.0 源码）

这不是把若干 schema 检查改名为行为测试。MoonBit 的 `core/stateful.mbt` 负责模型状态、数据依赖、业务不变量、确定性路径生成及序列缩减候选；Node 仅负责 HTTP、时限与调用显式重置钩子。可运行入口：

```sh
npm run build
npm run demo:behavior
node bin/moonapi-behavior.mjs plan examples/spec.json --model examples/behavior.json
```

## 模型与机制

格式 1 包含 name、initial 和 steps（显式路径）或 transitions（自动选路）。initial 声明抽象状态；requires 检查状态前提，set 在成功后更新状态。状态值是有界 JSON 常量，不执行脚本或表达式。capture 从真实响应用 JSON Pointer 取得 ID/基准值；后续 `{"$from":"item_id"}` 引用上次捕获。捕获不能覆盖抽象状态，前向/缺失依赖拒绝。

assert 包含稳定 id、pointer、op，以及必要的 expected。支持 eq、ne、exists、absent、length、gte、lte；expected 可引用之前捕获值。区分缺失和 null，字符串长度按 Unicode 字符。不是任意 JS、SQL 或公式解释器。

模型只接受严格 JSON 数据，不接受 getter/toJSON、稀疏数组、undefined/BigInt、非有限数或不精确整数的隐式转换；精确大整数业务数据应使用字符串及相应契约。complete 只表示选中的路径执行完整，model_coverage_complete 另列是否访问了模型转换，均不是穷尽所有可能路径。

数值比较和长度断言的阈值类型会在当前请求之前验证；错误的字符串阈值或负长度属于模型配置错误，不作为服务缺陷。$from 是协议保留标记，不是任意脚本表达式。

自动生成按状态前提和已产生的返回值筛选可用转换，优先较少访问的转换，固定 seed 决定并列选择。输出记录已覆盖转换及预算/无可用转换的停止原因；单条路径完整执行不代表所有转换、业务路径或 OpenAPI 全标准覆盖。

## 真正的序列缩减

1. 完整预检已选计划与权限后，显式重置隔离测试环境，执行原序列。
2. 若授权重复写入，再次从重置环境运行原序列，确认稳定指纹。
3. MoonBit 按连续块删除生成更短序列，静态拒绝丢失捕获依赖、违反状态前提的候选。
4. 每个候选都先重置，再重新捕获 ID；只采纳仍触发同一指纹的候选。最终最小见证另作重放确认。

指纹由稳定步骤 ID、契约/业务检查类别和断言 ID/位置组成，不含动态资源 ID 或原始值。同指纹只证明同一检查再次失败，不保证物理根因相同。缩减是预算内局部结果，不是全局最小证明。此模式只缩减操作序列，不擅自缩改业务输入/预期值而制造假失败；旧版单请求体缩减仍保留为独立功能。

两种缺陷的实际受控证据见 [REVIEW_CASES](REVIEW_CASES.md)。没有外部用户或生产服务试点声明。

## 对自有服务运行

测试环境必须有受控重置接口，并将其 operationId 声明在描述中。不要给生产数据提供这个接口或运行示例。真实重置的租户/数据库/异步任务隔离由操作者验证，工具不能证明任意钩子已还原外部世界。

```sh
node bin/moonapi-behavior.mjs run own-api.json --model own-behavior.json --base http://127.0.0.1:8080 --reset-operation resetTestDatabase --allow-reset --allow-write --shrink-write
```

--allow-reset 单独授权破坏性测试重置，--allow-write 授权所选写操作，--shrink-write 另外授权重复写序列；远程仍需 --allow-remote，Bearer/TLS、禁止重定向等旧门禁继续生效。库用 `BehaviorEngine.run(base,model,{reset,allowReset:true})`；钩子必须返回 true，接收 AbortSignal，并在超时/中止时停止自身工作。超时钩子若忽略信号，工具不能强制撤销用户自定义进程，本次运行会停止而不是继续重放。

CLI 只把契约通过、且不是 202 的 2xx 视作重置成功；即使描述声明了 400/404 等响应，也不能继续执行路径。202 只表示接受异步工作，不证明隔离环境已还原。如服务仅提供异步重置，请在库调用中实现有界完成轮询并尊重 AbortSignal，验证完成后再返回 true；工具不内置或自动猜测该服务的轮询协议。返回 2xx 本身仍不能证明数据库、队列或外部世界已隔离，需操作者核实。

直接作为 Node 库使用时，先从 platform/runner.mjs 导入并 `await loadCore()`，再创建 BehaviorEngine；该方式加载已构建的本地核心，不从注册表自动安装编译器。完整可运行写法参见 examples/behavior-demo.mjs。

`plan(model,{steps,checkPermissions})` 拒绝未知选项；checkPermissions 必须是真正布尔值。默认仅生成计划，不隐式授予写入或重置权限。CLI 模型须是有效 UTF-8 JSON，可带 BOM；非法字节拒绝，解析错误不打印私人片段或文件路径。

默认总时限 60 秒、单请求/重置 1500 ms、缩减 32 次（最高 128）；可用 --total-timeout/--timeout/--shrink-budget 调整。模型 ≤64 KiB，初始状态 ≤32 个，变量 ≤64 个，步骤/转换 ≤64，单步断言 ≤32；沿用 HTTP/JSON 预算。时限/环境/绑定错误给出不完整结果，不当作业务成功。网络、鉴权、限流失败不盲目缩减。

默认报告格式 2 不包含原始请求/响应、凭据或捕获值；--save-repro 才把最小符号模型写入本机私有报告，可能含业务数据，禁止公开。复现需同一描述、模型、seed、干净重置及运行条件。

OpenAPI 适配仍是明确有界的实验实现，不是完整 OpenAPI 3.0 兼容；完整目标和验收门禁见 [OPENAPI_3_0_MATRIX](OPENAPI_3_0_MATRIX.md)。
