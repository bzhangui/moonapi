# OpenAPI 3.0 标准入口使用说明

源码 0.4.0，依据 [OAS 3.0.4](https://spec.openapis.org/oas/v3.0.4.html)。标准入口覆盖完整 3.0 对象模型，不把 CRUD、JSON 媒体或精选 Schema 词汇当作最终范围。能力声明、有限执行覆盖和第三方认证是三件事；本项目没有第三方一致性认证，不保证穷尽任意业务或保证赛事通过。状态执行已共用标准链路，见 [状态与 CI 指南](WORKFLOW.md)；旧行为入口继续兼容。

## 安装与命令

需要 Node >=22.19.0、moonc >=0.10.15（高于赛事 0.10.14 底线），维护使用私有 0.10.15 SDK 和 CI stable。

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-standard.mjs check examples/standard-spec.json
node bin/moonapi-standard.mjs plan examples/standard-spec.json
npm run demo:standard
npm run demo:advanced
npm run validate
```

check 校验文档/引用/语义，不发 HTTP；plan 生成并独立校验正负例，也不发 HTTP；只有 run 执行请求。CLI 隐藏正文、凭据、服务器地址和业务 operationId。退出码：0 为命令完成，1 为测试失败/阻塞/截断，2 为输入/配置/编译错误。check 成功不等于服务测试通过。

```sh
# 只对有权测试的隔离服务使用；其它方法须允许写入。
node bin/moonapi-standard.mjs run private-spec.yaml --base http://127.0.0.1:8080 --allow-write --follow-links --allow-callbacks
```

GET/HEAD/OPTIONS 默认可运行，其余方法须 --allow-write；远端另需 --allow-remote。这不意味着 GET 没有业务副作用。TLS 不关闭，不自动跟随重定向、申请令牌、全库重置或重复写入缩减。GET/HEAD/TRACE 不发送正文。标准状态与缩减通过 StandardWorkflow 和独立重置许可执行；旧行为入口继续兼容。

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

本地/循环引用保留共享语义。3.0 Reference Object 兄弟字段忽略；Path Item ref 相邻冲突采用上游合并策略（规范未定义）。业务 example/default/enum/扩展里的 $ref 保持数据，不触发读取。

外部引用及 externalValue 示例通过 documents: {绝对URI: JSON或YAML字符串} 精确授予；file:/urn: 也只使用映射，**不会打开磁盘文件或网络**。默认虚拟根 https://moonapi.invalid/openapi.json，可用 documentURI 改绝对根。CLI --references private-reference-map.json 读取映射，需保持私有；缺授权内容报错。

engine.server(operationId,index,variables) 离线解析操作/路径/根 servers 继承、默认及枚举。运行必须显式 base；服务声明不授权连接。Links.server 不能跨授权 origin 或携带 URL 凭据；无法从 operationRef 唯一定位路径时不猜 URL。

## Schema、精度、媒体与线格式

- 精确保留 JSON/YAML 数字，跨线程和 JSON 请求不转成有损 IEEE 值。standard-value.mjs 提供 number/parseExact/stringifyExact/compare。不要再用 Number/原生 JSON.stringify 损坏 int64/十进制。
- 全部 OAS Schema 约束、组合与格式；未知 format 回退 type。readOnly/writeOnly 按方向投影 required，采用严格方向检查策略。discriminator 不替代组合，也不改变父 Schema 验证结果，按实际满足分支辅助选择。
- 参数规范样式及 explode/allowReserved/content；JSON/XML/text、URL 表单、多部分文件、二进制及 Encoding 全字段。multipart 依规范忽略 style/explode/allowReserved；URL 表单存在显式样式时忽略 contentType。响应支持状态范围/default、媒体与 typed/content headers。
- XML 支持名称/前缀/命名空间/属性/包装与非包装数组、组合与精确数值；DTD/外部实体拒绝。
- 规范未定义的表示采用明确策略：未指定 XML 根名用 root，无命名空间子元素输出空命名空间，必需空非包装数组解为 []；嵌套参数采用 canonical JSON 文本；Cookie 对以 "; " 分开。不能无歧义反解时阻塞。
- URL 表单未显式样式时按 contentType 编码复杂值，数组采用 JSON 文本，二进制用 base64；nullable 空文本优先 enum 中的空字符串，否则解为 null。这些策略不声称是规范唯一表示。
- allowReserved 保留允许字符及有效百分号三元组，同时编码查询结构分隔符 []#&=+。路径穿越、未绑定模板、头注入及 Host/Content-Length 等系统管理头拒绝。

OpenAPI 不定义任意私有媒体内部格式。可传 codecs: {'application/x-private': {encode(value): Buffer, decode(bytes): value}}；函数仅来自受信任调用方，不从规范执行代码。插件自行承担 CPU/副作用安全；仍受字节预算和原始 Schema 校验。不将未知媒体凭空当成 JSON 对象。

## Links 与 Callbacks

followLinks 根据实际响应求值 operationId/operationRef、qualified 参数/正文/server。支持 $url/$method/$statusCode、请求/响应 header/query/path/body、RFC6901 指针及嵌入表达式，保留类型，缺值不填造。受写许可、origin、深度、去重、用例及总时间预算限制。

allowCallbacks 对正例创建本机接收器，给可绑定的 $request.body/query/header/path 地址注入受控 URL，验证实际请求、认证、参数与正文，并生成声明的响应/头。错误方法/正文、缺失或超时不是通过。

固定外部地址、响应派生地址或嵌入模板地址**不能无条件改写**为随机本机地址。此时由使用者提供可控接收适配，调用 engine.validateCallback(operationId,name,expression,incoming)，incoming 含 method/url/headers、base64 raw，可提供已提取的 path 值。standard-expression.mjs 支持完整表达式求值。自动绑定不能完成返回 STANDARD_CALLBACK_BINDING_REQUIRED，不访问真实外部接收方。某条业务路径是否应触发回调由使用者确定；示例将已启用正例的回调作为应触发义务。

## 凭据和结果解释

credentials 或环境变量 MOONAPI_STANDARD_CREDENTIALS 按方案名提供凭据：apiKey/Bearer 用 {value: ...}，Basic 用 {username: ...,password: ...}，OAuth2/OpenID 加 scopes；其它 HTTP 方案用已准备好的方案凭据部分。OR 选一组、组内 AND 注入，冲突/缺值/作用域不足阻塞，远端凭据必须 TLS。不会自动执行 Digest challenge、OAuth 登录或 OpenID discovery，不审计 token 实际权限。

默认不输出凭据/URL/正文；库结果中的业务标识也可能敏感，公开用 CLI 编号报告。MoonBit 负责可移植计算/状态/缩减核心及标准调度、运行时表达式 AST、oracle、执行判定；精确 HTTP 数据不经过双精度 JSON 投影。Node 负责标准文档、精确值、媒体及 HTTP，不冒称四目标网络客户端。新标准模式需要源码/npm，旧便携包不包含它。

full_openapi_support=true 是由矩阵/测试维护的能力声明，不从一次绿灯推出；third_party_certification=false、exhaustive_business_coverage=false。passed/complete 仍要求本次所选计划全部执行且无失败/阻塞/截断。真实用户与长期生产效果待独立授权验证。
