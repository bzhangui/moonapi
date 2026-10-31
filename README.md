# MoonAPI

以 MoonBit 为主要计算核心的 OpenAPI 驱动接口测试项目：从接口描述生成有效、边界和无效测试，验证请求/响应契约，并以状态依赖与失败序列缩减增强跨步骤业务回归。CRUD 只是接入档之一。标准入口保留 OpenAPI 3.0（按 3.0.4 澄清实现），本轮接入 **OpenAPI 3.1.2 / 3.2.1 原生执行**，不把新版文档降级为 3.0。旧便携入口仍是有界档，各入口能力和证据分开维护。

[源码](https://github.com/bzhangui/moonapi) · [CI](https://github.com/bzhangui/moonapi/actions) · [验收与测试](docs/QUALITY_REPORT.md) · [使用与限制](docs/OPERATIONS.md)

## 已实现与用途

### 当前源码：0.10.0，接入、生成与可靠性升级

本轮增加安全接入草案、覆盖缺口解释及 MoonBit 精确数值候选、依赖 IR 与覆盖调度。**Mooncakes 核心库：0.10.0，已发布并完成下载后独立消费验证**；完整Node运行包仅本地验证，不公开上传。使用步骤及分批结果见 [0.10 升级说明](docs/UPGRADE_0_10.md)，九条复核见 [验收状态](docs/ACCEPTANCE.md)，精确提交/摘要见 [发布记录](docs/PUBLICATION.md)。源码归档中的发布状态仅是打包时快照，实时分发状态以注册表与发布记录为准。

在你自己的MoonBit项目中添加计算核心：`moon add bzhangui/moonapi@0.10.0`。完整HTTP客户端请按以下源码安装步骤操作，不把核心依赖误当完整Node运行环境。

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-project.mjs inspect examples/standard-spec.json
node bin/moonapi-project.mjs init examples/standard-spec.json --out .moonapi-private/project.json
# 仅在你有权测试的本机服务运行；默认不授权写入/清理/远端。
node bin/moonapi-project.mjs run .moonapi-private/project.json --base http://127.0.0.1:8080
```

### 计算核心与宿主边界

现代 JSON Schema 实例求值已从 Node 迁入 `core/modern_semantics.mbt`：精确十进制/整型、深相等、组合与条件、依赖、已评估属性/索引集合和预算均由 MoonBit 计算。Node 只为此求值入口提供已授权 URI 专门化、Schema 元数据检查、ECMA 正则及可选格式叶子适配；HTTP、文档和生成器仍有 Node 实现，不宣称全应用已迁移。冻结旧求值器仅保留在测试目录用于差分，不作为运行时回退。

编译要求 **moonc ≥0.10.16**；本轮私有 SDK 为0.10.18，不改全局 SDK。`npm run validate` 检查版本、四目标核心、协议/业务回归和包隐私。新核心 API 用法、预算、语言审计及发布边界见 [0.9指南](docs/UPGRADE_0_9.md)。Mooncakes 发布结果以[发布记录](docs/PUBLICATION.md)为准，注册表核心库不等于附带 Node 依赖的完整客户端运行包。

第一条的“主要实现语言”仍存在审查风险：代码字节统计中 JavaScript 明显更多，尚有 Node 生成、文档和协议逻辑。没有修改 Linguist 标记、隐藏源码或按自定比例宣称过关；`node scripts/language-audit.mjs` 可复核实际统计。本轮迁移的是一个真实运行核心，不是已经消除所有语言占比问题。

最终功能提交 `337c389` 的[三平台CI](https://github.com/bzhangui/moonapi/actions/runs/41213016908)全部通过，每平台437项Node回归、58个不同核心测试×四目标、15组Native/JS策略对照及示例/包审计。Linux另通过独立FastAPI/PocketBase、规模与20轮耐久；本机另做100轮受控耐久。0.10.0注册表独立消费者四目标检查/构建、五个示例及每目标2项公开API回归通过。此为受控证据，不是生产认证；Windows临时后端目录清理限制仍见维护记录。

[历史源码与验证记录](docs/SOURCE_HISTORY.md) 已单独归档；下文只描述当前入口，不用历史测试结果证明新版本。

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

各版本标准入口的 `full_openapi_support=true` 是按对应公开矩阵和测试维护的**能力声明，不是第三方认证，也不是一次采样证明全部业务无误**；3.0 与原生 3.1/3.2 各自按自己的规范语义执行。`passed/complete` 另由执行数量、错误、授权和预算决定。规范没有定义的嵌套 deepObject、Cookie 歧义、空值等采用公开策略；自定义媒体使用受信任 codec 扩展，不把任意媒体冒当 JSON。Callbacks 不会擅自访问外部接收系统，响应派生/固定地址须由调用方提供可控环境与接收适配，不能自动把其 URL 改为本机地址。见 [3.0 矩阵](docs/OPENAPI_3_0_MATRIX.md)和[3.1/3.2 矩阵](docs/OPENAPI_3_1_3_2_MATRIX.md)。

当前源码候选与已发布核心库以本页顶部为准。Mooncakes 提供纯 MoonBit 计算/policy 核心，不包含 Node 标准 HTTP 层；完整标准入口从对应源码或单独验证的标准运行包使用。发布与独立消费状态见 [发布记录](docs/PUBLICATION.md)，不用旧版本证明新 API 已分发。旧便携档仍是有界档；标准运行包另含锁定 npm 依赖及完整原许可，不包含 Node/后端二进制。

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

需要 [MoonBit](https://www.moonbitlang.com/download/) **moonc ≥ 0.10.16** 和 Node.js ≥ 22.19.0。本轮使用项目私有 2026-10-28 SDK（moonc0.10.18）验证，不修改全局环境。新标准入口须先 `npm ci --ignore-scripts`，第三方依赖与许可见 [清单](docs/THIRD_PARTY.md)；纯 MoonBit 核心无需 npm 依赖。可选私有 SDK 优先查找 `.local/toolchain-0.10.18`，再查 `.local/toolchain`，也可显式设置 `MOON_BIN` / `MOON_HOME`。

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

上述旧入口默认 GET/HEAD/OPTIONS；现代标准入口另将 QUERY 作为明确的只读策略。跳过写入明确报告覆盖不完整。`--allow-write` 会实际创建/修改/删除数据，不能在生产资料上尝试。远程目标另需 `--allow-remote`；`--shrink-write` 允许重复写操作，仅适合隔离环境。只读方法名本身不能证明服务没有副作用。

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

**旧 `moonapi.mjs`、CRUD 与手写状态入口**仍使用原有有界 MoonBit 解析档（3.0 JSON、JSON 媒体和标量 path/query 等），不支持的约束继续拒绝。`moonapi-standard.mjs` 按原始版本选择 3.0 或原生 3.1/3.2 实现，不混淆入口。所有 HTTP 执行仍需显式 `--base`，不会按文档 servers 自动连接外部主机。GraphQL/gRPC 不属于当前范围。

预算/故障说明见 [OPERATIONS](docs/OPERATIONS.md)，安全边界见 [SECURITY](SECURITY.md)。采用 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE)。标准参考包括 [OpenAPI 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)、[3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[3.2.1](https://spec.openapis.org/oas/v3.2.1.html)；不复制其他测试框架源码，依赖与上游向量许可见[第三方清单](docs/THIRD_PARTY.md)。
