# 历史源码与验证记录

以下保留原始历史描述，其中“本轮”“未开放”“未发布”仅指相应历史版本，不是当前状态。当前版本见根目录 README 和 PUBLICATION；历史 CI 不能证明新源码。

### 0.8.0-rc.1 历史源码与验证（不是0.9测试结果）

本轮将原生现代方言接入同一标准执行链：多文档身份与动态引用、2020-12 Schema 校验、有效/边界/无效候选与线上反解复核、精确数字和二进制；新增 QUERY/扩展方法、整体 querystring、Cookie/Set-Cookie、顺序流、位置/嵌套 Encoding、XML nodeType、Link Header 文本映射、webhooks 与 mTLS。元数据保留不等于自动登录、抓取外部资源或获得目标访问许可。

```sh
npm ci --ignore-scripts
npm run build
node examples/modern-demo.mjs
npm run validate
```

现代示例只启动临时回环服务，分别运行 3.1.2 JSON 和 3.2.1 QUERY/NDJSON 的健康及注入故障对照，不访问真实业务系统。流式结果须收到 EOF 并同时通过逐项与整体约束，不能把有效前缀、取消、超时或超预算当通过。默认只读方法为 GET/HEAD/OPTIONS/QUERY；额外方法原样区分大小写，默认需要写许可。

[0.8 使用与安全指南](UPGRADE_0_8.md)、[原生 3.1/3.2 覆盖矩阵](OPENAPI_3_1_3_2_MATRIX.md)说明实现、预算、歧义策略与复验入口。当前现代能力声明为 `implementation_status=native-standard`、`full_openapi_support=true`，规范核对基线为 3.1.2 / 3.2.1。这是按矩阵维护的实现范围，不是本次运行结果或第三方认证；局部测试、示例、全套维护和跨平台 CI 分开记录，实际结果以[维护记录](QUALITY_REPORT.md)和[发布记录](PUBLICATION.md)为准。没有任意 Schema 完备求解、穷尽业务或生产可靠性保证。

本轮本机完整维护已通过：**404项Node回归零失败/零跳过，45核心×四目标、12组Native/JS策略对照**，全部示例与源码包隐私检查通过。固定现代上游1297条选定断言全部执行。修复源码 `d39ec59` 的[三平台CI](https://github.com/bzhangui/moonapi/actions/runs/40810322099)已全部通过，使用Node22.23.4与moonc0.10.18；本地包及失败/修复历史见[维护记录](QUALITY_REPORT.md)。

### 0.7 候选的历史证据（不代表 0.8 验收结果）

0.7 新增**保护归属标记的输入缩减**和**有界响应值/Schema反馈**：显式来源锁、角色/环境/文档授权，选值由MoonBit决定；缩减/确认冻结输入，清理未确认或未知写入立即停止。另修补独立2020-12 Schema探针的精确十进制、动态资源和未评估成员语义；当时19份固定上游文件的660个断言不删减、不跳过。[0.7使用与剩余边界](UPGRADE_0_7.md)记录该版本的API、预算、样例与证据；该历史版本尚未开放完整3.1/3.2执行。

```sh
npm ci --ignore-scripts
npm run build
node examples/owned-reduction-demo.mjs
node examples/feedback-demo.mjs
npm run validate
```

0.7 的完整维护结果见[测试记录](QUALITY_REPORT.md)，对应源码推送/CI见[发布记录](PUBLICATION.md)。不以旧版CI或模拟结果替代当前提交和真实用户证据。

功能冻结提交 `0c8c68c` 的[本轮三平台CI](https://github.com/bzhangui/moonapi/actions/runs/40792676212)已全部通过：每平台250项Node回归、44核心×四目标、10组Native/JS对照、全部示例和两类本地包验证；Linux另完成独立PocketBase/SQLite受控接入与清理。660条现代Schema选定上游断言全过，但不是完整现代OAS执行或真实用户认证。

以下为0.6候选的历史证据：

新增可选加密写意图和只读对账、认证分段账本、SQLite事务fencing参考、归属图清理与覆盖反馈、递归输入缩减、MoonBit库存/计数器并发模型、显式IR迁移、适配探针、去敏诊断和可选离线签名。[0.6使用与剩余缺口](UPGRADE_0_6.md) 明确哪些已实现、哪些仍待完成；**三阶段路线尚未全部完成，完整3.1/3.2执行仍未开放**。新增现代Schema/流式解码仅是实验基础，不冒称完整兼容。测试结果以[维护记录](QUALITY_REPORT.md)为准。

本机225项Node回归、43核心×四目标、9组Native/JS对照、20轮合成耐久和两类运行包重定位验证通过。独立PocketBase/SQLite六轮功能复验通过；Windows临时数据库未能自动清理，私有保留并明确报告。模拟不是生产或真实用户试点。

功能提交 `ada3a97` 已通过 [Windows / macOS / Ubuntu CI40673362956](https://github.com/bzhangui/moonapi/actions/runs/40673362956)，包括macOS签名路径限制修复；Linux另通过独立数据库、重启与哨兵核验及临时资料清理。原始私有报告不上传；完整路线仍按上方缺口说明推进。

```sh
npm ci --ignore-scripts
npm run build
node examples/recovery-demo.mjs
node --expose-gc scripts/soak.mjs --rounds 10
```

以下是0.5候选的历史证据，不代表新候选已通过同一次CI：

功能源码 `ba88827` 已通过 [Windows / Ubuntu / macOS 三平台 CI](https://github.com/bzhangui/moonapi/actions/runs/40479096709)：每平台200项Node回归、41核心×四目标、原生对照、样例及运行包验证；Linux另通过独立PocketBase/SQLite六轮接入。属于受控验证，不是生产或真实用户效果证明。

新增统一执行账本与未知写入恢复、标准 owned 标记清理链、隔离租约、加密确认见证；低配置项目入口、本机工作台、角色凭据、资源状态图、精确守恒断言及有界并发历史检查。保留旧 API 和完整 OpenAPI 3.0 标准执行入口。3.1/3.2 只独立检查结构，执行继续禁用，不冒称已兼容。

```sh
npm ci --ignore-scripts
npm run build
node examples/safe-workflow-demo.mjs
# 仅合成演示服务；浏览器仍需勾选本次写入和清理授权。
node bin/moonapi-workbench.mjs --demo --allow-write
```

启动后打开终端打印的会话链接（仅监听 127.0.0.1:8791）；不要共享令牌。默认不保存配置，持久配置需要独立密钥加密。工作台使用官方 Primer CSS，不部署外部网站、不上传文档。[0.5历史指南](UPGRADE_0_5.md) 与[0.6指南](UPGRADE_0_6.md)覆盖API、模型、密钥、CLI、隐私和证据边界；[版本策略](VERSION_POLICY.md) 明确源码/核心包/运行包分别维护。

### 优先使用：标准状态回归与 CI（0.4.0）

三阶段升级已接入同一标准执行链：精确返回值绑定、跨步骤业务断言、状态前提与依赖保留缩减；提供资源持久化/删除确认、幂等重复请求、库存守恒和异步轮询模板。只读默认；缩减须显式授权隔离重置，不自动重试响应丢失的写请求。

```sh
npm ci --ignore-scripts
npm run build
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
# 仅已授权测试服务，公开报告去除操作名、URL 与正文。
node bin/moonapi-ci.mjs run your-spec.yaml --base http://127.0.0.1:8080 --report-prefix .local/ci-run
```

[标准状态与 CI 指南](WORKFLOW.md) 包含 IR、四类模板、依赖草案、保守契约差异、同文档历史失败优先、私有重放与 JSON/JUnit/静态 HTML。单步观察 API 明确只在内存保留私有上下文；缩减确认和不稳定结果分开，空执行/阻塞/截断不报通过。独立 PocketBase/SQLite 六轮同时验证旧归属档和新标准流程；[参考工具对照](COMPARISON.md) 披露实际测试量与边界，不宣称优于 Schemathesis。
