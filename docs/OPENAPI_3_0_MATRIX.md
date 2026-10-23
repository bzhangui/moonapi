# OpenAPI 3.0 能力与验收矩阵

0.4.0-rc.2 标准入口依据 [OAS 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)。覆盖完整对象模型及该版本定义的 Schema 语言，不是精选 CRUD/JSON 子集；也不等于更大的 JSON Schema Draft-04、OpenAPI 3.1/3.2。旧纯 MoonBit 解析/CRUD 档仍有明确边界。

| 规范单元                                           | 实现与验证                                                                                        | 可查证据                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| OpenAPI/Info/Contact/License/Tag/ExternalDocs/扩展 | JSON/YAML、版本、元数据、合法业务键、重复键拒绝，文字数据中的 $ref 不加载                         | conformance: all component、literal business；maintenance: YAML                                             |
| Paths/PathItem/Operation                           | 八种方法、参数合并、路径必需、重复 operationId、歧义路径；TRACE 实际 HTTP                         | standard.test: structural invalidity；conformance: TRACE                                                    |
| Components/Reference                               | 全组件种类、本地/外部/循环/RFC6901、3.0 ref 兄弟字段忽略、精确 URI 内容授予                       | conformance: all component、external operationRef、exact enum、file and non-network；maintenance: recursive |
| Schema 基础/约束                                   | type/enum/multipleOf/边界与独占、长度/正则、集合/唯一/属性/required/additionalProperties、无 type | 固定 Draft-04 原始向量 81 个适用组/344 断言，另有 OAS 专项                                                  |
| 组合、格式、方向、discriminator                    | allOf/anyOf/oneOf/not、nullable、format、readOnly/writeOnly；discriminator 不替代组合或改变父验证 | standard.test: contract；maintenance: nullable/direction；conformance: discriminator                        |
| 精确数值                                           | signed int64、十进制比较/整除/枚举/唯一，JSON/YAML/线程/HTTP 全链                                 | conformance: lossless JSON、wire contracts、exact enum                                                      |
| Parameter/Header                                   | path/query/header/cookie、全部规范样式/explode/allowReserved/content、忽略特殊请求头规则          | standard.test: styles/injection；conformance: wire round-trip、content                                      |
| RequestBody/MediaType/Example                      | 必需/可选/空体、声明媒体及通配选择、内联/引用/外部值                                              | maintenance: multiple media；conformance: wildcard、literal；standard-worker                                |
| Encoding                                           | URL 表单 contentType 与显式样式优先级；multipart 媒体/头/数组/文件/二进制及适用条件               | conformance: Encoding Object、form defaults；线上请求反解复核                                               |
| XML                                                | name/namespace/prefix/attribute/wrapped、组合、数组、精确值、DTD/XXE 拒绝                         | conformance: XML metadata/namespaces；真实 XML echo、advanced demo                                          |
| Responses                                          | exact/range/default、媒体/headers、方向、HEAD/204/304、空体/未声明正文                            | standard.test: responses；maintenance: headers/binary/empty；conformance: content headers                   |
| Server/ServerVariable                              | 继承、默认/枚举、相对地址、显式 base 与 origin/TLS 门禁                                           | standard.test: server variables；standard.mjs                                                               |
| Security/OAuthFlows/Requirements                   | apiKey/HTTP/OAuth2/OpenID、AND/OR/空覆盖、scopes、凭据冲突及回调认证                              | maintenance: security/collision；conformance: prototype-named authentication                                |
| Link/表达式                                        | operationId/operationRef、外部 OAD、qualified 参数/body/server、保类型/缺值、跟随/去重/预算       | conformance: expressions/Links/external operationRef；advanced demo                                         |
| Callback                                           | 授权 loopback 接收、地址绑定、请求/认证/契约、声明响应/头、关联/清理；独立接收适配 API            | conformance: healthy/fault、contracts/timeout；advanced demo                                                |
| 生成/判定                                          | 公平调度、正负/参数/正文/组合边界；独立标签验证、线上再验证、MoonBit oracle/verdict               | core/standard_wbtest、standard tests、HTTP 控制示例                                                         |

## 门禁与结果解释

full_openapi_support=true 表示标准入口按上述全范围实现和维护，**不是第三方认证、无 bug 保证，或穷尽所有业务**。third_party_certification=false、exhaustive_business_coverage=false。单次 passed/complete 由执行数量、失败、授权和预算另行决定；便携策略不会由一次采样证明全标准兼容。

规范未定义/实现相关行为（嵌套参数、Cookie、空值/空数组、XML 根名/命名空间、Path Item ref 相邻冲突）采用 [公开策略](STANDARD_ENGINE.md)。私有媒体内部格式需要受信任 codec；固定/响应派生回调地址需使用者的可控接收适配，不能自动改写真实系统 URL。权限、预算、表示或唯一定位条件不满足时不能报告完成。

tests/vectors 保存 21 份上游原始文件和许可。81 个适用组含 344 断言；23 个组使用 OAS 3.0 自身不支持的 JSON Schema 词汇/类型（如 patternProperties、null type、数组形式 type/items），未冒称为合法 OAS Schema。没有排除合法 OAS 约束来取得绿灯。向量不是官方 OpenAPI 全规范认证；其余对象由另外的 OAS 正反例及真实 HTTP 受控对照覆盖。

本轮新增源码未发布 Mooncakes。验收以本轮 QUALITY_REPORT 和当前提交 CI 为准，不用 0.3.0 注册表或旧 CI 代替新证据。真实用户、同条件竞品检出率和长期生产效果仍待授权，不以模拟冒称。
