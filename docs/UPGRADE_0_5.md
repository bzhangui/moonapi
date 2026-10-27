# 0.5 候选版：安全执行、低成本接入与可扩展核心

源码版本 `0.5.0-rc.1`。本轮只验证、打包和推送源码，**不发布 Mooncakes 或上传运行包**；已发布的 0.4.0 不代表这些 API 已分发。Apache-2.0 与历史入口保留。

## 第一批：每一次副作用都有可核查结果

- 标准契约运行和标准 Workflow 共用执行账本。`prepared → dispatching → sent → responded → completed/failed`；丢失响应或崩溃保守归为 `unknown`。HTTP 请求结束写入不等于服务端提交。账本先落盘、逐条 fsync；不自动重放未知写入。
- `ExecutionLedger.open({directory})` 可开启专用私有 JSONL；不指定目录只在内存。内容只含每次尝试的状态、方法、状态码、相对单调时间及每轮随机别名，不含 URL、请求/响应正文或凭据。`recoverLedger(file)` 只读恢复，校验序列、转换和哈希链；末尾半条记录不算成功，链不是签名。
- 账本默认最多8 MiB；可用 `maxBytes` 在1 KiB–8 MiB内调低。达到预算会停止，不生成超出恢复器预算的文件，不覆盖或抛弃已有持久记录。
- 未知写入的停止规则贯穿契约、Workflow 缩减和多种子 campaign：不继续后续变更/重置/候选或种子，也不确认见证。已知 ID 的只读所有权探测可以保留，但自动 DELETE 同样停止，清理未确认需人工核实。不能以切换种子或候选名义绕过不重试原则。
- 标准 `ownedResourceWorkflow({create,read,update,remove,field})` 自动生成每轮随机标记。变更前 GET 核验标记；清理只能使用捕获的实际 ID，DELETE 后再 GET 确认缺席。外来标记、202 未完成删除、未知 ID 均不报清理成功。它不隔离邮件、扣款、库存等全局副作用，优先用于测试环境。
- `IsolationLease` v1 为受信任接入方提供 acquire/verify/release 钩子，每次执行/重置检查租约，失效停止；不是跨主机锁实现或沙箱。适配方必须在服务端真正实施隔离并尊重 AbortSignal。SDK 无法撤销不合作钩子已经产生的副作用。
- 总预算、回调等待和租约使用单调时钟。回调契约错误与回调等待超时分开；后者为不确定结果。401/403 只有显式 `authorizationProbe:true` 才能作为预期结果，429/5xx 不因此变绿。
- 缩减导出只接受独立重放确认后的见证，使用调用方 32 字节密钥的 AES-256-GCM，固定文档/模型哈希、版本、种子、指纹与 IR 版本。文件原子、不可覆盖提交，密钥不落盘；旧 `saveReplay` 是显式私有明文格式，不等同于加密见证。

```js
import { StandardWorkflow } from "../platform/workflow.mjs";
import { ownedResourceWorkflow } from "../platform/workflow-templates.mjs";
const engine = await StandardWorkflow.open(source, { allowWrite: true });
try {
  const report = await engine.run(
    base,
    ownedResourceWorkflow({
      create: "create",
      read: "read",
      update: "update",
      remove: "delete",
    }),
    { allowCleanup: true, journalDirectory: ".local/ledgers" },
  );
  // report.execution.unknown_writes > 0 时不要直接重跑；先只读核实接收端。
} finally {
  await engine.close();
}
```

Windows 的 POSIX mode 不等同于 ACL；请把私有目录放在当前账户独占的磁盘位置。硬链接不受文件系统支持时保存失败，不降级为可能覆盖目标的写法；不能防御同一用户的恶意并发磁盘改动。

macOS 仅规范化经核验的系统 `/var → /private/var`、`/tmp → /private/tmp` 根属主别名；用户路径内的其他软链接仍拒绝。总预算分类直接依据共享单调截止信号，避免平台定时精度差异把预算耗尽误记为传输问题。文档在工作台检查期间被编辑时，旧计划不再取得执行许可。

## 第二批：少配置接入和受控探索

```sh
node examples/safe-workflow-demo.mjs
node bin/moonapi-project.mjs init examples/standard-spec.json --out .local/project.json
node bin/moonapi-project.mjs run .local/project.json --base http://127.0.0.1:8080 --journal .local/ledgers
node bin/moonapi-project.mjs recover .local/ledgers/RUN_ID.jsonl
node bin/moonapi-workbench.mjs --demo --allow-write
```

用终端打印的**完整会话链接**打开工作台（默认端口 8791）。仅监听 127.0.0.1，临时令牌在 URL fragment 交给页面后从地址栏清除；不共享此链接。刷新后需重新打开原链接。关闭服务撤销会话。启动后需要再次勾选本次写入和清理权限，界面不能提升启动权限。远端需启动参数 `--origin https://your-authorized-host`；仅该 origin 可用。界面不能加载任意 JS、全局重置或自动缩减。演示明确标记合成数据，不作生产证明。

默认会话不持久保存文档。可选 `--profiles .local/profiles --key-env YOUR_KEY_ENV`，其中环境变量是自行保管的 64 位十六进制密钥；不要把它贴到聊天或提交仓库。最多十份不可覆盖加密快照；没有密钥不启用保存。凭据只通过 CLI 配置的角色环境变量/受信任 provider 注入，不从浏览器任意读取机器环境。浏览器和进程内存不是硬件安全区。

有认证的工作台可以在启动时加 `--roles .local/roles.json`，该私有文件只写例如 `{"default":"MOONAPI_DEFAULT_CREDENTIALS","owner":"MOONAPI_OWNER_CREDENTIALS"}` 的环境变量名称映射；变量内的实际 JSON 凭据格式按 STANDARD_ENGINE 指南。role 至多32个，名称至多64字符。浏览器无法任意指定读取别的机器环境变量。

- 项目配置默认选择没有必需参数的只读操作，避免把猜测的不存在资源 ID 当作业务回归；需要 ID 的流程请显式绑定真实返回值。`--base` 必须显式提供，配置不能授予远端、写入、清理或重置权限。配置文件含业务模型/路径，保存在 `.local`，不要公开。
- `environmentCredentials({owner:'OWNER_ENV', viewer:'VIEWER_ENV'})` 每请求读取角色凭据；也可提供 `{version:1,resolve({role,operation_id,signal})}` 实现自己的会话刷新。失败不自动重试写入，不把 OAuth 获取流程冒称已实现。
- Workflow v2 的 `initial_state/requires_state/set_state` 表达资源状态；`planResourceGraph` 与 `runGraphCampaign` 提供固定种子、公平有界转移探索。每个 transition 的 `max_visits` 为 1–8；多轮 campaign 必须明确提供可确认重置。转移覆盖不等于所有路径/业务状态覆盖。
- 断言新增 gt/gte/lt/lte/sum/unique。精确数值比较与守恒加总使用 MoonBit BigInt，不把 int64/长小数转换成双精度近似。sum/unique 有256元素及256 KiB输入预算，超限记预算耗尽，不冒充被测接口缺陷；unique 使用与对象键顺序无关的精确深比较。数值系数上限4096位、指数绝对值10000。
- `concurrentRegisterProbe` 在显式授权的共享整数 register/CAS 参考模型上并发执行最多八次操作，用 MoonBit 有界线性化搜索判断实际历史。它不是任意接口的线性一致性证明。未知请求/契约/权限先检查，失败不自动补偿。
- 输入缩减仅处理 `shrink_inputs` 显式指定的外生 body/query 字段；不修改断言、返回 ID 绑定或所有权标记。需独立重置许可与最终重放；有 owned cleanup 时禁用输入缩减以保护标记。结果仅是依赖保留的局部缩减，不宣称全局最小。
- CI 差异支持无损 JSON/YAML 和本地 `$ref` 传递影响；全局策略变更、新组件命名空间、外部文档改变或不确定引用仍选择全套，避免漏测。差异选择只是优化，不替代定期完整回归。

## 第三批：稳定扩展与可信分发

- transport v1 为 `{version:1,id,send(url,request)}`，默认 Node HTTP；受信任扩展也必须遵守 AbortSignal。适配返回有状态码、头/正文预算检查；目标权限仍在主引擎判断。不是让不可信插件获得沙箱内安全。
- `core/` 与 `app/dispatch` 可跨 JS/Wasm/Wasm-GC/Native 编译。`cmd/policy` 为无 Node 的一次性纯策略 CLI；HTTP/完整标准适配仍需要 Node。维护脚本强制比较 JS/Native 策略向量，不把原生策略误称原生 HTTP SDK。命令行仅用于不含机密的策略输入，避免进程参数泄露。
- `moonapi-dialect.mjs` 使用独立 Redocly 结构检查器区分 3.0/3.1/3.2；只使用显式文档映射，不自动取文件/网络。**3.1/3.2 运行仍禁用，未宣称完整兼容或认证**。后续按现代 JSON Schema、webhooks、新媒体/HTTP 特性逐项验证后才开放执行；绝不把版本号改成 3.0 以绕过验证。
- 标准本地运行包含新入口、固定依赖、完整许可证、CycloneDX SBOM、源提交/锁文件摘要、逐文件哈希与重定位冒烟验证。provenance 如实标记未签名及工作区状态，不称为签名证明、可复现构建认证或公开发布。
- PocketBase 0.40.5 / SQLite 六轮独立后端接入增加标准 owned 清理链与账本核对，保留既存哨兵并重启核验。仍是隔离合成资料，不是真实客户、跨主机或长期生产压测。

## 验证与剩余证据边界

运行 `npm run validate`（严格检查/构建/四目标核心测试、Native 策略对照、Node 全套、示例、覆盖与发布隐私审计），再运行 `node scripts/package-standard.mjs`、`node scripts/package.mjs`。CI 在三操作系统执行。实际本轮结果见 `QUALITY_REPORT.md`，不能把拟执行项目当成已通过。

仍需真实授权环境才能验证：外部用户接入成本与效果、身份提供方实际会话生命周期、隔离适配在跨主机条件下的保证、持久压力与生产恢复。受控模拟可验证具体错误分支，不能替代这些证据。本轮不声称涵盖所有极端情况。
