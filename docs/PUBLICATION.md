# 发布与复现记录

## 2026-10-29：0.8.0-rc.1 原生现代标准源码候选

本轮授权范围仅为测试、隐私核查和GitHub源码推送；不执行 `moon publish`、不创建Release、不上传运行包。现有注册表/旧版下载不代表0.8已经公开分发。申报书、凭据、语料、意图/账本、原始报告、数据库与本机配置继续私有。

冻结功能后的完整维护退出0：404项Node回归、45核心×四目标、12组Native/JS策略对照、全部样例与1698/1946核心行覆盖通过。现代45个原始上游文件、382组1297断言和22个远端夹具固定摘要，不跳过；合成HTTP/HTTPS及mTLS不冒称真实用户。首轮CPU启动预算失败与按需加载修复在QUALITY_REPORT保留。完整对象范围、预算和歧义策略见[0.8指南](UPGRADE_0_8.md)及[现代矩阵](OPENAPI_3_1_3_2_MATRIX.md)。

实质提交为 `4f4461c`（MoonBit方法策略）、`695d64d`（精确私有帧）、`fd44166`（原生标准执行）、`921330c`（非法/有损JS输入拒绝）、`240b9f1`（multipart和可选分支修复）；指南与验证记录另作提交。功能冻结交付提交 `698741e79681c22a54bc4680ff69587948fb111e` 已推送main，远端SHA匹配，匿名README HTTP200。没有空提交或伪造历史。

上述首轮[CI40808620891](https://github.com/bzhangui/moonapi/actions/runs/40808620891)暴露Node22独立挂起流的非引用超时生命周期问题，三OS均有21项取消，未获得本轮远端通过证据。实质修复提交 `1a82ffeea6e333d4c94076ebca6a5ae96acc36f8` 增加有引用截止计时器和独立进程回归；本地Node22.23.4协议37项、Node24全套404项及四目标流程通过，保留失败历史，最终复验结果如下。

**最终已核实**：修复交付提交 `d39ec5990812fde98b8780fef1565c8ed13ccef6` 已推送main并核对远端SHA；[CI40810322099](https://github.com/bzhangui/moonapi/actions/runs/40810322099) Windows/macOS/Ubuntu全部成功。CI为Node22.23.4 / moonc0.10.18，每平台404 Node、45核心×四目标、12组策略对照、样例/覆盖/两类包复验通过；Linux独立数据库受控接入及清理通过。修复后再次对d39ec59的干净源码构建本地33项/5166项包，source_commit匹配、未签名/未发布，未沿用首轮验证包冒充新包。后续仅文档补证不改变该功能源码。

该干净提交本地旧33项包、标准5166项包均通过摘要清单、独立锁定安装、标准/现代/状态/安全/恢复演示、工作台与Schema探针重定位验证；标准包provenance的source_commit精确匹配698741e，working_tree_clean=true、signed=false、registry_published=false、public_runtime_uploaded=false。本轮只在忽略目录保存验证包，未创建Release或公开资产；源码包331项隐私门禁和82个本地文档链接核查通过。三OS复验结果已按d39ec59补证；首轮包不作为修复包证据。

## 2026-10-29：0.7.0-rc.1 续作源码，不发布注册表/运行包

用户授权本轮补齐、测试和隐私检查后推送bzhangui/moonapi main，未授权Mooncakes、Release或资产上传。新增来源锁/归属输入缩减、有界响应反馈和独立现代Schema精确求值；范围与未完成项见[0.7指南](UPGRADE_0_7.md)。私人申报书、凭据、语料、执行意图/账本、原始报告、本机配置均不公开。

本机完整维护退出0：250 Node、44核心×四目标、10组Native/JS对照、1697/1945核心行覆盖、全部示例与源码包隐私检查通过；另有25轮合成耐久。旧33项/标准5154项包已独立锁定安装及重定位验证，仅本地保存，不冒称签名或公开分发。当前注册表/Release没有本轮新能力；旧0.4正式发布记录按历史保留。

真实开发提交为 `cc62e1d`（MoonBit反馈策略）、`c07ab0b`（归属缩减/私有反馈与绑定修复）、`1040ea2`（现代Schema精确求值及固定上游向量）。交付/指南维护另作提交，不制造空开发记录。远端推送与本轮三OS CI在实际核实后补记；旧CI不替代新源码证据。

已推送冻结交付提交 `0c8c68c1acac6f3797b2251bf45ecb6be604a5b9`，匿名README HTTP200、远端SHA匹配；[CI40792676212](https://github.com/bzhangui/moonapi/actions/runs/40792676212) Windows/macOS/Ubuntu全部成功，每平台250 Node、44核心×四目标、10组策略对照、样例/覆盖/两类本地包检查通过。Linux独立SQLite后端受控验证与清理通过，仍不是外部用户试点。冻结标准包5154项、来源clean/精确提交匹配、签名false、公开上传/注册表发布均false。GitHub Release仍为v0.4.0，本轮没有创建Release或发布Mooncakes；私人文件与原始报告不上传。

## 2026-10-28：0.6.0-rc.1 源码候选，不发布注册表/运行包

用户授权测试/隐私核查后推送GitHub main，Mooncakes与运行包仅验证打包，不执行发布、创建Release或上传资产。私有申报书、凭据、执行意图、原始报告、数据库和本机配置不公开。README/指南区分本轮新增能力与尚未补齐的现代标准执行/真实环境缺口。

本机完整225 Node、43核心×四目标、9组Native/JS对照、样例及包隐私检查已通过；核心覆盖1679/1926。另有20轮合成耐久与独立PocketBase/SQLite六轮功能复验；Windows临时数据库保留、无专用进程，不冒称已清理或真实试点。旧33项包/标准5146项包及独立锁定依赖、重定位示例/工作台验证通过，均只在忽略目录；最终源提交和本轮三OS CI将在核实后单独记录。

已推送的真实功能/修复提交为 `a64d93b`（加密意图/账本）、`d5d1169`（资源探索/并发核心）、`fac52a8`（实验基础/维护交付）、`2e25a32`（运行身份绑定）、`ada3a97`（签名路径规范化）。[CI40673362956](https://github.com/bzhangui/moonapi/actions/runs/40673362956) 对精确功能源码 `ada3a97c60fad47ba752ccdd48729f3bbb4df489` 三平台全部成功；每平台225 Node、43核心×四目标、9组策略对照、全部样例与两类本地包验证，Linux另完成六轮独立数据库及清理。首轮macOS失败及修复原因在QUALITY_REPORT保留，不隐藏历史。

该冻结源码本地标准包5146项清单、provenance工作区clean/source_commit匹配，默认未签名，registry_published/public_runtime_uploaded均false。GitHub既有Release仍为v0.4.0；本轮没有执行注册表发布、建Release或上传运行包。文档补证为单独提交，不冒充新开发功能。

## 2026-10-27：0.5.0-rc.1 候选，仅授权源码推送

本轮用户授权测试/隐私核查后推送 GitHub main；明确要求 **先验证和打包，不发布 Mooncakes / 运行包**。因此不执行 `moon publish`、不建立公开 Release 或上传资产。注册表与既有 Release 保持0.4.0，新候选能力不能用旧版下载证明。

**最终功能源码验收**：`ba8882733dbfff646ad31da73ae0092fa7dfd0fa` 的 [CI 40479096709](https://github.com/bzhangui/moonapi/actions/runs/40479096709) 已核实 Windows、Ubuntu、macOS三任务全部成功。每平台200项Node、41核心×四目标、七组原生策略对照、样例、覆盖与两类运行包/工作台重定位通过；Linux六轮独立数据库、重启与哨兵、专用进程/数据清理通过。以下早期失败和修复原因保留，不隐去历史；后续文档补证不改变已测功能代码。

实现按安全执行/状态核心、低配置接入/本机操作台、原生策略/分发证据分组提交，并保留后续真实安全修补记录。`4241792`、`f13fa09`、`228f4f2`、`b364cfc`、`e68e658` 和本机验收补证 `8cfb323` 已推送公开 main。冻结功能源码后完整维护退出0：41核心×四目标、199 Node、七组原生策略对照、全部样例及1604/1842核心覆盖；不是生产证明。

首轮源码包205项、无私人资料；标准包5135项清单文件，独立锁定安装、工作台重定位及标准/状态演示通过，SBOM含41个锁定依赖组件；旧包33项及三入口冒烟通过。新包在干净源码提交上产生逐文件哈希及如实标记**未签名、未发布**的provenance，仅保留本机，不上传资产。原许可证/通知保留。

[首轮CI 40476726560](https://github.com/bzhangui/moonapi/actions/runs/40476726560) 中 Windows 完整流程通过；Linux/macOS 四目标41个核心均通过，但原生策略对照脚本假定无扩展名的产物路径，导致该步失败。已改用官方 `moon run --target native --release --frozen` 解析产物位置，本机七组重新通过；不跳过原生测试、不隐藏失败历史。[当前源码CI](https://github.com/bzhangui/moonapi/actions) 按对应提交记录维护，以实际运行结果为准，不借用0.4的绿线。

[第二轮CI 40477539988](https://github.com/bzhangui/moonapi/actions/runs/40477539988) 原生对照已通过；继续修复Linux总预算分类与macOS系统临时目录别名，保留软链接拒绝回归和全部目标检查。收尾本机完整维护200项Node及所有样例/核心测试通过。最终三平台状态查对应提交的Actions，不以Windows通过冒充跨平台全部通过；运行包与Mooncakes仍不发布。

## 2026-10-27：0.4.0 已正式发布

用户分别授权 GitHub、Mooncakes 和运行包发布。功能提交 e4c6ebf、dd06c02、b3923bb；跨平台维护95ba4c0、9cb6b0f。源码/标签 `v0.4.0` 指向 `9cb6b0f984adba0a7d20a99f41bb8cdd150331dc`，后续文档补证不改变已发布包。

正式 `moon publish --frozen` 返回 **200 OK、退出0**，不是预检202。[匿名0.4.0清单](https://mooncakes.io/api/v0/manifest/bzhangui/moonapi@0.4.0) 已确认 build_status=success、yanked=false、latest_version=0.4.0、Apache-2.0。上传ZIP共161项，实际文件与 metadata.checksum SHA256一致：`dbb193f2f8157656c78bf4e3dadb873d11e46e9311baf404450e1e0481caec3a`。

独立空目录实际从 Mooncakes 下载0.4.0，不引用仓库源码。四目标 check/release build、四类可执行消费者（含新 workflow policy）及每目标2个公开API回归全部通过。安装 `moon add bzhangui/moonapi@0.4.0`；复核 `node scripts/verify-registry.mjs 0.4.0`。注册表是计算/policy核心，不冒称四目标 HTTP 客户端。

[三平台 CI 40453488797](https://github.com/bzhangui/moonapi/actions/runs/40453488797) Windows/macOS/Ubuntu全部成功：33核心×四目标、166 Node、示例、旧运行包与独立锁定安装标准包。CI stable moonc0.10.17；Linux另外通过 PocketBase0.40.5/SQLite新旧链路六轮、哨兵/重启及临时进程与数据清理。不是外部真实用户试点。

[GitHub Release v0.4.0](https://github.com/bzhangui/moonapi/releases/tag/v0.4.0) 已公开，首选标准包（1297清单文件，含锁定依赖与原许可证）：

- `moonapi-standard-0.4.0-node.zip`，2358588字节，SHA256 `6fb6d66368bdbe1c9431b826cf8b662021d51d6ac5fd33a0ba3b5c59d95eab49`。
- `moonapi-legacy-0.4.0-node.zip`，150861字节，SHA256 `89606b52c68e66ca25523ac8cb033f0367db1853f0c4c6e9e8af4310bc87fb01`；仅旧33文件入口。
- 同发布提供 SHA256SUMS。重新从GitHub下载，两份ZIP校验和与资产digest一致；标准包实际解压后逐文件验证、健康/故障状态示例通过，无需SDK。哈希不是数字签名，Node/后端/参考工具不内置。

私人申报书与备份、凭据、SDK、合成库、原始报告、参考工具环境均不公开。前两轮CI失败及修复原因没有隐藏：先修Unix npm定位/重置超时分类，再关闭嵌套npm启动器链接，保留严格无链接交付校验；以上最新成功运行是补证依据，不用旧绿线替代。

## 2026-10-23：0.4.0-rc.2 源码维护，未发布注册表

用户授权全面测试后推送 GitHub。本轮未授权发布 Mooncakes 或运行包，因此不执行 publish、不创建 GitHub Release。标准入口的完整对象/语义范围、显式授权策略和独立证据见 OPENAPI_3_0_MATRIX、QUALITY_REPORT；0.3.0 注册表不包含新标准适配层，不能用旧包代替本轮源码。私人申报示例、凭据、SDK、报告和后端数据不推送。

已推送源码提交：`8474a2e`（MoonBit 表达式核心）、`06561b4`（完整标准协议/依赖执行/测试）、`267477e`（验收说明），并在 `bda63991720909b1e84334140e27588b912f1fab` 保留仓库换行规则和上游向量原始字节。

[源码 CI 39969433474](https://github.com/bzhangui/moonapi/actions/runs/39969433474) 已核实 Windows、macOS、Ubuntu 三任务全部成功，各自完成四目标检查/构建/测试、140 项 Node 回归、示例及便携包。Linux 的独立 PocketBase 0.40.5/SQLite 接入同时通过：两类合成集合各三轮，归属清理/哨兵保留、重启持久化及临时进程/数据移除均被实际验证，不是外部真实用户试点。后续仅补充该证据的文档提交不改变已测功能源码。

## 2026-10-22：0.3.0 已正式发布

用户新增授权发布 `bzhangui/moonapi@0.3.0`，并更新私有项目申报书；此前“暂不发布”限制仅代表上一轮状态。使用经验证的 2026-10-12 私有 SDK 与用户既有登录目录分离配置（`MOON_TOOLCHAIN_ROOT` / `MOON_HOME`），不输出或复制令牌、不升级全局 SDK。0.3.0 发布包含新的 MoonBit 状态/CRUD API；Node HTTP 适配仍需同版本源码/运行包，不将注册表核心误写为四目标网络客户端。

发布前重跑完整维护：26 核心 × 四目标、78 Node、全部计算/HTTP 样例通过，核心覆盖率 1178/1390。源码 ZIP 共 89 项，已实际打开核验，无私人申报书、凭据、SDK、数据库、后端二进制、原始报告及路径穿越项，LICENSE/NOTICE 齐全。预检服务端返回明确成功的 202（旧 CLI 对 202 返回非零，作为兼容异常保留）；正式 `moon publish --frozen` 返回 200 OK、退出码 0，不把预检当成发布。

- 版本：`bzhangui/moonapi@0.3.0`，匿名清单 `build_status=success`、`yanked=false`，latest=0.3.0。
- 发布源码提交：`d8c70cd72a45a818982fc60b5ce1b4984a419efc`。
- 实际上传 ZIP / 注册表 `metadata.checksum` SHA-256 一致：`997d3dfab3310bd5d9e63a435ce758695ee5db8dcb550cff7c70c814b626e26c`。
- 匿名清单：[0.3.0 manifest](https://mooncakes.io/api/v0/manifest/bzhangui/moonapi@0.3.0)；安装：`moon add bzhangui/moonapi@0.3.0`。
- 全新消费者实际下载 0.3.0，不引用仓库核心源码路径。JS/Wasm/Wasm-GC/Native 的 check、release build、三个计算样例、每目标 2 个公开 API 回归均通过（8 次测试执行），包括旧修复与方向 Schema/缺省操作 ID、新状态及 CRUD API。
- 可重跑 `node scripts/verify-registry.mjs 0.3.0`；脚本默认版本与 package.json 对齐，显式 0.1.1 仍只验证当时已有 API，不混称新能力。

  0.1.1 保留，不覆盖/撤回旧版。私人 `项目申报书.md` 与 AI 复审示例已更新，原稿先保存到忽略的本机备份目录；两份申报书继续忽略，不进入 Git、源码 ZIP 或运行包。发布后的本页等记录只追加 GitHub 证据，不重复覆盖不可变的 0.3.0 ZIP。真实试点、完整 OpenAPI 与 Windows 目录清理边界仍保持原披露。

## 2026-10-22：0.3.0 源码整改，本轮不发布 Mooncakes

用户已授权本轮测试与隐私检查后推送 `bzhangui/moonapi` main，明确暂不发布 Mooncakes。不会上传私人申报书、凭据、后端二进制、合成数据库、原始报告或本机工具链。源代码版本为 0.3.0；注册表已发布版本仍为 0.1.1，不能混同。

本机 26 核心 × 四目标、78 Node、原有与新 CRUD 演示和三个跨包核心样例通过，核心覆盖率 1178/1390；31 文件运行包的哈希核验与复制品功能冒烟通过。独立 PocketBase 的两类合成集合六轮通过，Windows 保留夹具模式的文件清理边界见 INTEGRATION_EVIDENCE。提交与远端 CI 将按实际完成结果记录，不引用旧 CI 代替。

功能提交 `2ee9aad2693e0a832c561ac29bbca9bc14dac13b` 已推送，匿名 README HTTP 200、远端 SHA 一致。[CI 39768768848](https://github.com/bzhangui/moonapi/actions/runs/39768768848) 的 Windows/macOS/Linux 检查、构建、测试、样例与运行包全部通过；Linux 独立 PocketBase 六轮、重启哨兵及自有数据库目录删除通过。此前本机维护提交 `5ea4467` 也一并进入公开历史。

该次 CI 提示 Node 20 Action 运行时弃用，本次另将官方 checkout/setup-node 升级至已核对的 Node 24 版本并固定完整 SHA，关闭 checkout 凭据留存和隐式包缓存；项目本身仍在 Node 22 CI 上测试。第三方 MSVC 初始化 Action 上游 v1.13.0 仍声明 Node 20，当前托管 runner 强制 Node 24 执行且测试通过，Windows 可能继续提示该依赖弃用；未把弃用提示伪装成失败或私自修改上游分发代码。后续工作流变更的状态以对应 [main CI](https://github.com/bzhangui/moonapi/actions/workflows/ci.yml) 为准。

## 2026-10-17 本地维护，尚未推送/发布

本轮在公开基线 `c124756cdb8eb6d69a3de93386bf8f97bd2d8c0b` 上修复输入错误回显、重置错误响应误判及计划选项验证，补充严格 UTF-8/实际字节上限、许可归属回归；本机 21 核心 × 四目标、62 Node、原三场景与五行为场景及运行包功能回归通过。源码版本保留 0.2.0；这些新增补丁尚未进入远端，未运行 moon publish。

公开基线的 [三平台 CI 38917495477](https://github.com/bzhangui/moonapi/actions/runs/38917495477) 是 2026-10-16 的历史证据，不代表本次补丁已获远端验证。私人申报书及修改前备份留在本机，均不进入 Git 或源码/运行包。最新本机范围见 QUALITY_REPORT；下方旧版测试数量按历史保留，不混写成新增结果。

## 0.2.0 GitHub 初审整改源码，未发布 Mooncakes

用户明确授权测试/隐私检查完成后推送 bzhangui/moonapi main，未授权发布注册表新版本。本轮新增状态模型、不变量、真实重置和序列缩减及可运行反例，源码版本 0.2.0；Mooncakes 仍为 0.1.1，不能对 0.1.1 调用新状态 API。`scripts/verify-registry.mjs` 默认核验已发布 0.1.1，可传显式版本。

本机 21 核心测试 × 四目标、55 Node 测试及新旧示例通过；最终 core 覆盖率 1003/1196。公开包排除私人申报书、凭据、描述/数据、报告、SDK 和 npm 缓存。不制造空提交或覆盖历史版本，不保证复审结论，完整规范目标仍按兼容矩阵推进。

功能提交 `643c2ff1b678673a0bc106db8298aad20ccefa07` 已推送，匿名访问 HTTP 200、远端 SHA 一致；对应 [三平台 CI 38916208757](https://github.com/bzhangui/moonapi/actions/runs/38916208757) 全部通过。随后补强断言阈值类型预检，最终提交的 CI 可从 [main 工作流](https://github.com/bzhangui/moonapi/actions/workflows/ci.yml) 核对。源码包 24 个白名单文件校验及复制品中的原示例/五行为场景实际执行通过，不依赖 MoonBit SDK、不污染交付目录。

另于本轮从独立项目重新下载已发布 0.1.1，四目标检查/构建/运行及各 1 个旧修复回归通过；这不是 0.2 新 API 的注册表证据。没有运行 moon publish，也未复制登录凭据。

## 0.1.1 修复版 — 2026-10-13

- 已实际发布 bzhangui/moonapi@0.1.1，匿名清单与 build_status=success 已确认，0.1.0未覆盖/撤回。
- 清单：https://mooncakes.io/api/v0/manifest/bzhangui/moonapi@0.1.1
- 上传源码提交：72c99718d7de88f44449a3ad92382c3bfb66e490。
- 上传ZIP SHA-256：0de6767ea11410d5cc2c998f1cdb3aab74aa14e72809d65775751f2f382b2708，与注册表一致。
- [本轮三平台CI](https://github.com/bzhangui/moonapi/actions/runs/38407005315) 的检查、构建、完整测试、演示、覆盖与运行包均通过；本机16核心/38Node，详见QUALITY_REPORT。
- 独立项目通过moon add下载安装并运行四目标样例；另用独立非主入口测试包在四目标验证关键修复行为，无主入口测试弃用警告。
- node scripts/verify-registry.mjs 按当前版本生成独立消费者，包括修复回归；不使用本仓库的核心源码作为依赖。
- 两个发布包经文件条目检查，不含申报书、登录凭据、运行数据/报告、私钥或编译器。本轮临时登录副本已移除。

修复前问题与升级兼容变化见CHANGELOG、SECURITY；推荐0.1.1，不声称所有漏洞已穷尽。下面保留0.1.0历史证据。

## 0.1.0 历史发布

2026-10-13 已实际发布，不以 dry-run 或 CI 配置代替发布完成。

- 公开源码：https://github.com/bzhangui/moonapi
- Mooncakes：https://mooncakes.io/docs/bzhangui/moonapi
- 匿名注册表清单：https://mooncakes.io/api/v0/manifest/bzhangui/moonapi@0.1.0
- 版本：bzhangui/moonapi@0.1.0；未撤回，注册表 build_status=success。
- 发布时源码提交：514e288e8631203d92cc39866c36cd58269f6aac。
- 注册表 ZIP SHA-256：117c37cf9141eb05412008f8b119aef59c7a587dc063f1a42f9bb96105994ad5；与实际本地上传 ZIP 一致。
- Windows/macOS/Linux [代码基线 CI](https://github.com/bzhangui/moonapi/actions/runs/38381331652)：检查、构建、测试、样例、覆盖与运行包均通过。

## 独立消费者验证

另建空项目，通过 moon add 下载注册表依赖，不使用本仓库核心源码路径；核心样例在 JS/Wasm/Wasm-GC/Native 检查、构建、运行均通过。

```sh
moon add bzhangui/moonapi@0.1.0
```

已有 MoonBit 项目可导入 bzhangui/moonapi/core；完整示例见 examples/core。源码目录运行 node scripts/verify-registry.mjs 可自动新建 .local 下独立项目，复核四目标。Native 需要 C 工具链；失败不会跳过。

Mooncakes 提供可复用 MoonBit 核心，不会自动安装 Node、联网适配启动命令或测试服务。完整 MoonAPI 执行环境仍按 README 从源码安装。

## 交付与隐私边界

README、许可证、NOTICE、安全说明、核心/适配源码与合成样例公开。申报示例、个人资料、凭据、真实业务数据、运行报告、临时证书、编译器和测试服务不公开。发布前核查 ZIP 条目和 Git；注册表登录凭据仅临时置于忽略的本地工具链，结束已移除。

Windows 启动器已实测选择演示再退出；单独运行包也已验证。运行包 SHA-256 清单提供完整性检查，不是签名或独立信任证明；测试报告不会附加到公开包。

注册表 0.1.0 为不可变发布快照；后续 GitHub 发布记录可以更新，不重新覆盖该版本。工程验收证据不保证赛事资格或获奖，有效开发提交由官方判断。真实外部用户、长期生产负载和未声明的协议/契约能力不在此次验证范围内。
# 0.9.0 交付说明（2026-10-29）

本轮获授权：完整测试及隐私门禁通过后推送公开main、发布Mooncakes0.9.0；不创建公开运行包Release。私人申报书、凭据、语料、执行账本和原始报告不公开。

本机统一维护已退出0：409 Node、52核心×四目标、12组策略对照、所有示例/合成耐久、核心覆盖及341项注册表清单、346文件公开树检查通过。实际推送、精确CI、包摘要和独立注册表消费将在发生后补录。以下内容保留历史版本状态，不代表本轮尚未执行的动作已完成。

