# MoonAPI

以 MoonBit 为主要实现语言的接口自动行为测试引擎。根据 OpenAPI 3.0 JSON 生成有效、边界和无效请求，检查响应契约，串联有状态操作，并在保留同一失败指纹和请求有效性的前提下缩小失败输入。

[源码](https://github.com/bzhangui/moonapi) · [CI](https://github.com/bzhangui/moonapi/actions) · [验收与测试](docs/QUALITY_REPORT.md) · [使用与限制](docs/OPERATIONS.md)

## 已实现与用途

- 解析有界 OpenAPI JSON：本地组件引用、对象、数组、字符串、整数、数值、布尔、枚举、必填及长度/范围约束。
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

## MoonBit 核心与维护

核心已发布至 [Mooncakes 0.1.0](https://mooncakes.io/docs/bzhangui/moonapi)，已有 MoonBit 项目可运行 `moon add bzhangui/moonapi@0.1.0`。安装与独立四目标验证见 [发布记录](docs/PUBLICATION.md)；完整执行仍需下面说明的 Node 适配环境。

`bzhangui/moonapi/core` 支持 JS/Wasm/Wasm-GC/Native，提供 `parse_openapi`、`plan`、`validate_response`、`scenario_case`、`capture_values`、`shrink_candidates`。核心不做网络 I/O；完整 HTTP 执行当前用 Node/JS 适配，不是四目标网络客户端。发布状态见 [验收记录](docs/ACCEPTANCE.md)。

```sh
moon run examples/core --target wasm
npm run validate
npm test
node scripts/package.mjs
```

统一维护入口执行四目标检查/构建/测试/样例、HTTP 与故障场景、格式及核心覆盖率。Native 需要系统 C 工具链，不隐式跳过。

只支持明确子集：3.0 JSON、JSON 请求/响应、标量 path/query。不支持 YAML、3.1、远程/递归引用、oneOf/allOf/anyOf、pattern/format、multipart、header/cookie 参数、OAuth 自动登录；不支持的 schema 拒绝，不当作通过。目标由 `--base` 指定，不跟随 servers。

预算/故障说明见 [OPERATIONS](docs/OPERATIONS.md)，安全边界见 [SECURITY](SECURITY.md)。采用 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE)。原创实现，依据 [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html) 设计，不复制其他测试框架源码。
