# 0.6.0-rc.1：日常安全回归与扩展基础

本轮是候选源码与本地验证包，**不发布 Mooncakes、GitHub Release 或运行包**。Apache-2.0、NOTICE 和上游向量/依赖许可保留。已发布版本与本轮候选不能混称。测试实绩单独记录在 QUALITY_REPORT，以下功能描述不是全部路线已完成的声明。

## 三阶段落地状态

| 阶段 | 本轮已实现 | 仍不能算已完成 |
| --- | --- | --- |
| 日常安全闭环 | 可选加密写意图、只读回执对账、分段/HMAC账本、外部检查点、SQLite事务内 fencing 参考、本地诊断 | 意图与服务端幂等回执需接收系统集成；不是自动恢复队列。无生产数据库/跨主机隔离证明；账本总量仍为8 MiB，不是无限流式归档 |
| 业务深度 | 图与归属清理组合、成功转移覆盖反馈、递归/精确数输入缩减、MoonBit计数器/库存预留并发历史检查 | 尚非响应值/Schema联合学习；owned清理模型仍禁用输入缩减；集合/队列等一致性模型、多个独立业务后端仍待扩展 |
| 生态与交付 | IR显式迁移、适配契约探针、调用者密钥离线签名/验证、本机有界耐久脚本、现代Schema/流式媒体实验基础 | 完整OAS 3.1/3.2执行、生产身份服务、长期生产运行与外部真实试点没有完成，不作完整兼容/认证声明 |

原有完整 OpenAPI 3.0 标准入口保持；3.1/3.2 仍拒绝执行，没有改写版本绕过门禁。现代 Schema 探针不是 OpenAPI 文档执行器。官方语义基准：[OAS 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)、[OAS 3.2.1](https://spec.openapis.org/oas/v3.2.1.html)、[Ajv JSON Schema](https://ajv.js.org/json-schema.html)。结构、Schema探针或媒体解码通过都不是整套标准执行通过。

## 先运行不接触真实资料的示例

```sh
npm ci --ignore-scripts
npm run build
node examples/recovery-demo.mjs
node --expose-gc scripts/soak.mjs --rounds 10
npm run validate
```

恢复演示启动专用回环合成服务，制造一次“提交成功但响应丢失”，保存加密意图/HMAC账本并只读对账；**仍然只发送一次创建，不据此自动删除或重发**。退出清理本轮专用夹具，不能据此证明真实客户试点。

耐久脚本每轮验证归属流程、无剩余资源与未知写入、合成账本大小，回收该轮合成文件；1–1000轮，明确堆/RSS门限。运行时间、峰值和实际轮数以输出为准。它不证明多周无泄漏或生产容量，不自动扩展磁盘，也不是通用性能排名。

## 加密执行意图（显式启用）

使用 `ExecutionIntentStore`，调用者提供独立32字节密钥、私有目录、目标/文档/模型摘要和本轮归属标记。不要向聊天发送密钥；不要复用 bearer token 作为归属标记或加密密钥。

```js
import { ExecutionIntentStore, intentEnvironmentBinding } from './platform/execution-intent.mjs';
import { documentDigest } from './platform/ci-tools.mjs';
import { digestExact } from './platform/private-store.mjs';
import { StandardWorkflow } from './platform/workflow.mjs';

// source/model/base/marker/key 来自调用者的私有配置；key 是32字节Buffer。
const store = new ExecutionIntentStore({
  directory: '.local/intents', key,
  environmentBinding: intentEnvironmentBinding(base),
  documentBinding: documentDigest(source), // 有外部映射时传 documentDigest(source, documents)
  modelBinding: digestExact(model), ownershipMarker: marker,
});
const engine = await StandardWorkflow.open(source, { allowWrite: true, intentStore: store });
try {
  const report = await engine.run(base, model, {
    allowCleanup: true,
    journalDirectory: '.local/ledgers',
    journalOptions: { authKey: key, segmentBytes: 65536 },
  });
  // 私下保留 report.execution.final_hash 作为外部最终检查点。
  // unknown_writes > 0 时停止写入/重置，交由只读对账和人工处置。
} finally {
  await engine.close(); store.close();
}
```

意图在序列化/权限/线缆契约校验后、dispatch前原子不可覆盖保存并fsync；保存失败阻断发送。AES-256-GCM envelope采用现有私有存储格式，解密后严格区分 intent/witness 类型。只存目标、文档、模型、归属、操作与请求的摘要及随机ID，不存正文、URL、认证头或返回ID；摘要并非匿名化/身份凭证。模型和归属摘要是**调用者提供的绑定标签**，不是自动证明实际业务归属；实际删除仍依赖已有 ownership GET 核验。

没有自动注入幂等头、幂等服务、写重试或队列。若业务声明幂等键，仍须在模型显式定义并在接收端实现；意图ID不等于服务端幂等键。密钥丢失即无法解密；Windows POSIX mode不等于ACL，请使用账户独占目录。不能防御同一用户的恶意进程/磁盘竞争。

进程重启后使用相同私有绑定和密钥构造 store，`store.inspect(id)` 读取意图。`store.reconcile(id, adapter, {timeout:2000})` 仅调用受信任的 `{version:1, inspect(intent,signal)}` 只读回执适配器；返回需匹配 request_digest/environment_binding：

- `state:'committed'` → `observed_committed`；
- `state:'not_committed', authoritative:true` → `authoritatively_not_committed`；
- 普通404、摘要不匹配、无法证明未提交 → `still_unknown`。

`authoritative` 是受信任适配器的承诺，不是本工具验证的服务端一致性证明。必须连接线性化/事务性回执源，不能把最终一致GET的404改标成权威回执。对账只保存加密处置记录，不执行HTTP写入，所有结果都 `automatic_replay_permitted:false`。由于不存正文/返回ID，接收系统需维护请求摘要到业务资源的回执索引；缺失时人工接管，不猜测ID或扩大清理范围。

## 分段、认证与恢复

`journalOptions` 仅接受 `authKey/segmentBytes/maxBytes`。默认兼容旧format1无签名账本；提供32字节authKey才使用format2 HMAC。默认单段/总量8 MiB；分段下限1 KiB，总量仍不超过8 MiB，内存也有界。写入或轮转失败即关闭writer，不降级为内存日志。

```js
import { recoverSegmentedLedger } from './platform/execution-ledger.mjs';
const report = await recoverSegmentedLedger('.local/ledgers', runId, {
  authKey: key,
  expectedFinalHash: separatelyStoredFinalHash,
});
```

文件名为 `RUN.jsonl`、`RUN.0001.jsonl` 等。检查缺段/乱序、格式、同一attempt身份、单调时间、状态机、哈希链、HMAC；恢复索引改为Map，避免逐条扫描先前attempt。仅最后一段不完整尾记录可作为 torn_tail 报告；中间截断拒绝。旧单文件 `recoverLedger(file)` 保留。

HMAC是**共享密钥认证，不是公钥签名**。没有独立存储的最终检查点时，完整记录/完整末段删除仍可留下合法前缀，工具明确报告该边界；不能把本地可替换的检查点当作防回滚信任根。任何恢复结果都不自动重放。

## 服务端隔离与资源图

`examples/fenced-sqlite.mjs` 是专用临时SQLite参考服务。epoch/owner核验、余额变更处于同一个 `BEGIN IMMEDIATE` 事务，提交前无await；过期/旧epoch/跨租户写入拒绝，旧owner释放不能撤销新owner。`IsolationLease` 的客户端检查没有被冒称服务端锁。

该参考服务仅回环、合成资料、单进程。没有跨主机锁、生产权限、远端数据库连接或崩溃后多服务选主保证；真实适配需在业务端事务中部署相应机制并独立验证。

`planResourceGraph` 支持显式cleanup，重写真实ID/ownership绑定；cleanup引用的producer只允许max_visits=1，拒绝无法穷举清理的多资源歧义。未选择producer时不生成其cleanup。`runGraphCampaign` 可选显式reset，或启用allowCleanup并配置归属清理；任一未知写入/预算/清理失败阻断后续轮次。没有全局重置许可不会执行reset。

图必须声明实际业务状态 `requires_state/set_state`；仅有旧的effects/requires不足以描述资源在删除后不可读等业务约束。`feedback:true` 只优先成功轮次尚未覆盖的合法转移，不据失败轮次自称覆盖、不提高max_visits；不是响应值学习或全部路径探索。

## 缩减和一致性检查

输入缩减仅接受 `shrink_inputs` 指定外生字段，递归删除对象成员/数组元素、按Unicode码点缩短字符串、用BigInt精确缩短数值。每个候选字节严格减少，深度8、每层16元素、候选64，有统一时间/尝试预算；每次仍须请求Schema、依赖、状态、相同指纹与最终独立重放通过。owned cleanup模型继续禁用输入缩减，避免删除归属标记；不宣称全局最小或任意字段都可缩减。

`concurrentResourceProbe` 新增最多8操作的counter/reservation模型，MoonBit判断存在尊重实时先后关系的合法串行历史，检查成功/失败及每个返回余额，而非仅比较最终加总。支持显式初值/容量、共享标准权限与契约门禁、可选认证账本；传输/契约不确定返回inconclusive，不重试。此模型不表示队列、集合、可串行化数据库事务或最终一致接口已经被支持，也不证明任意历史的线性一致性。

## 扩展和私有诊断

- `migrateWorkflow(model,description,2)` 显式验证并迁移IR v1→v2；不删字段、不猜状态、不执行请求；未知版本拒绝。旧v1继续可用。
- `probeTransportAdapter(adapter,base)` 只发送显式授权目标的GET，检查有界返回及pre-aborted wrapper阻断；它不认证原始适配器的合作性，更不是不可信插件沙箱。
- `node bin/moonapi-project.mjs diagnose .local/private-report.json` 只输出固定去敏建议；不回显原始消息、路径、正文或字段名。未知写入优先人工对账，不提示自动重试。

## 现代标准实验基础（执行尚未开放）

`probeModernSchema(schemaJSON,dataJSON)` 在有CPU/堆/深度预算的独立worker使用Ajv2020，覆盖boolean Schema、ref siblings、dynamicRef、prefixItems、contains计数、dependentRequired、if/then/else和unevaluatedProperties等实验用例。format默认注解，可显式assertFormats；readOnly/writeOnly不套用3.0的禁止策略。引用只来自调用者documents映射，不自动读取网络/文件。超出二进制数值精确表示的输入拒绝，不静默舍入；**这仍不足以宣称完整2020-12/OAS方言支持**。

`decodeSequence(asyncChunks,{media})` 提供NDJSON、RFC7464风格JSON序列和SSE的有界增量UTF-8解码原语；跨字节边界保留中文/int64，SSE处理CR/CRLF、多行data和未终止事件。总量1 MiB/条目256/分块8192，并有单条/时间预算；异常不报告部分通过。没有连接到标准HTTP运行链、itemSchema、itemEncoding、prefixEncoding、安全/回调/新HTTP语义与完整生成器的端到端实现，因此 `openapi_execution_supported:false`，不能用于声称完整3.2执行。

后续完整3.1/3.2门禁仍包括：OAS dialect/vocabulary、任意精确数、现代引用与schema资源身份、webhooks、参数/安全/媒体新增语义、生成/反例/缩减、请求与响应契约和三平台独立端到端向量。不能以结构探针或少数绿例代替。

## 离线签名（可选，不自动发布）

默认运行包仍未签名。调用者自行准备/保管Ed25519密钥并经独立可信渠道分发公钥。工具不生成项目身份，不提供假签名认证；测试只用一次性合成密钥。

```sh
node scripts/sign-manifest.mjs sign .local/releases/EXACT_BUNDLE .local/private-key.pem .local/manifest.signature.json
node scripts/sign-manifest.mjs verify .local/releases/EXACT_BUNDLE .local/trusted-public-key.pem .local/manifest.signature.json
```

先验证完整文件集合和摘要，再签/验manifest原始字节；sidecar须在运行包外，禁止覆盖现有文件，不自动信任包内公钥。私钥/sidecar不进入公开allowlist。签名绑定制品字节，不保证内容无漏洞、第三方身份或全平台可复现。默认SBOM/provenance的 `signed:false` 仍准确，不因提供可选签名工具就改为true。

## 维护和隐私

`npm run validate` 强制四目标核心、JS/Native对照、全部Node回归（文件并发上限4）、示例、有界耐久与包隐私门禁；两个打包脚本另验证重定位与依赖。并发上限用于避免宿主过量工作线程，并不跳过失败或缩小测试集合。

`.local`、申报书、凭据、意图、处置记录、执行账本及原始报告不推送。新测试仅合成标记和临时目录。实际测试失败保留在本地记录，不用“重跑绿了”冒称历史宿主异常已定位修复。真实用户、身份服务、跨主机隔离/故障及长期生产压测仍待相应授权与独立证据。
