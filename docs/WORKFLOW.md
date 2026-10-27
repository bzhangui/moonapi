# 标准状态回归与 CI（0.4.0）

## 三阶段交付

1. 可信基线：组合 Schema 方向性 required 修复；固定向量、种子变异/往返和健康/故障对照；区分 defect、transport、inconclusive、blocked、budget。
2. 统一执行：`StandardWorkflow` 复用 `StandardEngine.execute` 的标准契约、编码、认证与回调链路。MoonBit `workflow_check/remove/assert/category` 负责状态元数据、依赖闭包、断言判决和分类；精确数值保留在无损宿主 IR，不经过 double 投影。旧 BehaviorEngine/OwnedCrudEngine 保持兼容，不作为标准层的能力证明。
3. CI 交付：保守契约差异、同文档历史失败优先、私有重放、JSON/JUnit/无脚本 HTML、锁定安装的标准运行包和独立后端/参考工具对照。

```sh
npm ci --ignore-scripts
npm run build
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
node bin/moonapi-ci.mjs run your-spec.yaml --base http://127.0.0.1:8080 --report-prefix .local/ci-run
node bin/moonapi-ci.mjs workflow your-spec.yaml --base http://127.0.0.1:8080 --model your-model.json --allow-write
# 仅允许受信任模块；reset(signal) 必须恢复专用测试空间并返回 true。
node bin/moonapi-ci.mjs workflow your-spec.yaml --base http://127.0.0.1:8080 --model your-model.json --allow-write --allow-reset --reset-module your-reset.mjs --shrink
```

远端另加 `--allow-remote`；回调/Links 分别授权。不要对生产业务运行写入、重置和缩减。discover 输出包含私有操作/字段名，不宜公开。

## IR v1 与模板

`StandardWorkflow.open(source, standardOptions)`、`run(base, model, options)`、`close()`。标准描述支持 JSON/YAML；模型用无损 JSON 对象：

```json
{
  "version": 1,
  "steps": [
    {
      "id": "create",
      "effects": ["created"],
      "request": {
        "operation_id": "create",
        "parameters": [],
        "negative": false,
        "media": "application/json",
        "body": { "name": "owned" }
      }
    },
    {
      "id": "read",
      "requires": ["created"],
      "request": {
        "operation_id": "read",
        "parameters": [],
        "negative": false
      },
      "bindings": [
        {
          "from": "create",
          "expression": "$response.body#/id",
          "target": "$request.path.id"
        }
      ],
      "assertions": [
        {
          "id": "persisted",
          "kind": "equal",
          "left": { "from": "read", "expression": "$response.body#/name" },
          "right": { "value": "owned" }
        }
      ]
    }
  ]
}
```

绑定只引用前序步骤；断言可引用当前/前序观察。literal 必须用 `{value:...}`，表达式用 `{from,expression}`。支持 equal/not_equal/exists/absent/count/status；`$statusCode` 按规范为字符串，须与 `"200"` 比较。`requires/effects` 是抽象状态标签，实际业务值仍须断言核验。数据/断言引用和状态前提都参与缩减保留。文件通过 `parseExact` 读取以保留 int64/十进制。

`resourceWorkflow`、`idempotencyWorkflow`、`inventoryWorkflow`、`asyncWorkflow` 根据少量已确认操作生成模型，见 workflow-demo 与测试。资源模板包含删除后缺失确认；库存模板核验“预留→取消→重复取消”后库存与基准相同。模板用于专用环境，不同于旧 owned CRUD，它不声称自动检查归属。全局副作用仍需调用者隔离；不自动猜 DELETE，不自动理解任意库存/余额规则。

`discoverDependencies(engine)` 给出显式 Links、Location 候选与响应字段/参数名关系。只有显式 Links 能通过标准 `followLinks` 授权执行；字段名唯一也不是可信业务证明。Location 须确认同源、路由、Schema 和所有权后显式绑定，不自动访问潜在 SSRF 地址；歧义候选保留提示。

## 安全重放与缩减

`run` 选项：`reset`、`allowReset=false`、`shrink=false`、`shrinkBudget=32`（0..128）、`totalTimeout=60000`（100..600000ms）。缩减必须授权 reset，每次候选前实际调用并确认 true，重新捕获真实 ID。重置模块是明确授权的本机代码，不是沙箱；须响应 AbortSignal，框架不能撤销其既有副作用。

只有稳定业务/契约缺陷参与缩减；初始复现不一致、认证/限流、传输、预算和阻塞不冒充确认缺陷。指纹包含操作、步骤、HTTP 状态、判定类型与断言 ID。删除候选的传递数据/状态消费者，最终独立重放确认；结果为局部依赖保留缩减，不证明全局最小或根因。

轮询只允许 GET/HEAD/OPTIONS，显式 `poll:{attempts,interval,pendingStatuses?}`，最多20次、间隔≤1000ms，受总期限约束；只重试成功读但业务条件未满足，或声明的 pending 状态。非幂等写、超时、断线、可能已提交但响应丢失不自动重试；重试须由调用者定义并验证幂等语义。

`execute(base,case,{deadline?,expectedStatuses?})` 返回**私有内存** `{record,context,blockers}`；context 可含 URL/数据/响应头，不可直接公开。步骤 `expect:[404,410]` 可明确表示删除后缺失等业务预期，仍必须通过对应响应契约，不能掩盖5xx、401/403/429或 Schema 错误。普通 run 摘要不含这些观察。回调接收器观察完整有界窗口；重复/乱序仍需业务幂等与版本断言，契约正确不等于业务正确；窗口外未来事件不在本次保证内。

## CI、报告与私有证据

`contractDiff(before,after,{beforeDocuments,afterDocuments})` 比较精确解析 JSON，保守选择整个 path-item；组件、安全、服务器或授权外部引用内容改变选择全部。CLI 用 `--before-references` 和 `--references` 提供两版 URI→文档映射。`documentDigest(source,documents)` 包含显式外部引用内容，改变即使历史失效。YAML/无法归一化时 CLI diff 要求全量，不冒称无影响。受影响 ID 可传给 `runSelected`；无变更由 CI 明确跳过，空选择不能当测试通过。

`--history PATH` 读取同文档 hash 的失败操作优先，下一轮独占写 `PATH.next`，不覆盖历史。它保留操作标识，属于私有资料。相同 seed 不代表不同工具生成同一序列/数量。

`--report-prefix` 输出 json/xml/html，去除操作名、URL、凭据与请求/响应体。不完整、空执行、阻塞/截断不会变成空绿色 JUnit。HTML 无脚本/外部资源。报告不默认公开上传。

`saveReplay(file,{source,documents,model,credentialEnvironment},true)` 必须另行明确授权，独占写入、Unix mode0600；Windows 应设置目录 ACL。重放含模型正文，可能敏感，必须存放忽略目录；不能保证自动识别所有秘密。只保存凭据环境变量名称，不保存令牌。`loadReplay` 校验精确文档/引用 hash；CLI replay 仍需执行权限，凭据另用 `--credential-env ENV_NAME`，不根据文件自动扩权。

Mooncakes 是四目标纯 MoonBit 核心；Node 标准层从同版本 GitHub 源码或标准运行包使用，两项分发分别验证。`full_openapi_support` 是维护的能力声明，不是第三方认证、无限资源支持或业务必然正确。合成演练、独立 PocketBase SQLite 与 Schemathesis 对照均不等于真实用户生产试点。
