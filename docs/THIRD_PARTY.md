# 第三方依赖与许可

本机工作台另使用官方主题变量 `@primer/primitives` **11.8.1**（MIT），配合 `@primer/css` 的组件样式。原许可随锁定依赖保留，不以手写外观冒充官方组件。

本项目 Apache-2.0；原有 `LICENSE`、`NOTICE`、MoonBit 标准库许可保持。新增标准适配通过 npm 安装下列库，不复制其源码为原创实现。使用 `npm ci --ignore-scripts` 按 `package-lock.json` 固定完整依赖图与完整性摘要；需要 Node >=22.19.0（Swagger Parser 的最低版本要求）。

| 直接依赖                    | 锁定版本 | 许可证     | 用途                                             |
| --------------------------- | -------- | ---------- | ------------------------------------------------ |
| @apidevtools/swagger-parser | 13.1.0   | MIT        | 文档结构校验、受控引用解析                       |
| ajv-draft-04                | 1.0.0    | MIT        | OAS Schema 基于 Draft-04 的独立约束验证          |
| ajv                         | 8.20.0   | MIT        | 独立进程预算内的实验性 JSON Schema 2020-12 探针；不代表完整 OAS 3.1/3.2 执行 |
| ajv-formats                 | 3.0.1    | MIT        | 已知 format 验证；未知 format 按 OAS 回退到 type |
| openapi-enforcer            | 1.23.0   | Apache-2.0 | 产生候选值；不作为契约裁判或全标准支持证明       |
| yaml                        | 2.9.1    | ISC        | YAML 1.2/JSON 解析、重复键和别名预算             |
| lossless-json               | 4.3.3    | MIT        | 精确 JSON 数字词法和工作线程消息                 |
| saxes                       | 6.0.0    | ISC        | XML 语法/命名空间解析，拒绝 DTD；不解析外部实体  |
| @primer/css                 | 22.3.2   | MIT        | 仅本机操作台使用的官方样式组件                   |
| @redocly/openapi-core       | 2.71.1   | MIT        | 独立方言结构检查；不冒充现代方言运行支持         |

下列为原基础适配依赖；新增检查器/主题的完整当前传递图和许可证以锁文件为准，标准本地运行包同时提供逐项 CycloneDX `sbom.cdx.json`，不以这份历史摘录冒称完整清单：

- @apidevtools/json-schema-ref-parser 16.0.5 MIT；@apidevtools/openapi-schemas 2.1.0 MIT；@apidevtools/swagger-methods 3.0.2 MIT。
- ajv 8.20.0 MIT；@types/json-schema 7.0.15 MIT；openapi-types 12.1.3 MIT。
- js-yaml 5.5.0 MIT、嵌套 js-yaml 4.3.2 MIT；argparse 3.0.3 PSF-2.0、嵌套 argparse 2.0.1 Python-2.0。
- call-me-maybe 1.0.2 MIT；drange 1.1.1 MIT；fast-deep-equal 3.1.3 MIT；fast-uri 3.1.9 BSD-3-Clause；json-schema-traverse 1.0.0 MIT。
- randexp 0.5.3 MIT；require-from-string 2.0.2 MIT；ret 0.2.2 MIT。
- xmlchars 2.2.0 MIT（saxes 的 XML 字符分类依赖）。

独立测试向量：`tests/vectors/draft4` 来自 JSON-Schema-Test-Suite，固定提交 `89e83a74014617ffbe79a56d83d14d054cd11417`，保留原样文件及 `tests/vectors/LICENSE`（MIT）。完整原始文件没有删减；执行器明确区分 OpenAPI 3.0 自身没有定义的 JSON Schema 词汇与适用的测试组，不能把更大的 JSON Schema 语言混称为 OpenAPI 3.0。

上游版权和许可证全文由 npm 包的 LICENSE 等文件保留。不将 `node_modules`、上游后端二进制或数据库放进 Git/Mooncakes，也不把第三方能力冒称 MoonBit 原生实现。0.4.0 标准运行包在专用目录锁定安装依赖，保留其全部原始许可/通知文件和本清单，逐文件哈希校验。旧便携包仍仅含原三个入口，不冒称有标准层能力。Schemathesis4.32.5 仅在私有独立虚拟环境用于可选对照，不重新分发；参考工具日志可能含原始数据，不公开。

规范参考：[OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html)、[Swagger Parser](https://apidevtools.com/swagger-parser/)、[Ajv](https://ajv.js.org/)、[Enforcer](https://openapi-enforcer.com/api/)。只读下载的 Petstore 定义是官方样例，不是本项目原创后端；探测脚本不保存/分发其文件，也不调用其操作。外部示例导入不是完整一致性认证。
