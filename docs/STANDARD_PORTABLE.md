# MoonAPI 标准运行包

0.6.0-rc.1为本地验证候选，未上传公开Release/注册表。新增安全功能与未完成项见 [在线0.6指南](https://github.com/bzhangui/moonapi/blob/main/docs/UPGRADE_0_6.md)；离线包内为 `docs/UPGRADE_0_6.md`。主引擎仍仅执行3.0，现代Schema/流式原语不代表完整3.1/3.2支持。

本包包含预编译 MoonBit JS 核心、标准/状态/CI 入口、锁定安装的 Node 依赖及其原许可。需要 Node.js ≥22.19.0，不需要 MoonBit SDK；Node、Python、Schemathesis、PocketBase 不在包内。

```sh
node bin/moonapi-standard.mjs check examples/standard-spec.json
node examples/standard-demo.mjs
node examples/standard-advanced-demo.mjs
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
node examples/safe-workflow-demo.mjs
node examples/recovery-demo.mjs
node bin/moonapi-workbench.mjs --demo --allow-write
```

API、写入/远端/重置许可、私有重放与报告见 docs/STANDARD_ENGINE.md 和 docs/WORKFLOW.md。默认不运行生产写测试。示例仅处理临时合成数据，不是外部用户验证。

本轮候选包（0.5.0-rc.1）仅保留本地，未上传公开 Release、未发布 Mooncakes。新增工作台/低配置项目/加密账本与扩展 API 见 docs/UPGRADE_0_5.md；版本策略见 docs/VERSION_POLICY.md。sbom.cdx.json 列出锁定依赖；provenance.json 标明提交、工作区状态与锁摘要，均未签名。现代 OpenAPI 方言只提供结构检查，不启用未验证的 3.1/3.2 执行。

manifest.json 逐文件 SHA-256 可用于损坏检查，不是数字签名；下载应从项目的对应 GitHub Release，并对照该发布的 SHA256SUMS。Mooncakes 安装的是纯 MoonBit 核心，不包含此 Node 网络运行层。旧便携运行包仍保留，但不冒称具有标准入口能力。
