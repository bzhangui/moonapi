# MoonAPI

以 MoonBit 为主要实现语言的接口自动行为测试引擎。除契约检查外，使用声明式状态模型验证跨步骤业务不变量，并在显式重置隔离环境后，缩减仍能复现同一失败检查的操作序列。**完整 OpenAPI 3.0 JSON 兼容是后续申报目标，目前适配仍不完整，不能称为已全标准支持。**

[源码](https://github.com/bzhangui/moonapi) · [CI](https://github.com/bzhangui/moonapi/actions) · [验收与测试](docs/QUALITY_REPORT.md) · [使用与限制](docs/OPERATIONS.md)

## 已实现与用途

本模块版本为 **0.3.0 接入改进版**，包含状态行为与自动 CRUD 计算核心；旧版 0.1.1 不包含这些新增 API。安装版本和独立消费核验见 [发布记录](docs/PUBLICATION.md)。针对接入成本、兼容性及增量价值的反馈，见 [本轮整改](docs/REVIEW_REMEDIATION.md)、[工具对照](docs/COMPARISON.md)、[独立后端证据](docs/INTEGRATION_EVIDENCE.md)；完整标准缺口见 [兼容矩阵](docs/OPENAPI_3_0_MATRIX.md)。

### 优先使用：免手写模型的资源回归

同步 REST CRUD 接口可只选择集合和字段，自动生成六步持久化验证；不需要编写状态机或清空全库的 reset。只修改本次创建、捕获 ID 并核验随机标记的资源，保留既有数据；清理未确认不会报告通过。

```sh
npm run build
node examples/crud-demo.mjs
node bin/moonapi-crud.mjs plan examples/spec.json --collection /items --field name
# 仅在已授权的测试环境运行；会真实创建、修改、删除合成记录。
node bin/moonapi-crud.mjs run your-spec.json --base http://127.0.0.1:8080 --collection /items --field name --allow-write --allow-cleanup --shrink-write
```

[接入指南](docs/OWNED_CRUD.md) 给出形状、许可与预算。仅支持无歧义的单资源同步 CRUD：不自动理解任意业务，不隔离库存/邮件等全局副作用，不适合生产环境无人值守写测试。真实开源后端 PocketBase/SQLite 上的两类合成集合已有可复现接入，但不是外部用户试点；Windows 本轮目录自动删除仍有环境缺口，详见证据页。

### 高级模式：业务状态模型

- 新状态引擎：initial/requires/set 抽象状态、返回 ID/基准值依赖、跨步骤 eq/ne/exists/absent/length/gte/lte 断言。
- 确定性状态驱动选路；逐次真实重置、稳定性确认、保持依赖/状态前提的整条操作序列缩减和独立最终见证重放。
- 受控反例：更新未持久化（8→3 步）、删除未生效（8→4 步）、重复取消多返库存（6→5 步），以及对应健康对照；不是外部用户试点。
- 旧场景不再在污染状态上自动做单请求缩减；需要状态安全缩减时使用新模式。新模式不擅自更改输入/预期值来制造假失败。

```sh
npm run build
npm run demo:behavior
node bin/moonapi-behavior.mjs plan examples/spec.json --model examples/behavior.json
```

[状态引擎使用指南](docs/BEHAVIOR_ENGINE.md) 说明重置、重复写入许可、模型语法与预算。以下原有契约/单请求功能继续保留：

- 解析有界 OpenAPI JSON：本地参数/请求体/响应/Schema 组件引用和转义指针；readOnly/writeOnly 的方向性生成与 required；缺少 operationId 时稳定派生；对象、数组、标量、枚举、必填及部分边界。
- 固定 seed 的可复现生成：边界值、请求体类型错误和缺少必填字段；不声称穷尽所有接口。
- 检查状态码、5xx、响应 JSON/schema；原始响应由 MoonBit 校验，避免 JS 数值转换误判。
- 五步创建、读取、修改、删除、再次读取，用 JSON Pointer 捕获真实返回 ID，再安全绑定后续参数，不执行脚本文本。
- 缩减保留失败指纹与有效/无效请求语义；设置独立预算，写请求缩减需要另外授权。
- 超时/资源预算、只读默认、远程/写入门禁、拒绝自动重定向；报告默认无凭据及请求/响应体。

适用于契约回归、状态流程验证、最小失败定位；不替代业务断言、安全渗透或真实用户试点。

## 安装和最小样例

需要 [MoonBit](https://www.moonbitlang.com/download/) **moonc ≥ 0.10.15** 和 Node.js ≥ 22。使用官方 2026-10-12 稳定版验证，无 npm 第三方依赖。

```sh
git clone https://github.com/bzhangui/moonapi.git
cd moonapi
npm run build
npm run demo
node bin/moonapi.mjs plan examples/spec.json
```

`demo` 自行启动/关闭两个回环临时 HTTP 服务，验证正常契约、五步状态流程和故意注入的错误，不请求你的业务接口。Windows 可双击 **开始使用.cmd**。首次源码构建联网更新索引；编译后的 HTTP 演示不需外网。

## 测试自己的接口

只测试拥有或明确获授权的接口，优先选择可重置的测试环境。

```sh
node bin/moonapi.mjs run your-openapi.json --base http://127.0.0.1:8080
node bin/moonapi.mjs run your-openapi.json --base http://127.0.0.1:8080 --allow-write
node bin/moonapi.mjs run examples/spec.json --base http://127.0.0.1:8080 --allow-write --scenario examples/scenario.json
```

默认 GET/HEAD/OPTIONS，跳过写入明确报告覆盖不完整。`--allow-write` 会实际创建/修改/删除数据，不能在生产资料上尝试。远程目标另需 `--allow-remote`；`--shrink-write` 允许重复写操作，仅适合隔离环境。

`--seed`、`--limit`、`--timeout`、`--shrink-budget` 调整有界预算。Bearer 通过 `MOONAPI_BEARER_TOKEN` 环境传入，不放命令行/源码。`--save-repro` 将最小输入保存到本地私有报告，可能含业务字段，不公开。

报告在 `.local/reports/`。退出码 0：本次计划全部执行无失败；1：失败、不完整或未执行；2：配置/输入/运行错误。通过不是业务正确性、安全性或完整覆盖证明。

CLI 输入必须是有效 UTF-8（可带 BOM），描述和模型/场景分别按 512 KiB、64 KiB 实际读取上限检查；错误信息不回显文件路径或 JSON 片段。行为 CLI 的重置必须已完成并返回契约通过的 2xx，202 或已声明的 4xx 不能当作重置成功；详见状态引擎指南。

## MoonBit 核心与维护

核心安装入口：[Mooncakes](https://mooncakes.io/docs/bzhangui/moonapi)，0.3.0 安装命令为 `moon add bzhangui/moonapi@0.3.0`。实际发布状态、安装与独立四目标验证见 [发布记录](docs/PUBLICATION.md)；完整执行仍需下面说明的 Node 适配环境。

`bzhangui/moonapi/core` 支持 JS/Wasm/Wasm-GC/Native，提供 `parse_openapi`、`plan`、`validate_response`、`scenario_case`、`capture_values`、`shrink_candidates`。0.3.0 还提供 validate_sequence、generate_sequence、model_assertions、model_preconditions、model_effects、sequence_candidates、crud_plan，见 examples/behavior_core 和 examples/crud_core。核心不做网络 I/O；完整 HTTP 执行用同版本 GitHub/运行包中的 Node/JS 适配，不是 moon add 后即可获得的四目标网络客户端。发布状态见 [验收记录](docs/ACCEPTANCE.md)。

```sh
moon run examples/core --target wasm
npm run validate
npm test
node scripts/package.mjs
```

统一维护入口执行四目标检查/构建/测试/样例、HTTP 与故障场景、格式及核心覆盖率。Native 需要系统 C 工具链，不隐式跳过。

只支持明确子集：3.0 JSON、JSON 请求/响应、标量 path/query。不支持 YAML、3.1、远程/递归引用、oneOf/allOf/anyOf、pattern/format、multipart、header/cookie 参数、OAuth 自动登录；不支持的 schema 拒绝，不当作通过。目标由 `--base` 指定，不跟随 servers。

预算/故障说明见 [OPERATIONS](docs/OPERATIONS.md)，安全边界见 [SECURITY](SECURITY.md)。采用 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE)。原创实现，依据 [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html) 设计，不复制其他测试框架源码。
