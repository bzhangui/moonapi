# 新标准入口与旧计算档的区别

`moonapi-standard.mjs` 使用 JSON/YAML 标准适配；源码安装需要 Node >=22.19.0 和 `npm ci --ignore-scripts`，已发布标准运行包不需 SDK。参见 [标准指南](STANDARD_ENGINE.md) 与 [统一状态/CI](WORKFLOW.md)。下方旧参数、状态/CRUD 和单请求缩减预算仍属于旧入口，不自动成为标准入口能力；旧解析档不支持完整标准，所有未执行/截断/阻塞均不能当通过。

## 0.8 原生 3.1/3.2 候选的操作边界

0.8.0-rc.1 已接入原生 OpenAPI 3.1/3.2 标准执行链，规范核对基线为 3.1.2 / 3.2.1，不将新版 Schema 转写成 3.0。现代能力声明为 `implementation_status=native-standard`、`full_openapi_support=true`；它不是本次计划完成、第三方认证或全量业务保证，新源码也不是已经发布的 Mooncakes 或运行包。见 [0.8指南](UPGRADE_0_8.md)、[覆盖矩阵](OPENAPI_3_1_3_2_MATRIX.md)及[本轮证据](QUALITY_REPORT.md)。

```sh
npm ci --ignore-scripts
npm run build
node examples/modern-demo.mjs
```

该命令只使用临时合成回环服务，健康/注入故障结果必须不同；不会访问业务接口。标准CLI仍用 `check / plan / run`：check 不发HTTP，plan只生成并校验候选，run必须显式提供 `--base`。工作台的方言检查和只读执行也走原生入口，未来未知版本不能降级后放行。

### 现代标准预算与故障判定

标准入口默认源文档1 MiB、外部grant最多16份/合计4 MiB，操作/计划各256，每操作候选128，请求256 KiB、响应1 MiB；HTTP默认2秒、总运行60秒、worker命令10秒。可配置范围以 `StandardEngine.open` 参数门禁为准，不接受字符串布尔值或未知选项。

现代媒体默认1 MiB、256项、每项64 KiB、嵌套MIME最多8层；Schema、引用图、正则worker、跨线程字节帧、生成深度/尝试和回调各有独立上限。不要将下方旧档的JS安全整数/响应256 KiB限制套到现代标准入口：现代数值使用精确十进制/整数，二进制通过专用字节帧保留。

- 生成无候选、未授予的资源、未安装方言或未知必需词汇表是阻塞；有限搜索不是不可满足性证明。
- 参数、头和Cookie线格式类型多解时，用原Schema复核有界候选；`MODERN_WIRE_COERCION_BUDGET` 表示本次不能确定，不是已确认接口缺陷。确定的契约不合格与资源限制分开。
- 顺序流的完成项可提前失败；合法前缀、未收到EOF、截断、停顿、取消和总时限均不得报完整通过。先查预算、媒体和服务生命周期，不增加无限等待或丢弃尾项来换绿。
- 未知写入继续停止，不自动重试；只读QUERY也不能替代实际业务隔离。额外方法token区分大小写，非标准方法默认需要写许可。
- TLS必须验证服务端；mTLS缺证书、错误CA/名称/用途/有效期、错误密钥或无TLS不得降级明文。凭据、PEM、回调会话URL和原始报告均应私有。

执行诊断顺序：先 `check` 文档/grant，再 `plan` 检查 blockers/生成预算，然后运行本机合成样例，最后才对授权目标执行。`full_openapi_support` 是维护声明，`passed/complete` 是本次计划结果；空执行、覆盖截断、unconstrained响应与真实生产验收不能相互替代。

# 操作、格式与故障

## 0.3 接入补充

优先使用 [免手写模型 CRUD](OWNED_CRUD.md)；原行为 CLI 和契约 CLI 不变。CRUD 使用 `--allow-write --allow-cleanup`，重复写缩减另加 `--shrink-write`；没有全局 reset。超时后的未知写入、归属漂移与清理失败都不能当作已恢复干净。副作用、异步资源与复杂业务继续使用显式隔离模型。独立后端的上游版本、复现命令和证据边界见 [INTEGRATION_EVIDENCE](INTEGRATION_EVIDENCE.md)。

0.2 新状态模式使用 `bin/moonapi-behavior.mjs`，语法、独立重置、权限和范围见 [BEHAVIOR_ENGINE](BEHAVIOR_ENGINE.md)，反例见 [REVIEW_CASES](REVIEW_CASES.md)。旧 `--scenario` 仍可串联，但不在污染状态上自动缩减失败步骤；场景生成现在遵循配置 seed。下文格式 1 单请求报告与新格式 2 状态报告分开，不混计缩减证据。

## 旧便携档预算（不是现代标准入口）

CLI 描述 ≤512 KiB、场景 ≤64 KiB；核心 JSON ≤4 MiB/48 层，展开 schema ≤4096 节点/16 层。路径128、操作256、参数32、属性64、枚举32。生成树≤10000节点，字符串/数组≤4096；生成数值范围±1000000。响应整数为 JS 安全整数；精确 uint64 业务数据应用字符串 schema。

默认用例64/最高256，请求/响应256 KiB，URL8192；请求1500ms/总60秒。超预算失败，不隐式当作覆盖。

描述、场景和状态模型文件需有效 UTF-8，可带 BOM。按实际读取字节检查上限，非法编码和 JSON 语法报去敏配置错误（退出码 2），不会把替换字符当作原始数据或回显私人路径/内容。行为 CLI 的重置只接受契约通过且非 202 的 2xx；其他结果停止，不执行后续路径。

## 场景与报告

参照 examples/scenario.json。operationId 定义操作，body 具体输入，parameters 覆盖变量；`{"$from":"item_id"}` 引用之前捕获，capture 使用 JSON Pointer，status 指定本步状态。遇失败停止，不回滚已发生写入。

报告格式1：case_id、操作、状态、问题代码/位置、指纹、原始/最小体积与缩减次数。默认无原始体。指纹由状态/首问题/位置组成；候选保持请求有效性类别且变小，重放仍同一失败才采纳，不等于全局最小。

只读跳过、停止、零执行不能当完整通过；网络/访问/限流不盲目缩减。先检查支持子集、许可、构建、预算和测试环境，不为去除失败删掉契约。

报告 `.local/reports` 随机新名不覆盖，复现输入保持私有。先跑 demo 本地基准再排查授权系统。

## 0.1.1 维护变化

构造和运行选项必须为正确对象，未知字段和字符串布尔拒绝。场景允许 name/steps，步骤允许 operationId/parameters/body/negative/status/capture；显式 status 必须是100..599。GET/HEAD 不支持请求体；HEAD 响应只校验状态，不强求 JSON body。

报告新增 planned、not_executed、stop_reason；总时限到期返回部分结果而非丢弃报告。运行中捕获/绑定出错会保留已执行结果、给出去敏错误阶段并标记不完整；不会回滚写入。complete 只表示本次选定计划完整执行，不是所有接口/业务分支覆盖。

指针采用规范的~0/~1转义，数组索引不允许前导零；未声明响应属性的位置使用<undeclared>，不输出观察到的属性名。保存目录拒绝链接；Windows 本地隐私依赖可信主机和NTFS权限，真实复现仍不能公开。升级建议使用0.1.1，不依赖0.1.0忽略非法配置的行为。
