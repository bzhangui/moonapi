# 0.10 接入、生成与可靠性升级

本轮目标是减少接入工作、增强可解释覆盖与 MoonBit 复用，并验证故障行为；不以功能数量或模拟结果替代真实用户证据。用户追加授权后，GitHub推送与Mooncakes0.10.0发布须在测试、隐私及CI核查后执行；本轮不公开运行包。

## 实施与验收清单

- [x] 第一批：安全接入草案、依赖解释、覆盖缺口与固定诊断分类；统一当前版本和历史记录。
- [x] 第二批：MoonBit 精确数值候选/覆盖调度/可移植依赖 IR，接入实际执行链；业务生命周期、异步与权限控制案例。初轮四目标56个不同核心测试通过，最终结果另记。
- [x] 第二批：增加独立框架原生导出的 OpenAPI 接入，健康/注入缺陷对照、清理和复验；不宣称外部用户试点。
- [x] 第三批：故障组合、进程诊断、扩展权限、有界缓存、规模和耐久入口；最终维护结果另记。
- [x] 最终437项Node、58个不同核心×四目标、15组策略对照、示例/包审计通过；三OS CI和Mooncakes0.10.0独立消费通过。第1条主要语言审查及Windows临时库删除限制不作已解决，见ACCEPTANCE/QUALITY_REPORT。

## 不可放宽的边界

自动推断只提供草案，不授予认证、远端访问、写入、删除或重放权限。不猜测业务不变量，不在生产端点试写；不将搜索预算耗尽、跳过、阻塞、清理失败或未知写入标为成功。不承诺任意 Schema 可求解、任意业务自动理解、真实长期生产可靠性或第三方认证。

语言迁移须有实际调用和一致性测试，不通过填充代码或修改 Linguist 改变占比。0.9.0 已发布核心库与本轮候选源码、私有运行包的状态分别记录。私人申报书、凭据、语料和原始运行报告不纳入公开源码。

## 接入与覆盖解释

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-project.mjs inspect examples/standard-spec.json
node bin/moonapi-project.mjs init examples/standard-spec.json --out .moonapi-private/project.json
node bin/moonapi-workbench.mjs
```

inspect在受限工作线程校验文档、生成候选，不发送目标HTTP。返回onboarding：声明Links与局部资源形状匹配的草案、分层IR、循环/未解决节点、认证门槛、写操作审阅、有效/无效候选数及声明响应分支。declared表示来自声明，不是已验证依赖；形状匹配为review_required，不保证发现全部依赖。覆盖表execution_observed=false表示尚未执行，不是缺陷或通过。只读预设排除必需认证、参数和请求体，但只读方法不能保证业务无副作用。CLI初始化不覆盖私有文件；执行仍需显式base、凭据及分别授权write/cleanup/remote，草案不能授予权限。工作台用textContent展示草案，不执行文档中的脚本。

## MoonBit实际运行核心

跨文档Links可进入依赖草案，但文档grant不是目标执行授权。外部操作不会自动加入初始化配置或只读预设，覆盖表用outside_selected_document标出；实际执行仍须显式选择与目标授权。

core/planning.mbt的公开API在标准入口中实际调用，四目标和Native/JS对照保留：

- numeric_candidate处理精确十进制格点、整数multipleOf与开边界，宿主只提供已经检查和专门化的约束，结果仍须完整Schema再验证。576组迁移算术对照不是任意约束可解证明。
- dependency_ir返回版本1元数据依赖图，验证身份、去重、分层，保留循环。它不是已有Workflow IR v1/v2的替代，不自动建模业务或执行操作。
- coverage_schedule先公平分配首轮，再依据既往观察次数选择；确定种子、预算截断不算完整。StandardEngine.open(source,{priorCoverage:{operationId:count}})仅接受已知操作及0..1000000整数；原型成员不能成为观察值。operation_coverage区分生成/选择/观察/阻断，不冒称业务覆盖率。

现代Schema实例求值仍由MoonBit任务机负责；通用对象候选、文档、引用授权、ECMA正则、媒体/HTTP等仍有Node实现。不得称全部生成器已迁移或主要语言风险已消除。语言审计脚本、许可证和源码范围不变。

## 业务补偿与独立后端

compensationWorkflow需显式映射balance/reserve/pay/refund/read/remove，构建预留→支付→退款→重复退款→余额/库存守恒断言。随机归属标记有v2输入来源锁，cleanup先GET验证归属；不因模板存在就授权删除。清理适配必须能够安全补偿部分序列，否则不能启用自动缩减。清理未确认仍阻断并保留原始缺陷分类，不扩大删除范围。

```sh
python -m venv .local/interop-fastapi-venv
# Windows；Unix将 Scripts/python.exe 换为 bin/python
.local/interop-fastapi-venv/Scripts/python.exe -m pip install -r examples/fastapi/requirements.txt
node scripts/interop-fastapi.mjs --python .local/interop-fastapi-venv/Scripts/python.exe
```

FastAPI0.162.0/Pydantic2.14.2/Uvicorn0.54.0在独立Python进程及随机回环端口运行，schema由框架原生导出，不是MoonAPI手写替代契约。11个健康/故障组合覆盖报价契约、余额/库存守恒、重复退款、归属清理和缩减、跨租户404及异步永不完成。Python精确版本环境独立，不进入Node运行依赖/运行包；安装仍取决于包源与平台wheel，不是全平台可复现构建认证。已有PocketBase/SQLite接入保留；两个独立技术栈仍不是外部用户试点。生命周期资源明确验证清理，其余合成内存状态在精确停止专用子进程后消失，不称全部资源都由API删除。

可选Schemathesis4.32.5对照使用同一合成契约/目标/种子73、2秒单请求、10秒执行和32请求硬上限。输入、实际请求数及启动成本不等，不作速度排名或优越性声明；四个受控模式不是全部业务或工具覆盖比较。

## 稳定性、规模与扩展

ProjectInspector是本机会话独占的元数据缓存：默认8条/1MiB/30秒，最多2个不同文档编译，同文档共享编译。完整原文及全部允许选项进入摘要身份，选项快照防止检查期间变化。只保留草案/计数，不缓存原文、目标、凭据、响应语料、执行授权或失败；TTL/LRU/clear有门禁，clear后迟到结果不能重新填充。不是通过缓存跳过执行校验。

scopedCredentials在调用凭据provider前校验文档摘要、环境摘要、操作与角色白名单；未知版本、超时和权限不足拒绝。取消阻止尚未调用的适配器；已经发生的副作用无法撤销。它是受信任JS扩展的最小权限调用约束，不是OS沙箱。HTTP/TLS/codec/isolation沿用既有受控契约，不自动下载任意插件。

```sh
node scripts/scale.mjs --operations 200
node --expose-gc scripts/soak.mjs --rounds 100
npm run validate
```

规模入口支持1..256操作，记录原文大小、未缓存/缓存耗时、RSS、候选覆盖和HTTP发送数。耐久入口支持1..1000轮，每轮要求已确认归属清理且无未知写入，限制堆/RSS，并精确移除本轮临时合成账本；真实恢复数据不得按此策略删除。二者都不是长期生产、多主机或任意规模承诺。

维护子进程失败会在.local/process-failures保存最多32份/256KiB固定字段回执，含退出码/十六进制码、Node/平台/耗时，不含argv/环境/输出/凭据。满额不删除旧证据，原命令仍失败且不自动重试。历史0xC0000409根因未知，不宣称根治；不默认收集可能含秘密的进程转储。

现代契约差异可枚举QUERY与扩展方法，但动态资源/词汇尚不作精细增量裁剪：变化后保守要求全套，标为modern_dependency_analysis=conservative-full-suite-on-change，避免漏测；3.0保留引用闭包分析。它只是选择建议，不跳过执行器的完整编译。

## 安装、升级、回退和公开边界

源码需Node>=22.19.0、moonc>=0.10.16，使用npm锁并拒绝依赖安装脚本。validate新增release-state门禁，核对package/package-lock/moon.mod/README/工作台当前状态。三平台继续检查/构建/测试/示例/覆盖/包审计；Linux另做规模、20轮耐久、FastAPI和PocketBase，不用本机结果冒充远端CI。

升级在独立目录安装，保留既有私有配置/见证/账本，先跑合成样例和只读检查，再授权写入。回退使用上一已验证目录，保留新数据供诊断；不擅自降级IR、意图或账本，不把0.9.0旧核心重命名成具备新API。不自动全局安装、覆盖或公开分发。

标准运行包仍白名单复制、独立锁定安装、逐文件摘要/SBOM/来源及重定位冒烟；不含Python环境、后端二进制、私人申报书、凭据或报告，运行包仅本地打包。Mooncakes核心库发布与下载后的独立消费结果另见PUBLICATION。正式可信签名、真实用户、长期生产和多主机证据仍需环境与授权。
