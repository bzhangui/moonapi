# 无手写状态机的 CRUD 接入

0.3.0 源码新增 `OwnedCrudEngine`；注册表 0.1.1 **没有此 API**。适用于同步 REST 资源的持久化回归，不是任意业务的自动建模器。

```sh
npm run build
node examples/crud-demo.mjs
node bin/moonapi-crud.mjs plan examples/spec.json --collection /items --field name
# 只对已授权的测试环境执行；本命令会创建、修改和删除合成资源。
node bin/moonapi-crud.mjs run your-spec.json --base http://127.0.0.1:8080 --collection /items --field name --allow-write --allow-cleanup --shrink-write
```

用户只需选择集合路径和一个可修改的字符串字段，不写 `initial/requires/set`，不提供清空数据库的 reset 接口。MoonBit 识别同一资源的 POST、GET、唯一 PUT 或 PATCH、DELETE，生成创建→读初值→更新→读回→删除→读缺失六步与业务断言，再使用现有依赖保持缩减器。操作名不必叫 create/read；缺少 operationId 时使用稳定的 `METHOD /path`。

## 接口形状与选择条件

- 集合路径不含变量，资源路径为 `集合/{参数}`；只有一个 path 参数，没有额外 query 参数。响应直接返回对象，含 `id` 以及所选字段；ID 为 integer，或 1–128 位字母/数字/下划线/连字符 string（含 UUID、PocketBase ID）；其他 ID 拒绝归属，不猜测清理。
- 同步创建明确声明 201 或 200，读取/更新 200，读取缺失 404，删除 200 或 204。202、异步最终一致性、响应外层包装、嵌套资源及多个更新操作仍需显式模型；歧义在请求前拒绝，不猜测执行。
- ID 必须由服务器在新建时产生；创建/更新请求体仍有可写 `id` 属性时拒绝自动档，避免生成固定 ID 导致意外 upsert。readOnly ID 经请求投影移除后可用。调用者仍须确认 POST 真的是新建而非按其它字段覆盖既有数据；客户端无法证明任意服务器实现守约。
- 请求体由 schema 生成，再设置两种不同的随机归属标记（32 字符）。字段必须在创建、更新请求及相应响应中声明为 string 并允许标记取值；短字段、枚举、只读字段或其它业务格式不匹配时拒绝。需要固定业务值的接口可继续使用高级行为模型。
- readOnly/writeOnly 的属性生成和 required 按请求/响应方向投影。通用 OpenAPI 适配仍不完整：组合、pattern/format、header/cookie、安全需求、Links/Callbacks 等仍未实现，不能称为全标准支持。

## 写入归属与隔离边界

每次执行使用随机标记；只登记创建响应中的 ID。更新、删除以及清理前，先 GET 核验 ID 与已知标记；不匹配则停止写入。重放前只清理本次登记的资源，不清空集合、不重置计数器、不修改既有资源。本机样例保留一条预置哨兵记录进行对照。

这不是服务器事务或抗恶意服务器的权限系统：GET 核验与写入之间仍存在竞态，重复利用的 ID、并发外部写入、触发器、副作用、全局库存/余额不保证隔离。只能用于可控且获授权的测试环境，不能因此对生产环境做无人值守写测试。复杂业务不变量仍使用 [显式模型与隔离重置](BEHAVIOR_ENGINE.md)。

创建已提交但响应丢失/未获得可验证归属时，不猜 ID、不扫描删除、不重试 POST；报告 `unclaimed_write_possible=true`、`cleanup_verified=false`。需由测试环境所有者核对遗留数据。进程被强制杀死同样不保证清理，因此普通环境也应有独立的测试数据到期回收策略。

清理失败不抹掉原失败，也不报告全通过；缩减确认需要每次清理成功，最后独立重放相同失败指纹。报告默认省略 ID、标记、请求/响应体、URL 和凭据。`--save-repro` 包含测试输入，只保存在私有报告目录。默认报告只保留未清理数量，不提供可直接删除的猜测清单。

## 许可、预算与退出码

`--allow-write`、`--allow-cleanup`、`--shrink-write` 分别授权初次写入、归属清理和重复写缩减；远程目标另需 `--allow-remote`。省略写/清理许可时请求前拒绝。Bearer 只读 `MOONAPI_BEARER_TOKEN`，不放在命令行中。

`--timeout` 10–30000 ms，`--total-timeout` 100–600000 ms，`--shrink-budget` 0–128。额外归属 GET 计入 `http_requests`；最终清理有最多 `3 × timeout` 的独立宽限期，不能因测试预算到期而直接跳过清理。清理仍受网络超时限制，不无限重试。并发使用同一个 runner 会拒绝。

0 表示本次选定六步与清理都完成，1 表示发现失败/未完整执行/清理未确认，2 表示配置或运行错误。任何通过结果都不代表全部业务路径正确。

独立 PocketBase/SQLite 适配验证见 [接入证据](INTEGRATION_EVIDENCE.md)；与现有工具的定位对照见 [对照说明](COMPARISON.md)。
