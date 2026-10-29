# OpenAPI 3.1 / 3.2 原生执行覆盖矩阵

核对基线：OpenAPI 3.1.2、3.2.1 与 JSON Schema 2020-12；核对日期：2026-10-29。

本文件记录实现位置、可重复的测试入口和明确的执行策略，不是第三方认证，也不以“文档能解析”代替“功能已执行”。3.1/3.2 保留原版本与原生 Schema 语义，不降级或改写为 3.0。标准入口声明 `implementation_status=native-standard`、`full_openapi_support=true`，表示按本矩阵维护规范功能，不是任意 Schema 的完备生成、第三方认证或一次测试即穷尽全部业务。最终组合维护、CLI/本地包与跨平台 CI 结果必须按精确提交分别核实。

## 1. 规范与证据入口

规范来源：[OAS 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[OAS 3.2.1](https://spec.openapis.org/oas/v3.2.1.html)、[官方发布与方言索引](https://spec.openapis.org/oas/)、[JSON Schema 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)、[Validation](https://json-schema.org/draft/2020-12/json-schema-validation)。默认使用实际发布的 OAS 方言 `https://spec.openapis.org/oas/3.1/dialect/2024-11-10` 与 `https://spec.openapis.org/oas/3.2/dialect/2026-02-26`；兼容接受代码中列出的先前发布日期与旧 `/base` 标识。

表中缩写指以下测试文件。列出测试定义不等于宣称其本轮完整组合已通过；最终执行结果、环境和未运行项以 [QUALITY_REPORT.md](QUALITY_REPORT.md) 与对应 CI 为准。

| 缩写 | 可重复测试入口                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D    | `tests/modern-document.test.mjs`：原生对象、版本差异、多文档、身份与语义校验                                                                                                         |
| S    | `tests/modern-schema-integration.test.mjs`、`tests/modern-exact.test.mjs`：方言、精确数值、注解与注册表                                                                              |
| V    | `tests/modern-vectors.test.mjs`：固定上游原始字节与选定 2020-12 断言向量                                                                                                             |
| M    | `tests/modern-protocol.test.mjs`：媒体、参数、流、Cookie、XML、MIME 极端输入                                                                                                         |
| L    | `tests/modern-linkset.test.mjs`：RFC 8288/9264/8187 Link 文本、语言参数、上下文和注入预算                                                                                            |
| G    | `tests/modern-generation.test.mjs`：有界生成、组合注解与独立复验                                                                                                                     |
| E    | `tests/modern-execution.test.mjs`：标准入口与受控 HTTP 端到端执行                                                                                                                    |
| T    | `tests/modern-transfer.test.mjs`：二进制桥接、精确数值、加密见证与预算                                                                                                               |
| F    | `tests/modern-foundation.test.mjs`：动态引用、流边界与隔离执行期限                                                                                                                   |
| P    | `tests/modern-entrypoints.test.mjs`、`tests/dialects-diff.test.mjs`：隔离检查器、工作台原生检查/只读入口、未来版本阻断及 CSRF/Host/session 门禁                                      |
| C    | `tests/standard-conformance.test.mjs`、`tests/standard-maintenance.test.mjs`、`tests/standard.test.mjs`：共享协议、授权与 3.0 回归；仅复用这些实现不等于已获得原生现代版本端到端证据 |

## 2. 所有 OpenAPI 对象类别

`platform/modern-document.mjs::prepareModernDocument` 使用锁定的 `@redocly/openapi-core` 结构类型，并补充版本特有语义规则。Schema 部分有意保持不透明，另外交给 `compileExactModern`，避免结构检查器把 2020-12 当成旧版 Schema 子集。元数据保留与结构验证不表示 MoonAPI 会渲染文档网页、代办协议授权或推断业务规则。

| 对象类别                      | 实现及可核查策略                                                                                                                            | 证据与仍需注意的边界                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OpenAPI Object                | `prepareModernDocument`、`defaultModernDialect`；原生版本、`jsonSchemaDialect`、`paths`、`webhooks`；3.2 `$self` 与检索 URI 别名分开处理    | D：版本、self、多文档、身份冲突；E：native versions                                                     |
| Info Object                   | 原样保留并结构验证 `title`、`summary`、`description`、`termsOfService`、版本等字段                                                          | D：malformed OAS objects；不解释描述中的业务断言                                                        |
| Contact Object                | 元数据结构校验、保留；不发邮件或访问个人主页                                                                                                | D 的整体对象校验；非 HTTP 执行能力                                                                      |
| License Object                | `serversAndTags` 校验 `identifier` / `url` 冲突；元数据保留                                                                                 | D：license exclusivity；实际项目开源合规另见 LICENSE/NOTICE/THIRD_PARTY                                 |
| Server Object                 | 文档/Path Item/Operation 层继承；`serversAndTags` 检查 3.2 名称唯一；标准入口绑定显式允许的目标                                             | D：server metadata；C：server variables / target authorization；描述服务器不等于授权访问                |
| Server Variable Object        | 变量定义、默认值与非空枚举一致性；标准入口展开与目标约束                                                                                    | D/C；服务器枚举不会自动生成可访问的任意远端                                                             |
| Components Object             | 类型索引全部组件集合；包含 3.1 `pathItems`、3.2 `mediaTypes`；未引用 Schema 也由 worker 提前编译                                            | D：component/ref/unused object cases；S：Schema roots；E：native references                             |
| Paths Object                  | 模板、必需 path 参数、同形路径和合法扩展校验；路径匹配不依赖对象枚举顺序                                                                    | D：duplicate templates / inherited parameters；C：path serialization                                    |
| Path Item Object              | 标准方法、参数继承、服务器、引用；`modernMethods` 处理 QUERY 与 `additionalOperations`                                                      | D/E/M：QUERY、自定义方法大小写；`$ref` 与本地冲突字段采用拒绝策略，不猜测未定义的合并结果               |
| Operation Object              | `operationId` 唯一、缺失时确定性 ID、参数覆盖、请求/响应/链接/回调/安全元数据；3.2 可省略 `responses`                                       | D：native methods；E：optional response case；无响应契约时返回 `unconstrained`，不虚构契约通过证据      |
| External Documentation Object | 普通对象及 Schema 注解中的字段类型校验；保留 URL 和描述                                                                                     | D/S：malformed annotations；不自动抓取外部文档                                                          |
| Parameter Object              | `parameterWire`、`standard-codec` 与现代媒体帮助函数；path/query/header/cookie；3.2 整体 `querystring`                                      | D/M/E：内容互斥、继承覆盖、重复项、一次转义、Cookie；下述非 JSON 歧义策略适用                           |
| Request Body Object           | `sampleContent`、`requestContract`、`wireRequest`；必需性、多媒体、Schema 与媒体编码分别验证                                                | M/G/E；显式样例也要独立校验；写请求仍需授权，不因 QUERY 以外的自定义方法名类似 GET 就放行               |
| Media Type Object             | `encodeModernMedia` / `decodeModernMedia`、`validateModernContent`；`schema` 与 3.2 `itemSchema` 独立执行；完整内容与顺序记录分开           | M/E/F：JSON/文本/二进制/流；整合流式 HTTP 需要实际 EOF 与整体验证，不以合法前缀代替完整通过             |
| Encoding Object               | `multipartParts` / `parseMultipart`、`encodeForm` / `decodeForm`；命名、位置、嵌套、contentType、headers、样式                              | D/M：prefixEncoding、itemEncoding、嵌套 MIME、重复字段、边界伪装、注入；多种 contentType 要显式选择     |
| Responses Object              | `responseFor`；精确状态、范围、default 的选择；提供时拒绝空有效映射                                                                         | D/E/C：响应状态与空体；未描述的响应与传输错误分开报告                                                   |
| Response Object               | `responseContract` / `wireResponse`；headers/content/links；3.2 summary 与可省略 description                                                | D/E：optional descriptions；M：响应媒体、Set-Cookie；没有说明文字不是契约故障                           |
| Callback Object               | 回调表达式索引、`callbackContract` / `inboundContract`；标准入口临时接收端验证请求和响应                                                    | D：callback maps / IDs；C：受控回调；现代入口的入站及 mTLS 新组合需要专门端到端复验                     |
| Example Object                | `sampleContent` / `externalExample`；3.2 `dataValue`、`serializedValue`、显式授予的 externalValue；值/序列化值分别处理                      | D/M/G：不把样例内 `$ref` 当引用；opaque grant；样例不是期望所有响应完全相等的业务 oracle                |
| Link Object                   | `resolveOperationRef`、worker `links` / `followLink`；精确 runtime expression，支持外部 OAD operationRef 与参数依赖                         | D/C：外部目标和表达式；共享执行代码的原生 3.1/3.2 跨文档链接仍应保留端到端回归                          |
| Header Object                 | `decodeModernHeader`、现代 header/cookie 适配；Schema/content 分流、大小写不敏感、保留 Set-Cookie 多行；`modern-linkset` 原生 Link 文本映射 | M/L/C；现代媒体和 Header 入口的组合仍需端到端复验，不能由 JSON 媒体回退替代                             |
| Tag Object                    | `serversAndTags`；名称、3.2 summary/parent/kind 保留，拒绝父节点缺失和环                                                                    | D：tag parent cycles；组织元数据不影响测试判定                                                          |
| Reference Object              | 类型化离线资源表、原始物理位置、URI/JSON Pointer；summary/description 仅按目标支持字段覆盖                                                  | D/S：alias、percent、escaped pointer、prototype、无环境读取；Schema `$ref` 的兄弟约束不按此对象规则忽略 |
| Schema Object                 | `compileExactModern` / `specializeModernResources` / `modernSchemaTools`；2020-12 与 OAS 默认方言                                           | S/V/F/G/E；完整基线与可选词汇表界限见下一节；不是用 Ajv 浮点结果替代精确数值断言                        |
| Discriminator Object          | `openAPIAnnotations` 校验，保留 mapping 与 3.2 defaultMapping；实际判定仍由 oneOf/anyOf/allOf 执行                                          | S：default annotations；discriminator 不允许把本来不符合 Schema 的值变为有效                            |
| XML Object                    | `openAPIAnnotations`、`encodeModernXML` / `decodeModernXML`；旧属性和 3.2 nodeType、namespace、text/cdata/none                              | M/G/S：XML、实体、命名、null、组合分支；分支注解与引用的往返是整合门禁，不可仅以形状推导成功验收        |
| Security Scheme Object        | 原生类型结构验证与 `StandardEngine.#auth`；apiKey、HTTP、OAuth2、OpenID Connect、mutualTLS                                                  | D/C/E 的认证组合；实际凭据来自显式 provider；未授权目标不发送；mTLS 需要真实受控握手证据                |
| OAuth Flows Object            | 保留并校验各 flow、scopes 与 3.2 deviceAuthorization 元数据                                                                                 | D 结构校验；不自动实施浏览器授权、设备登录或从任意 URL 取 token                                         |
| OAuth Flow Object             | URL、刷新 URL、scope 描述等元数据；执行使用调用者明确提供的 token/scopes                                                                    | D/C；流程描述合法不证明服务器按流程正确授权；token 获取属于显式可信 provider                            |
| Security Requirement Object   | AND/OR、空替代、入口组件名优先、3.2 URI-keyed schemes / roles；3.1 非 OAuth/OpenID 数组必须空                                               | D：non-OAuth roles version guard；C：AND/OR、目标碰撞、报告脱敏；角色声明不构成身份验证证明             |
| Specification Extensions      | 允许位置上的 `x-` 数据保留且不递归解释其业务 `$ref`；组件或响应 header 的 x 前缀名字按所在类型处理                                          | D/C：inert literals / prototype / x-prefixed names；扩展不自动执行脚本或放宽标准断言                    |

## 3. JSON Schema 基线，不以自定义子集冒充标准

| 类别                         | 原生实现范围与策略                                                                                                                                  | 直接证据                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Core / 资源                  | boolean Schema、`$schema`、`$id`、`$defs`、`$anchor`、`$ref`、`$dynamicAnchor` / `$dynamicRef`；同一资源的物理位置与身份别名分开，兄弟关键字保留    | S/F/V：local/external/nested/dynamic refs；原 OAD 不会整体当作 Schema 编译         |
| Applicator                   | allOf/anyOf/oneOf/not、if/then/else、dependentSchemas、properties/patternProperties/additionalProperties、propertyNames、prefixItems/items/contains | S/V/G：相互作用、条件、依赖、元组与失败候选                                        |
| Unevaluated                  | unevaluatedProperties / unevaluatedItems 传播实际已求值成员与索引集合，不把 contains 的非连续索引当成前缀                                           | S/V：分支、引用兄弟及 contains 组合                                                |
| Validation                   | type/enum/const、数值边界/multipleOf、字符串长度/pattern、对象必需/数量/dependentRequired、数组数量/uniqueItems/minContains/maxContains             | 精确十进制、相邻 int64、深比较；S/V/F；避免二进制浮点相等和范围误判                |
| Meta-data                    | title/description/default/examples/deprecated/readOnly/writeOnly 等注解；未知可选注解不改变断言                                                     | S/G/E；现代 required 不沿用 3.0 的 readOnly/writeOnly 豁免；方向拒绝为显式附加策略 |
| Format annotation            | OAS 基线默认注解，不凭未知 format 拒绝实例，不将 binary/byte 变成编码指令                                                                           | S/M；可选 `assertFormats:true` 仅对已知实现格式启用断言，未知名称明确阻断          |
| Content                      | contentEncoding/contentMediaType/contentSchema 按基线作为注解；媒体编解码器按显式媒体与编码配置工作                                                 | S/M；JSON 内的 base64 字符串不会因注解自动变成 Buffer                              |
| 非 JSON 实例                 | 实际 Buffer/Uint8Array 与普通对象分离；无 JSON type 限制时可处理字节，显式 JSON 类型不错误接纳二进制                                                | S/T/E：exact bytes 与看似 Buffer 的业务对象隔离                                    |
| 自定义方言与词汇表           | 已知 2020-12 / OAS 方言可用；可选未知注解不执行；未知**必需**词汇表、任意未安装 dialect 明确拒绝                                                    | S/F：`MODERN_SCHEMA_DIALECT_UNSUPPORTED`；不静默退化成默认方言                     |
| 完整 format-assertion 词汇表 | 不宣称支持整个可选词汇表；IDN/IRI 等 RFC 完整断言未经实现的情况下，要求该词汇表的 Schema 阻断                                                       | S；单个已知格式的可选检查不等于完整词汇表支持                                      |

独立上游基线固定在 JSON-Schema-Test-Suite 提交 `89e83a74014617ffbe79a56d83d14d054cd11417`：45 个原始测试文件、382 组、1297 个断言、22 个原始远端夹具，逐文件验证 Git blob SHA-1，选定断言不跳过、不改写预期值。自定义元方言的 `vocabulary.json` 未列入默认方言选集；远端资源只通过内存 grant 表提供。此结果只证明这些固定向量，不等于 JSON Schema 全量认证、OpenAPI 全量认证或所有 HTTP 协议组合的证明。来源与许可证见 `tests/vectors/draft2020-12/manifest.json`、`tests/vectors/LICENSE`、[THIRD_PARTY.md](THIRD_PARTY.md)。

## 4. 3.2 增量和容易误报的行为

| 增量 / 风险                    | 当前执行契约与核查点                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档身份、媒体组件、组织元数据 | `$self` 原生基 URI；`components.mediaTypes` 引用；tag hierarchy、server name、弃用等元数据保留；D 覆盖                                                                                         |
| QUERY 与扩展方法               | QUERY 可带内容并使用明确只读策略；additionalOperations 原样保留大小写，非标准 token 不冒充安全标准方法；D/M/E 覆盖                                                                             |
| 整体 querystring               | 与 query 参数互斥；只使用 content；form/JSON 仅做一次 URL 编码；M/E 覆盖。不存在新增 `$request.querystring` runtime-expression 标准语法                                                        |
| 新 Cookie 与 Header            | cookie 样式不同于旧 form；分号和 `%xx` 语义不混用；Set-Cookie 不逗号拼接、不拆 Expires；M 覆盖                                                                                                 |
| itemSchema 与顺序流            | 每个完成项即验证，整体 Schema 单独验证；末尾截断、超时、预算耗尽、取消和未收到 EOF 不计完整通过；M/F/E 覆盖                                                                                    |
| 位置与嵌套编码                 | prefixEncoding/itemEncoding 不与命名 encoding 混用；记录顺序、空字段、二进制、MIME 多类型选择需保真；D/M 覆盖                                                                                  |
| XML nodeType                   | element/attribute/text/cdata/none；旧 attribute/wrapped 与新 nodeType 互斥；active branch 与原 Schema 独立校验；S/M/G 覆盖                                                                     |
| Example 的数据与线格式         | dataValue 是实例，serializedValue 是媒体表示；externalValue 只在显式资源授权下使用；数据即使长得像 OAD 也保持惰性；D/M/G 覆盖                                                                  |
| Link Header 的 linkset         | `application/linkset` 映射 RFC 8288/9264 文本而非 JSON；`encodeLinkset` / `decodeLinkset` 已接入现代媒体路径，L 覆盖关系、语言/Unicode、URI、原型键、注入和预算。Header/媒体组合为整合复验门禁 |
| 可省略响应契约                 | Operation 无 responses、Response 无 description 在 3.2 不是结构错误；无契约返回 unconstrained，不宣称执行了不存在的契约；D/E 覆盖                                                              |
| 新认证元数据                   | URI security requirement、非 OAuth roles、deviceAuthorization 与元数据 URL 保留；不在后台自动登录、抓取发现文档或授予网络权限；D 覆盖                                                          |

## 5. 非 JSON、生成与安全边界

1. **线格式不一定可逆。** 媒体 Schema 未声明足够类型信息、deepObject 的嵌套值、同名 XML 多分支、冲突 XML 别名、空集合/空字符串与缺失值等可能产生歧义。已定义的映射按规范实现；规范未定义的组合采用明确策略或阻断，不猜测框架私有规则。Codec 扩展是显式可信代码，不以自动嗅探或任意网络访问弥补。
2. **验证与生成分开。** `modernSchemaTools` 的 validator 处理声明约束；sample 是确定种子的有界候选生成，不是任意 Schema 的完备可满足性求解器。每个候选经独立原生校验，不能生成时报告 `STANDARD_GENERATION_UNSAT_OR_BUDGET`；这不证明 Schema 不可满足，更不能返回空计划并判成功。dependentSchemas、patternProperties、组合兄弟、必需方向注解均有 G 回归。
3. **预算是产品策略，不是标准子集。** 文档 grant 最多 16 个、合计 4 MiB，索引 100000 节点/深度 64；Schema 注册别名最多 4096、专化图有界；媒体默认 1 MiB、256 项、每项 64 KiB、嵌套 8 层；worker transfer 4 MiB/100000 节点/深度 128/4096 字节槽。生成另有尝试/深度/节点/长度预算。以当前函数参数检查为准；耗尽返回预算/未完成，不声称缺陷已确认或完整通过。正则在隔离 worker 中受强制期限限制。
4. **精确数值与字节贯穿链路。** `standard-transfer` 使用带类型的私有帧，JSON Pointer 槽包含路径元数据预算；普通 `{type:"Buffer",data:[...]}` 不转换。`cloneExact` 独立复制 LosslessNumber 与字节；`digestExact` 使用域隔离描述符，不以 NUL 拼接可控路径。二进制加密见证使用外层格式 3，旧 JSON-only 格式 2 兼容；错误密钥、篡改和降级均拒绝。T 的这些用例只含临时合成数据。
5. **OpenAPI 认证描述不是凭据和授权。** apiKey/token/certificate 只能来自显式设置或可信 credentialProvider，按 scheme/scopes/roles 和目标检查；AND 不得互相覆盖凭据。声明 OAuth/OpenID/device flow 不自动发起登录，也不证明真实身份或生产权限正确。外部文档、样例、回调和服务地址均不得使工具读取未授权本机文件或访问任意远端。
6. **受控测试不冒充真实试点。** loopback HTTP/HTTPS、模拟服务、畸形字节和合成数据能复现故障处理；它们不证明独立用户接入、跨组织身份系统、持续生产负载、真实外部回调或所有第三方实现互通。

## 6. 整合门禁与复验清单

以下整合门禁纳入维护命令。结果按 [QUALITY_REPORT.md](QUALITY_REPORT.md) 和 [PUBLICATION.md](PUBLICATION.md) 的精确提交记录，不得删除失败用例来换绿：

- P 使用 `prepareModernDocument` 加逐 Schema 原生编译，而不是旧表格降级检查；工作台 `/api/inspect` 与 `/api/check` 均通过标准引擎生成计划，未知未来版本明确阻断。支持某版本不等于某份无效文档已经可执行；QUERY 的默认只读选择也必须经过日志、传输及结果链路复验。
- 将 `application/linkset` 的 L 独立正反例和 Header/content 入口一起复验；JSON 回退不是完成。
- G 中非首个引用 oneOf XML 分支与 if/then/else 注解编解码往返必须全部通过，而不只是 `shape()` 返回正确。
- E 中真实分块 HTTP 的逐项提前失败、有效前缀未 EOF、截断、取消与截止期限不能得出完整通过。
- 原生 3.1/3.2 的 Links、Callbacks、webhooks、认证 AND/OR 与 mTLS 要经过入口级组合测试；不能仅引用旧版 C 的结果当新版本证据。
- `tests/modern-routes.test.mjs` 覆盖原生跨文档链接/精确返回绑定、HTTP 健康/故障回调、外部 PathItem 继承入口 URI 安全声明、组件操作的实际绑定路径、URI-keyed webhook 与入站转换预算；`tests/modern-tls.test.mjs` 使用内存合成 PKI 完成真实回环 HTTPS/mTLS 握手。未绑定的 Components 操作可以解析身份，但没有声明 HTTP 路径时明确阻断，不虚构路径或擅自发送回调操作。
- D/S/V/M/G/E/T/F 加共享 C 的全套回归、MoonBit 检查/构建/测试、CLI 和可复现示例、隐私扫描、包文件白名单与 CI 均需最终记录；发布注册表和运行包仍是独立授权事项。

建议按仓库维护命令执行；定位单个回归时可用：

```powershell
node --test tests/modern-document.test.mjs tests/modern-schema-integration.test.mjs tests/modern-exact.test.mjs tests/modern-vectors.test.mjs
node --test tests/modern-protocol.test.mjs tests/modern-linkset.test.mjs tests/modern-generation.test.mjs tests/modern-transfer.test.mjs tests/modern-execution.test.mjs tests/modern-foundation.test.mjs
```

不要将本文件中源码已经存在、测试用例已经定义、局部回归通过、完整维护通过、跨平台 CI 通过和真实环境验证六种状态混为一谈。
