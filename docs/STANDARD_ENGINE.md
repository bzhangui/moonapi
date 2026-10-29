# OpenAPI 标准入口使用说明

当前候选 **0.8.0-rc.1** 接入原生 OpenAPI 3.1/3.2，规范核对基线为 3.1.2 / 3.2.1，保留 3.0 标准实现和已有状态/安全能力。原文档版本、Schema 方言、引用身份和字节不降级为 3.0。当前现代实现声明为 `implementation_status=native-standard`、`full_openapi_support=true`；它描述矩阵维护的实现范围，不等于任意计划或本轮组合验证已经通过。CLI/包、完整维护和 CI 结果以[维护记录](QUALITY_REPORT.md)为准。

[0.8指南](UPGRADE_0_8.md)和[原生覆盖矩阵](OPENAPI_3_1_3_2_MATRIX.md)给出新能力与边界；[0.7指南](UPGRADE_0_7.md)、[0.6指南](UPGRADE_0_6.md)是对应历史版本记录。

标准层始于0.4.0，原3.0实现依据 [OAS 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)；现代实现依据 [3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[3.2.1](https://spec.openapis.org/oas/v3.2.1.html)及各自默认 Schema 方言。不把 CRUD、JSON 媒体或精选词汇当作最终范围。能力声明、有限执行覆盖和第三方认证是三件事；本项目没有第三方一致性认证，不保证穷尽任意业务或保证赛事通过。状态执行已共用标准链路，见[状态与 CI 指南](WORKFLOW.md)；旧行为入口继续兼容。

## 安装与命令

需要 Node >=22.19.0、moonc >=0.10.15（高于赛事 0.10.14 底线），维护使用私有 0.10.15 SDK 和 CI stable。

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-standard.mjs check examples/standard-spec.json
node bin/moonapi-standard.mjs plan examples/standard-spec.json
npm run demo:standard
npm run demo:advanced
node examples/modern-demo.mjs
npm run validate
```

check 校验文档/引用/语义，不发 HTTP；plan 生成并独立校验正负例，也不发 HTTP；只有 run 执行请求。CLI 隐藏正文、凭据、服务器地址和业务 operationId。退出码：0 为命令完成，1 为测试失败/阻塞/截断，2 为输入/配置/编译错误。check 成功不等于服务测试通过。

```sh
# 只对有权测试的隔离服务使用；其它方法须允许写入。
node bin/moonapi-standard.mjs run private-spec.yaml --base http://127.0.0.1:8080 --allow-write --follow-links --allow-callbacks
```

GET/HEAD/OPTIONS 默认可运行；3.2 的 QUERY 也采用明确只读策略，并可按声明发送正文。`additionalOperations` 的方法 token 原样区分大小写，名字类似 `get` 不等于标准 GET；其他方法均须 --allow-write。远端另需 --allow-remote。这些策略不证明服务没有副作用。TLS 不关闭，不自动跟随重定向、申请令牌、全库重置或重复写入缩减。GET/HEAD/TRACE 不发送正文。标准状态与缩减通过 StandardWorkflow 和独立重置许可执行；旧行为入口继续兼容。

## 库与生命周期

```js
import { StandardEngine } from "./platform/standard.mjs";
const engine = await StandardEngine.open(source, {
  seed: 42,
  limit: 256,
  allowWrite: true,
  followLinks: true,
  allowCallbacks: true,
  callbackTimeout: 1000,
  linkDepth: 4,
});
try {
  const plan = await engine.plan(); // 私有：可能包含原始示例。
  const result = await engine.run("http://127.0.0.1:8080");
} finally {
  await engine.close();
}
```

实例使用独立、可终止的工作线程；禁止同实例并发 plan/run，关闭后不可复用。必须 finally close。回调接收器逐用例随机 token/端口，只监听 loopback；finally 销毁 socket 并关闭，不改现有服务。

默认源文档 1 MiB，外部文档合计 4 MiB/16 个，操作/计划各 256，每操作候选 128，请求 256 KiB，响应 1 MiB；单 HTTP 2 秒，总运行 60 秒，工作线程命令 10 秒，允许规定范围内配置。预算耗尽、未授权、缺凭据、无法生成或链接未完成不能报通过；有限搜索失败也不证明 Schema 无解。

validateRequest(case) 接收逻辑参数/正文；validateResponse(id,status,body,headers,empty) 接收**已解码**响应。网络执行另做字节/媒体解码、线上请求反解复核，避免认证覆盖或序列化改变负例含义。不要把逻辑校验 API 当原始 HTTP 解析器。

## 引用、示例与地址

本地/循环引用保留共享语义。3.0 Reference Object 兄弟字段忽略；该历史实现的 Path Item ref 相邻冲突采用上游合并策略。现代 Reference Object 按对象类型处理 summary/description，Schema `$ref` 兄弟断言保留；现代 Path Item 引用与本地冲突字段拒绝，不猜规范未定义的合并结果。3.2 `$self` 文档身份与检索 URI 分开索引；Schema `$id`/anchor/dynamicRef 依原生资源和动态作用域处理。业务 example/default/enum/扩展里的 `$ref` 保持数据，不触发读取。

外部引用及 externalValue 示例通过 documents: {绝对URI: JSON或YAML字符串} 精确授予；file:/urn: 也只使用映射，**不会打开磁盘文件或网络**。默认虚拟根 https://moonapi.invalid/openapi.json，可用 documentURI 改绝对根。CLI --references private-reference-map.json 读取映射，需保持私有；缺授权内容报错。

engine.server(operationId,index,variables) 离线解析操作/路径/根 servers 继承、默认及枚举。运行必须显式 base；服务声明不授权连接。Links.server 不能跨授权 origin 或携带 URL 凭据；无法从 operationRef 唯一定位路径时不猜 URL。

## Schema、精度、媒体与线格式

以下两条规则不能跨版本套用：3.0 的 nullable、方向投影和 format 行为保留在 3.0 入口；3.1/3.2 使用原生 type 联合、2020-12 applicator/unevaluated 语义，readOnly/writeOnly 默认是注解，required 不因这些注解而被删除。现代 format/content 默认作为注解，不把 format:binary/byte 当作编码或解码指令；独立 Schema API 的附加格式断言/方向拒绝是显式策略，不是默认方言规则。

现代 Schema 校验包含 boolean Schema、精确数值、条件/依赖、动态引用、元组、contains 和求值成员传播。未知必需词汇表或未安装方言明确阻断；可选未知注解保持惰性。不宣称实现整个可选 format-assertion 词汇表。生成器是固定种子的有界候选搜索，每个正例及负例分类经过原 Schema 复核；`STANDARD_GENERATION_UNSAT_OR_BUDGET` 不表示已证明 Schema 无解。

- 精确保留 JSON/YAML 数字，跨线程和 JSON 请求不转成有损 IEEE 值。standard-value.mjs 提供 number/parseExact/stringifyExact/compare。不要再用 Number/原生 JSON.stringify 损坏 int64/十进制。
- 3.0 的组合、约束与格式保持原行为：未知 format 回退 type，readOnly/writeOnly 按方向投影 required。各版本 discriminator 均不替代组合，也不改变父 Schema 验证结果，按实际满足分支辅助选择。
- 参数规范样式及 explode/allowReserved/content；JSON/XML/text、URL 表单、多部分文件、二进制及 Encoding 全字段。multipart 依规范忽略 style/explode/allowReserved；URL 表单存在显式样式时忽略 contentType。响应支持状态范围/default、媒体与 typed/content headers。
- XML 支持名称/前缀/命名空间/属性/包装与非包装数组、组合与精确数值；现代实现另支持 nodeType element/attribute/text/cdata/none、nil 和按每个实例选择分支注解。DTD/外部实体、冲突别名和不明确的相邻文本表示拒绝。
- 规范未定义的表示采用明确策略：3.0 未指定 XML 根名用 root；现代 XML 依显式名称或组件名，缺省策略见现代矩阵。无命名空间子元素输出空命名空间，必需空非包装数组解为 []；嵌套 RFC6570 参数采用 canonical JSON 文本，不猜框架私有 deepObject 规则。
- 3.0 URL 表单默认数组 JSON 文本、二进制 base64 和 nullable 空值策略保持；现代 form 默认重复数组字段，复杂项按显式媒体编码，二进制保留真实字节。3.2 支持 prefixEncoding/itemEncoding 与嵌套 MIME；多 contentType 由调用方显式选择，不嗅探内容。
- 现代 Cookie `style:cookie` 不做 URI 百分号变换，旧 form 样式保留自己的转义行为；Set-Cookie 保持独立行，不逗号拼接或拆 Expires。3.2 整体 querystring 使用 content，不能同时声明 query 参数，表单只编码一次。
- allowReserved 保留允许字符及有效百分号三元组；现代 URI query 的字面 `+` 不当作表单空格，旧3.0的 `+` 策略不变。查询结构分隔符、路径穿越、未绑定模板、头注入及 Host/Content-Length 等系统管理头仍受防护。线格式多解时使用有界候选及原 Schema 复核；搜索耗尽报告未确定，不当作接口故障。
- 现代 `application/linkset` 按 RFC9264/8288 文本与 Linkset JSON 数据模型转换，不退回 JSON 文本。Header 模式禁止换行；转换保留抽象链接语义，不保证原始排版、属性顺序或等价目标分组不变。

现代顺序媒体支持 JSONL/NDJSON、JSON-seq/+json-seq、SSE 和非 form-data 的 multipart 序列。每个完成项按 itemSchema 验证，整体数据另按 schema 验证；HTTP 真实分块接入 worker，不等完整缓冲才检查第一项。只有实际 EOF、语法完整、逐项和整体义务都通过才完整通过。SSE data 保持字符串，未结束的 SSE 事件按协议丢弃，不凭前缀合格提前结束测试。二进制通过专用跨线程帧保真；像 Buffer 的普通业务对象仍是普通对象。

OpenAPI 不定义任意私有媒体内部格式。可传 codecs: {'application/x-private': {encode(value): Buffer, decode(bytes): value}}；函数仅来自受信任调用方，不从规范执行代码。插件自行承担 CPU/副作用安全；仍受字节预算和原始 Schema 校验。不将未知媒体凭空当成 JSON 对象。

## Links 与 Callbacks

followLinks 根据实际响应求值 operationId/operationRef、qualified 参数/正文/server。支持 $url/$method/$statusCode、请求/响应 header/query/path/body、RFC6901 指针及嵌入表达式，保留类型，缺值不填造。受写许可、origin、深度、去重、用例及总时间预算限制。

allowCallbacks 对正例创建本机接收器，给可绑定的 $request.body/query/header/path 地址注入受控 URL，验证实际请求、认证、参数与正文，并生成声明的响应/头。错误方法/正文、缺失或超时不是通过。

现代文档的独立 webhooks 使用 `await engine.webhooks()` 查询，`validateWebhook(name,incoming)` 校验可控入站数据；`createWebhookReceiver(name,{timeout,path})` 需 allowCallbacks，返回临时 loopback 接收器，必须关闭。这些 API 不会注册外部 webhook 或让远端自动访问你的电脑。通过 callbackTLS 可为受控接收端配置 HTTPS；入站 mTLS 除信任链外还可按显式 acceptedFingerprints 限定身份。

固定外部地址、响应派生地址或嵌入模板地址**不能无条件改写**为随机本机地址。此时由使用者提供可控接收适配，调用 engine.validateCallback(operationId,name,expression,incoming)，incoming 含 method/url/headers、base64 raw，可提供已提取的 path 值。standard-expression.mjs 支持完整表达式求值。自动绑定不能完成返回 STANDARD_CALLBACK_BINDING_REQUIRED，不访问真实外部接收方。某条业务路径是否应触发回调由使用者确定；示例将已启用正例的回调作为应触发义务。

## 凭据和结果解释

credentials 或环境变量 MOONAPI_STANDARD_CREDENTIALS 按方案名提供凭据：apiKey/Bearer 用 {value: ...}，Basic 用 {username: ...,password: ...}，OAuth2/OpenID 加 scopes；其它 HTTP 方案用已准备好的方案凭据部分。3.2 非 OAuth/OpenID 安全需求可用 roles 声明；3.1 的这类需求数组必须为空。OR 选一组、组内 AND 注入，冲突/缺值/作用域不足阻塞，远端凭据必须 TLS。mutualTLS 使用显式 cert/key，可选 ca/passphrase；不从规范或任意路径读取密钥，不能配置 rejectUnauthorized:false。不会自动执行 Digest challenge、OAuth/设备登录或 OpenID/OAuth 元数据抓取，也不审计 token 实际权限。

默认不输出凭据/URL/正文；库结果中的业务标识也可能敏感，公开用 CLI 编号报告。MoonBit 负责可移植计算/状态/缩减核心及标准调度、运行时表达式 AST、oracle、执行判定；精确 HTTP 数据不经过双精度 JSON 投影。Node 负责标准文档、精确值、媒体及 HTTP，不冒称四目标网络客户端。新标准模式需要源码/npm，旧便携包不包含它。

3.0 和原生3.1/3.2的 full_openapi_support=true 均由各自矩阵/测试维护，不从一次绿灯推出；现代实现另标 implementation_status=native-standard 和规范核对基线。third_party_certification=false、exhaustive_business_coverage=false。passed/complete 仍要求本次所选计划全部执行且无失败/阻塞/截断，3.2未声明响应契约会另标 unconstrained，而非虚构验证了不存在的约束。真实用户与长期生产效果待独立授权验证。
