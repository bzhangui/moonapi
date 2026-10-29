# 第三方依赖与许可

本机工作台另使用官方主题变量 `@primer/primitives` **11.8.1**（MIT），配合 `@primer/css` 的组件样式。原许可随锁定依赖保留，不以手写外观冒充官方组件。

本项目 Apache-2.0；原有 `LICENSE`、`NOTICE`、MoonBit 标准库许可保持。新增标准适配通过 npm 安装下列库，不复制其源码为原创实现。使用 `npm ci --ignore-scripts` 按 `package-lock.json` 固定完整依赖图与完整性摘要；需要 Node >=22.19.0（Swagger Parser 的最低版本要求）。

0.8.0-rc.1将原生OpenAPI3.1/3.2接入标准执行链，规范核对基线为3.1.2/3.2.1；能力声明与实际维护结果分开，见 [0.8指南](UPGRADE_0_8.md)与[现代矩阵](OPENAPI_3_1_3_2_MATRIX.md)。结构类型、Schema元数据校验、候选产生、精确断言、HTTP与MoonBit policy各自分工，不能将依赖能解析文档视为项目已经实现或认证了全部运行语义。

| 直接依赖                    | 锁定版本 | 许可证     | 用途                                                                             |
| --------------------------- | -------- | ---------- | -------------------------------------------------------------------------------- |
| @apidevtools/swagger-parser | 13.1.0   | MIT        | 文档结构校验、受控引用解析                                                       |
| ajv-draft-04                | 1.0.0    | MIT        | OAS Schema 基于 Draft-04 的独立约束验证                                          |
| ajv                         | 8.20.0   | MIT        | 原生2020-12 Schema元数据校验；精确实例断言由项目独立执行，不使用有损浮点结果代替 |
| ajv-formats                 | 3.0.1    | MIT        | 已知 format 验证；未知 format 按 OAS 回退到 type                                 |
| openapi-enforcer            | 1.23.0   | Apache-2.0 | 产生候选值；不作为契约裁判或全标准支持证明                                       |
| yaml                        | 2.9.1    | ISC        | YAML 1.2/JSON 解析、重复键和别名预算                                             |
| lossless-json               | 4.3.3    | MIT        | 精确 JSON 数字词法和工作线程消息                                                 |
| saxes                       | 6.0.0    | ISC        | XML 语法/命名空间解析，拒绝 DTD；不解析外部实体                                  |
| @primer/css                 | 22.3.2   | MIT        | 仅本机操作台使用的官方样式组件                                                   |
| @redocly/openapi-core       | 2.71.1   | MIT        | 原生OAS对象结构类型；项目另补版本语义、离线身份/引用和运行适配                   |
| randexp                     | 0.5.3    | MIT        | 有界正则候选；每个候选仍由原生Schema独立复验，不是完备求解器                     |

下列为原基础适配依赖；新增检查器/主题的完整当前传递图和许可证以锁文件为准，标准本地运行包同时提供逐项 CycloneDX `sbom.cdx.json`，不以这份历史摘录冒称完整清单：

- @apidevtools/json-schema-ref-parser 16.0.5 MIT；@apidevtools/openapi-schemas 2.1.0 MIT；@apidevtools/swagger-methods 3.0.2 MIT。
- ajv 8.20.0 MIT；@types/json-schema 7.0.15 MIT；openapi-types 12.1.3 MIT。
- js-yaml 5.5.0 MIT、嵌套 js-yaml 4.3.2 MIT；argparse 3.0.3 PSF-2.0、嵌套 argparse 2.0.1 Python-2.0。
- call-me-maybe 1.0.2 MIT；drange 1.1.1 MIT；fast-deep-equal 3.1.3 MIT；fast-uri 3.1.9 BSD-3-Clause；json-schema-traverse 1.0.0 MIT。
- randexp 0.5.3 MIT；require-from-string 2.0.2 MIT；ret 0.2.2 MIT。
- xmlchars 2.2.0 MIT（saxes 的 XML 字符分类依赖）。

独立测试向量：`tests/vectors/draft4` 来自 JSON-Schema-Test-Suite，固定提交 `89e83a74014617ffbe79a56d83d14d054cd11417`，保留原样文件及 `tests/vectors/LICENSE`（MIT）。完整原始文件没有删减；执行器明确区分 OpenAPI 3.0 自身没有定义的 JSON Schema 词汇与适用的测试组，不能把更大的 JSON Schema 语言混称为 OpenAPI 3.0。

0.7历史选集是19份原始文件、184组/660断言；0.8的 `tests/vectors/draft2020-12` 扩展为同一固定提交的45份原始测试文件、382组/1297断言及22份原始远端夹具。manifest记录逐文件Git blob SHA1，`.gitattributes`保留原始字节；MIT版权全文继续在 `tests/vectors/LICENSE`。所选断言执行器不跳过、不删改预期值；测试定义不等于本轮整套执行结果，结果另记维护报告。远端夹具只通过内存grant注册，不访问其localhost地址；不把选集当成全量2020-12/OAS认证。Ajv负责原始Schema元数据校验；项目自行实现精确十进制、离线动态资源特化与显式求值集合，已知可选格式断言复用ajv-formats。

现代XML适配使用saxes语法解析；Linkset映射、流/MIME线格式与入站/出站适配由项目依据规范实现。TLS回归用Node内置crypto在内存生成短期合成证书/密钥，不携带真实证书、私钥或额外PKI依赖。没有修改或复制node_modules分发代码为原创实现。

上游版权和许可证全文由 npm 包的 LICENSE 等文件保留。不将 `node_modules`、上游后端二进制或数据库放进 Git/Mooncakes，也不把第三方能力冒称 MoonBit 原生实现。0.4.0 标准运行包在专用目录锁定安装依赖，保留其全部原始许可/通知文件和本清单，逐文件哈希校验。旧便携包仍仅含原三个入口，不冒称有标准层能力。Schemathesis4.32.5 仅在私有独立虚拟环境用于可选对照，不重新分发；参考工具日志可能含原始数据，不公开。

规范参考：[OpenAPI 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)、[3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[3.2.1](https://spec.openapis.org/oas/v3.2.1.html)、[JSON Schema 2020-12](https://json-schema.org/draft/2020-12)、[RFC9264](https://www.rfc-editor.org/rfc/rfc9264)、[Swagger Parser](https://apidevtools.com/swagger-parser/)、[Ajv](https://ajv.js.org/)、[Enforcer](https://openapi-enforcer.com/api/)。只读下载的 Petstore 定义是官方样例，不是本项目原创后端；探测脚本不保存/分发其文件，也不调用其操作。外部示例导入不是完整一致性认证。
