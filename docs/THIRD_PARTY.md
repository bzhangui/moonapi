# 第三方依赖与许可

本项目 Apache-2.0；原有 `LICENSE`、`NOTICE`、MoonBit 标准库许可保持。新增标准适配通过 npm 安装下列库，不复制其源码为原创实现。使用 `npm ci --ignore-scripts` 按 `package-lock.json` 固定完整依赖图与完整性摘要；需要 Node >=22.19.0（Swagger Parser 的最低版本要求）。

| 直接依赖                    | 锁定版本 | 许可证     | 用途                                             |
| --------------------------- | -------- | ---------- | ------------------------------------------------ |
| @apidevtools/swagger-parser | 13.1.0   | MIT        | 文档结构校验、受控引用解析                       |
| ajv-draft-04                | 1.0.0    | MIT        | OAS Schema 基于 Draft-04 的独立约束验证          |
| ajv-formats                 | 3.0.1    | MIT        | 已知 format 验证；未知 format 按 OAS 回退到 type |
| openapi-enforcer            | 1.23.0   | Apache-2.0 | 产生候选值；不作为契约裁判或全标准支持证明       |
| yaml                        | 2.9.1    | ISC        | YAML 1.2/JSON 解析、重复键和别名预算             |

传递依赖的当前清单（包名/版本/声明许可证）：

- @apidevtools/json-schema-ref-parser 16.0.5 MIT；@apidevtools/openapi-schemas 2.1.0 MIT；@apidevtools/swagger-methods 3.0.2 MIT。
- ajv 8.20.0 MIT；@types/json-schema 7.0.15 MIT；openapi-types 12.1.3 MIT。
- js-yaml 5.5.0 MIT、嵌套 js-yaml 4.3.2 MIT；argparse 3.0.3 PSF-2.0、嵌套 argparse 2.0.1 Python-2.0。
- call-me-maybe 1.0.2 MIT；drange 1.1.1 MIT；fast-deep-equal 3.1.3 MIT；fast-uri 3.1.9 BSD-3-Clause；json-schema-traverse 1.0.0 MIT。
- randexp 0.5.3 MIT；require-from-string 2.0.2 MIT；ret 0.2.2 MIT。

上游版权和许可证全文由 npm 包的 LICENSE 等文件保留。不将 `node_modules`、上游后端二进制或数据库放进 Git/Mooncakes；也不把第三方能力冒称 MoonBit 原生实现。如果将来重新分发含标准层的独立运行包，必须一并复制这份清单、相应上游版权和许可全文，并核验精确文件集。当前旧便携运行包仍只带原有无 npm 依赖的三个入口，未包含新标准层。

规范参考：[OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html)、[Swagger Parser](https://apidevtools.com/swagger-parser/)、[Ajv](https://ajv.js.org/)、[Enforcer](https://openapi-enforcer.com/api/)。只读下载的 Petstore 定义是官方样例，不是本项目原创后端；探测脚本不保存/分发其文件，也不调用其操作。外部示例导入不是完整一致性认证。
