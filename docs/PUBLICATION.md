# 发布与复现记录

## 0.2.0 GitHub 初审整改源码，未发布 Mooncakes

用户明确授权测试/隐私检查完成后推送 bzhangui/moonapi main，未授权发布注册表新版本。本轮新增状态模型、不变量、真实重置和序列缩减及可运行反例，源码版本 0.2.0；Mooncakes 仍为 0.1.1，不能对 0.1.1 调用新状态 API。`scripts/verify-registry.mjs` 默认核验已发布 0.1.1，可传显式版本。

本机 21 核心测试 × 四目标、55 Node 测试及新旧示例通过；core 覆盖率 990/1182。公开包排除私人申报书、凭据、描述/数据、报告、SDK 和 npm 缓存。源码提交/远端 CI 在推送核验后补充，不制造空提交或覆盖历史版本。不保证复审结论，完整规范目标仍按兼容矩阵推进。

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

