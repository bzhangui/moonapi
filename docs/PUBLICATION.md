# 发布与复现记录

## 2026-10-23：0.4.0-rc.2 源码维护，未发布注册表

用户授权全面测试后推送 GitHub。本轮未授权发布 Mooncakes 或运行包，因此不执行 publish、不创建 GitHub Release。标准入口的完整对象/语义范围、显式授权策略和独立证据见 OPENAPI_3_0_MATRIX、QUALITY_REPORT；0.3.0 注册表不包含新标准适配层，不能用旧包代替本轮源码。私人申报示例、凭据、SDK、报告和后端数据不推送。

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
