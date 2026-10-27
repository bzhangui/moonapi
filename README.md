# MoonAPI

以 MoonBit 为主要计算核心的 OpenAPI 驱动接口测试项目：从接口描述生成有效、边界和无效测试，验证请求/响应契约，并以状态依赖与失败序列缩减增强跨步骤业务回归。CRUD 只是接入档之一。**标准入口面向完整 OpenAPI 3.0（JSON/YAML）对象模型和规范语义，按 3.0.4 澄清实现；下方旧便携入口仍是有界档，不冒称具有标准入口的能力。**

[源码](https://github.com/bzhangui/moonapi) · [CI](https://github.com/bzhangui/moonapi/actions) · [验收与测试](docs/QUALITY_REPORT.md) · [使用与限制](docs/OPERATIONS.md)

## 已实现与用途

### 当前候选源码：0.5.0-rc.1（尚未发布 Mooncakes / 运行包）

功能源码 `ba88827` 已通过 [Windows / Ubuntu / macOS 三平台 CI](https://github.com/bzhangui/moonapi/actions/runs/40479096709)：每平台200项Node回归、41核心×四目标、原生对照、样例及运行包验证；Linux另通过独立PocketBase/SQLite六轮接入。属于受控验证，不是生产或真实用户效果证明。

新增统一执行账本与未知写入恢复、标准 owned 标记清理链、隔离租约、加密确认见证；低配置项目入口、本机工作台、角色凭据、资源状态图、精确守恒断言及有界并发历史检查。保留旧 API 和完整 OpenAPI 3.0 标准执行入口。3.1/3.2 只独立检查结构，执行继续禁用，不冒称已兼容。

```sh
npm ci --ignore-scripts
npm run build
node examples/safe-workflow-demo.mjs
# 仅合成演示服务；浏览器仍需勾选本次写入和清理授权。
node bin/moonapi-workbench.mjs --demo --allow-write
```

启动后打开终端打印的会话链接（仅监听 127.0.0.1:8791）；不要共享令牌。默认不保存配置，持久配置需要独立密钥加密。工作台使用官方 Primer CSS，不部署外部网站、不上传文档。[本轮完整指南](docs/UPGRADE_0_5.md) 覆盖 API、模型、密钥、CLI、隐私和证据边界；[版本策略](docs/VERSION_POLICY.md) 明确源码/核心包/运行包分别维护。

### 优先使用：标准状态回归与 CI（0.4.0）

三阶段升级已接入同一标准执行链：精确返回值绑定、跨步骤业务断言、状态前提与依赖保留缩减；提供资源持久化/删除确认、幂等重复请求、库存守恒和异步轮询模板。只读默认；缩减须显式授权隔离重置，不自动重试响应丢失的写请求。

```sh
npm ci --ignore-scripts
npm run build
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
# 仅已授权测试服务，公开报告去除操作名、URL 与正文。
node bin/moonapi-ci.mjs run your-spec.yaml --base http://127.0.0.1:8080 --report-prefix .local/ci-run
```

[标准状态与 CI 指南](docs/WORKFLOW.md) 包含 IR、四类模板、依赖草案、保守契约差异、同文档历史失败优先、私有重放与 JSON/JUnit/静态 HTML。单步观察 API 明确只在内存保留私有上下文；缩减确认和不稳定结果分开，空执行/阻塞/截断不报通过。独立 PocketBase/SQLite 六轮同时验证旧归属档和新标准流程；[参考工具对照](docs/COMPARISON.md) 披露实际测试量与边界，不宣称优于 Schemathesis。

### OpenAPI 测试生成与契约验证

本轮针对“功能范围偏窄、缺少测试生成和契约验证”的反馈增加独立标准适配入口，不删去文档中旧入口不认识的字段，也不把组件定义能读进来等同于全部语义已执行。

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-standard.mjs check examples/standard-spec.json
node bin/moonapi-standard.mjs plan examples/standard-spec.json
npm run demo:standard
npm run demo:advanced
# 仅限已授权隔离环境；POST 即使是报价接口也必须明确允许写入。
node bin/moonapi-standard.mjs run your-openapi.yaml --base http://127.0.0.1:8080 --allow-write
```

- JSON/YAML 1.2、规范文档结构校验、本地/递归引用；外部文档必须逐个显式提供，不自动读取磁盘或访问网络。
- 组合及约束：allOf/anyOf/oneOf/not、nullable、字典、数值/长度/集合约束、pattern、已知 format、读写方向；合法组合不因候选生成库限制而被判为非法。
- 每个操作独立生成有效值和已验证为无效的请求体、必需参数遗漏及边界候选；固定种子、操作公平调度，预算截断和无法生成均不报全通过。
- path/query/header/cookie 的规范样式、explode/allowReserved/content；JSON/XML/text、完整 Encoding 对象、URL 表单、多部分文件和二进制。响应覆盖状态范围/default、媒体协商、响应头及方向性 Schema。
- 无损 int64/十进制约束、XML 命名空间/属性/数组、TRACE，以及运行时表达式、operationId/operationRef Links 和临时授权回调接收器。请求在线编码后再次验证，避免序列化或认证覆盖改变负例含义。
- 显式凭据的 apiKey/Basic/Bearer/OAuth2/OpenID 注入、AND/OR 与作用域声明门禁；不是自动登录或令牌实际权限审计。
- 报告去敏、默认只读、远端另授权、不跟随重定向、CPU/内存/HTTP/资源预算；MoonBit 决定调度、响应判定和完整性门禁。

[标准入口使用说明](docs/STANDARD_ENGINE.md) 给出 API、凭据、跨文件引用、范围与错误语义。报价/搜索健康对照和注入故障均可运行，不是外部用户生产试点。官方 Petstore 定义只读核验见维护记录，绝不自动测试其写接口。

本轮补齐上一版所列的活动功能缺口。标准入口的 `full_openapi_support=true` 是按公开矩阵和测试维护的**能力声明，不是第三方认证，也不是一次采样证明全部业务无误**。`passed/complete` 另由执行数量、错误、授权和预算决定。规范没有定义的嵌套 deepObject、Cookie 歧义、空值等采用公开策略；自定义媒体使用受信任 codec 扩展，不把任意媒体冒当 JSON。Callbacks 不会擅自访问外部接收系统，响应派生/固定地址须由调用方提供可控环境与接收适配，不能自动把其 URL 改为本机地址。见 [标准矩阵](docs/OPENAPI_3_0_MATRIX.md)。

当前源码版本为 **0.5.0-rc.1**；已发布版本为 **0.4.0**。Mooncakes 提供纯 MoonBit 计算/policy 核心，标准 HTTP 层从对应源码或标准运行包使用。发布与独立消费状态以 [发布记录](docs/PUBLICATION.md) 为准，不用旧版本证明新 API 已分发。旧便携档保留，标准运行包另含锁定安装的 npm 依赖及完整原许可，不包含 Node/后端二进制。

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

需要 [MoonBit](https://www.moonbitlang.com/download/) **moonc ≥ 0.10.15** 和 Node.js ≥ 22.19.0。本轮使用项目私有 2026-10-12 SDK 验证，不修改全局环境。新标准入口须先 `npm ci --ignore-scripts`，第三方依赖与许可见 [清单](docs/THIRD_PARTY.md)；旧纯 MoonBit 核心无需 npm 依赖。

```sh
git clone https://github.com/bzhangui/moonapi.git
cd moonapi
npm ci --ignore-scripts
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

核心安装入口：[Mooncakes](https://mooncakes.io/docs/bzhangui/moonapi)，当前正式版安装：`moon add bzhangui/moonapi@0.4.0`。标准 Node 运行包从 [v0.4.0 Release](https://github.com/bzhangui/moonapi/releases/tag/v0.4.0) 下载。发布、校验和及独立四目标消费证据见 [发布记录](docs/PUBLICATION.md)。

`bzhangui/moonapi/core` 支持 JS/Wasm/Wasm-GC/Native，保留原解析、生成、判定、行为和 CRUD API。0.4.0 新增 standard_expression/schedule/oracle/verdict、workflow_check/remove/assert/category，见 examples/workflow_core。核心不做网络 I/O；标准 HTTP 执行用同版本 GitHub/运行包中的 Node 适配，不是 moon add 后即可获得的四目标网络客户端。发布状态见 [验收记录](docs/ACCEPTANCE.md)。

```sh
moon run examples/core --target wasm
npm run validate
npm test
node scripts/package.mjs
```

统一维护入口执行四目标检查/构建/测试/样例、HTTP 与故障场景、格式及核心覆盖率。Native 需要系统 C 工具链，不隐式跳过。

**旧 `moonapi.mjs`、CRUD 与手写状态入口**仍使用原有有界 MoonBit 解析档（3.0 JSON、JSON 媒体和标量 path/query 等），不支持的约束继续拒绝。新增 `moonapi-standard.mjs` 的能力及缺口单独记录，不混淆入口。所有 HTTP 执行仍需显式 `--base`，不会按文档 servers 自动连接外部主机。3.1/3.2、GraphQL/gRPC 不属于当前 3.0 目标。

预算/故障说明见 [OPERATIONS](docs/OPERATIONS.md)，安全边界见 [SECURITY](SECURITY.md)。采用 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE)。原创实现，依据 [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html) 设计，不复制其他测试框架源码。
