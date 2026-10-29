# 0.8 原生 OpenAPI 3.1 / 3.2 使用与维护指南

候选版本：**0.8.0-rc.1**。本轮将 OpenAPI 3.1.2 / 3.2.1 接入标准文档、生成、线格式、HTTP、入站验证和结果链路，不将新版描述或 Schema 改写为 3.0；3.0 和旧便携入口继续保留。

当前现代能力声明为 `modern_execution_supported=true`、`implementation_status=native-standard`、`full_openapi_support=true`，规范核对基线为3.1.2/3.2.1。这表示按公开矩阵维护的原生实现范围，不是第三方认证或任意业务完整性保证。最终组合测试、CLI、包与 CI 证据由 [QUALITY_REPORT.md](QUALITY_REPORT.md) 和 [PUBLICATION.md](PUBLICATION.md)记录，不能从能力声明或局部绿灯推导本轮全部测试已通过。本轮允许测试后推送 GitHub，**不发布 Mooncakes 或运行包**，不公开私人申报书、凭据、语料及原始报告。

## 1. 先运行不接触业务系统的样例

需要 Node.js ≥22.19.0，源码构建需要 moonc ≥0.10.15；已发布旧版制品不自动获得本轮新功能。

```sh
npm ci --ignore-scripts
npm run build
node examples/modern-demo.mjs
```

样例自行创建和关闭临时回环服务，对 3.1.2 JSON 与 3.2.1 QUERY/NDJSON 各运行健康和注入故障对照。它检查相邻 int64、null、`$ref` 兄弟约束、逐项/整体流契约与完成状态。健康和故障结果必须不同；样例不连接你的服务、不使用真实资料，也不是外部用户试点。

标准 CLI 不换入口：

```sh
node bin/moonapi-standard.mjs check private-openapi.yaml
node bin/moonapi-standard.mjs plan private-openapi.yaml
# 仅在明确授权的隔离环境运行；默认不允许写入和远端。
node bin/moonapi-standard.mjs run private-openapi.yaml --base http://127.0.0.1:8080
```

check 校验结构、引用与原生 Schema；plan 产生并验证有限候选；只有 run 发请求。运行目标必须显式提供，不根据 servers、样例 URL 或 OAuth 元数据自动连接。库和工作台使用同一原生标准链路，不能把“检查成功”解释为业务通过。

## 2. 原生文档和 Schema

完整对象类别、版本差异、实现位置与测试文件见 [OPENAPI_3_1_3_2_MATRIX.md](OPENAPI_3_1_3_2_MATRIX.md)。规范基线为 [OAS 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[OAS 3.2.1](https://spec.openapis.org/oas/v3.2.1.html) 和 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)。

- 3.2 文档 `$self` 身份与检索 URI 分开；组件、Path Item、operationRef 和 Schema 资源保持各自位置和基 URI。示例、默认值及扩展中的字面 `$ref` 仍是业务数据。
- 默认 OAS 方言、boolean Schema、`$id`/`$defs`/anchor、引用兄弟、`$dynamicRef`、条件/依赖、元组、contains、unevaluated 及精确数值由原生求值器处理，不使用有损双精度结果替代断言。
- 现代 readOnly/writeOnly 默认是注解，不移除 required。format/content 默认按方言作为注解，不将 binary/byte 当作字节转换命令。独立 Schema API 可显式启用已知格式断言或方向拒绝；它们不是标准引擎默认附加约束。
- 未安装方言、未知必需词汇表或未授权引用阻断，不静默退回默认方言。不声称实现整个可选 format-assertion 词汇表；单个已知格式的可选检查不能替代该词汇表。
- Info、Tag、Server、弃用、OAuth/设备流程等元数据验证并保留，不等于渲染文档、获取令牌、授予网络访问或证明业务规则正确。

### 外部内容只按精确 grant 授权

```js
import { StandardEngine } from "./platform/standard.mjs";

const engine = await StandardEngine.open(source, {
  documentURI: "https://test.invalid/api/openapi.json",
  documents: {
    "https://test.invalid/api/models.json": externalSource,
  },
  seed: 42,
  limit: 64,
});
try {
  const plan = await engine.plan(); // 私有：可能含原始业务示例。
  console.log({ planned: plan.cases.length, blockers: plan.blockers.length });
  // 执行时再显式传入被授权的base，不自动访问上述URI。
} finally {
  await engine.close();
}
```

上例的 source/externalSource 是调用者已经取得的文档字符串，不是文件路径。`file:`/`urn:` 或 HTTPS URI 也只从 documents 映射取内容；externalValue 示例不例外。CLI 可用 `--references private-reference-map.json` 提供私有映射，不应提交真实描述或映射到公开仓库。

## 3. 生成、负例和非 JSON 线格式

`modernSchemaTools` 将验证和元数据检查分开：媒体所需的形状视图不能替代原 Schema 断言。固定种子产生有效、边界和无效候选，样例也独立复验。负例须确实违反契约，线上编码后再反解检查其有效/无效类别；不能为了发送成功而把负例改成正例。

生成器是有界搜索，不是任意 Schema 的完备可满足性求解器。`STANDARD_GENERATION_UNSAT_OR_BUDGET` 表示这次无法提供合格候选，不证明 Schema 无解，不能返回空计划后宣布全绿。Schema 很复杂时应检查 blocker、提供仍须复验的明确样例或缩小本次选择，而不是删除约束。

可选参数或请求体无法生成合法值时仍保留合法的省略分支；不可选项不会因此被放宽。可选 MIME Header 无法生成或安全序列化时省略，必需 Header 则阻断。`false` Schema 的含义始终保留，不改成 `{}` 以取得通过。

现代协议适配包括：

- 精确 JSON/YAML 数字与原始 Buffer/Uint8Array 字节；跨线程、复制、摘要和确认见证保留精度和类型。普通 `{type:"Buffer",data:[...]}` 业务对象不会自动变成字节。
- 参数的 path/query/header/cookie 样式、content 和一次百分号编码；3.2 整体 querystring 与普通 query 参数互斥，只按 content 描述编码。URI query 的字面 `+` 不当作 form-urlencoded 空格。
- 新 `style:cookie` 保持百分号原样，不能与旧 form 样式混淆。Set-Cookie 保持多行，不逗号拼接、拆 Expires 或解码 `%xx`。
- 命名、位置和嵌套 Encoding、重复数组字段、part headers、精确二进制和 MIME 边界。多 contentType 由显式配置选择，不按字节嗅探。
- XML element/attribute/text/cdata/none、命名空间、nil、组件根名及按实例选择组合分支；原 Schema 继续独立验证。禁止 DTD/外部实体，冲突别名或无法无歧义表达的结构明确拒绝。
- `application/linkset` 按 RFC9264/8288/8187 在 Link 文本与 `{linkset:[...]}` 数据模型间转换；不是 JSON fallback。保留抽象链接语义和语言/扩展属性，但不保证原始排版或等价分组不变。无法无损表达的扩展值拒绝，Header 模式禁止 CRLF。

CSV、Cookie、XML 等非 JSON 表示可能多解。解码器在有界候选内用原 Schema 选择合法值；穷尽的小集合不合法才报告契约不合格，搜索截断返回 `MODERN_WIRE_COERCION_BUDGET`，属于未确定/资源限制，不应当作已确认接口缺陷。嵌套 deepObject 等规范未定义组合按公开策略处理，不能保证匹配任意框架私有规则。

multipart/form-data 的显式 style/explode/allowReserved 覆盖 contentType，失效的子编码不执行；样式值不做 URI 百分号编码。命名字段的顶层数组仍拆成原字段名的多个 part，位置编码中的嵌套数组保持单个数组值。非 form-data 媒体忽略这些样式，显式命名对象 Encoding 的扩展映射也须往返一致。原始分隔符导致映射多解时明确阻断，不静默回退 JSON。私有帧只接受 JSON 值与真实 Buffer/Uint8Array；日期请先转 ISO 字符串。非有限数、函数、getter、非普通对象、稀疏数组或数组额外属性被拒绝，避免静默改变输入语义。

## 4. 真实分块流与 EOF

现代标准 HTTP 将实际分块交给 worker 中的有状态解析器，支持 JSONL/NDJSON、JSON-seq/+json-seq、SSE 和非 form-data multipart 序列。完成一项即可按 itemSchema 验证；完整数据仍要另满足 schema，二者不能相互替代。

SSE data 保持字符串，支持多行和状态字段，未结束事件按协议丢弃。JSON 记录、UTF-8 和 MIME 边界可跨任意分块；边界看似前缀但不构成分隔符的字节仍是内容。只有收到真实 EOF、完整语法且全部义务通过，`stream_eof_verified` 才为 true。合法前缀、停顿、截断、取消、字节/记录/总时限超预算均不得报完整通过；流失败不自动重试写请求。

媒体默认上限为 1 MiB、256 项、每项 64 KiB、MIME 嵌套 8 层；默认 HTTP 2 秒、总运行 60 秒、worker 命令 10 秒，配置还有严格范围。文档、Schema、生成图、正则和跨线程帧另有预算。完整列表及故障排查见 [OPERATIONS.md](OPERATIONS.md)，函数入口门禁是实际生效值。

## 5. 授权、webhooks 和 mTLS

默认只读方法为 GET/HEAD/OPTIONS/QUERY，QUERY 可带声明的正文。`additionalOperations` 原样保留方法 token 大小写，其余方法默认须 allowWrite；名字像 GET 不代表安全。方法分类不证明后端没有副作用，仍应使用可销毁环境。远端须另行 allowRemote，未知写入和未确认清理停止后续操作，不自动重放。

凭据仍按 scheme 名显式传入 credentials 或可信 credentialProvider。OAuth/OpenID 使用 scopes，3.2 非 OAuth/OpenID 可用 roles；3.1 对应需求数组必须为空。AND/OR、目标碰撞和缺少凭据均有门禁。声明角色、设备授权 URL、OAuth 元数据 URL 或 OpenID URL，不触发自动登录、抓取或真实权限审计。

出站 mutualTLS 使用 `{cert,key,ca?,passphrase?}` 的 PEM 字符串或 Buffer，不将这些字段当文件路径。服务端证书信任、名称、用途和有效期继续检查，不允许 rejectUnauthorized:false 或明文降级。证书及口令不要放在命令行、示例、报告或源码中。

现代库入站 API：

```js
const entries = await engine.webhooks();
// engine需显式allowCallbacks；可选callbackTLS为受控HTTPS接收器配置。
const receiver = await engine.createWebhookReceiver(entries[0].name, {
  timeout: 1000,
  path: {},
});
try {
  // 只把receiver.url交给本次被授权的合成发送方，不自动注册外部服务。
} finally {
  await receiver.close();
}
```

`validateWebhook(name,incoming)` / `validateCallback(...)` 接受可信适配提供的实际 method/url/headers 和 base64 raw；手工伪造 peer_authorized 字段不是 TLS 握手证明。HTTPS/mTLS 接收端按受信 CA 和可选 acceptedFingerprints 核验身份，随后仍验证方法、参数、正文和响应。固定/响应派生外部回调须提供可控接收适配，不能无条件改成本机 URL，也不会自动访问外部接收方。

## 6. 维护、证据和仍然保留的边界

```sh
npm run validate
npm test
node scripts/package-standard.mjs
```

这些命令是维护入口，不是本文预先宣称它们本轮都已通过。根目录 README、[STANDARD_ENGINE](STANDARD_ENGINE.md)、[现代矩阵](OPENAPI_3_1_3_2_MATRIX.md)、[质量记录](QUALITY_REPORT.md)、[发布记录](PUBLICATION.md)分别维护使用、覆盖、执行证据与分发状态；0.7及更早 CI/测试量均是历史证据。

仍须明确：

1. 规范支持声明、一次计划完整通过、第三方认证、穷尽业务与真实用户验证互不等价。3.2未声明响应契约标记 unconstrained，不捏造契约覆盖。
2. 固定上游向量逐文件校验原始字节并执行所选断言；这不是整个 JSON Schema 或 OAS 一致性认证。任意自定义方言/必需词汇表需要实际实现后才能使用。
3. 回环 HTTP/HTTPS、内存生成证书、故障服务和极端字节是受控试验，不证明真实组织的身份系统、外部试点、长期生产压力或所有第三方互通。
4. 旧便携 API 仍有旧解析档边界。Mooncakes 是 MoonBit 计算/policy 核心，不是安装后便拥有四目标网络客户端；现代 Node 适配需对应源码或未来明确发布的标准运行包。
5. 项目采用 Apache-2.0，保留 LICENSE/NOTICE、依赖原许可及上游向量 MIT 许可。来源及分工见 [THIRD_PARTY](THIRD_PARTY.md)。
