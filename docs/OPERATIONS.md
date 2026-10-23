# 新标准入口与旧计算档的区别

`moonapi-standard.mjs` 使用新 JSON/YAML 标准适配，需要 Node >=22.19.0 和 `npm ci --ignore-scripts`；参见 [指南](STANDARD_ENGINE.md)。本文件下方原有参数、状态/CRUD、单请求缩减预算仍属于旧入口，不会自动变成新标准入口的功能。完整标准目标尚未达成，所有未执行/截断/不支持的语义均不能当作通过。

# 操作、格式与故障

## 0.3 接入补充

优先使用 [免手写模型 CRUD](OWNED_CRUD.md)；原行为 CLI 和契约 CLI 不变。CRUD 使用 `--allow-write --allow-cleanup`，重复写缩减另加 `--shrink-write`；没有全局 reset。超时后的未知写入、归属漂移与清理失败都不能当作已恢复干净。副作用、异步资源与复杂业务继续使用显式隔离模型。独立后端的上游版本、复现命令和证据边界见 [INTEGRATION_EVIDENCE](INTEGRATION_EVIDENCE.md)。

0.2 新状态模式使用 `bin/moonapi-behavior.mjs`，语法、独立重置、权限和范围见 [BEHAVIOR_ENGINE](BEHAVIOR_ENGINE.md)，反例见 [REVIEW_CASES](REVIEW_CASES.md)。旧 `--scenario` 仍可串联，但不在污染状态上自动缩减失败步骤；场景生成现在遵循配置 seed。下文格式 1 单请求报告与新格式 2 状态报告分开，不混计缩减证据。

## 预算

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
