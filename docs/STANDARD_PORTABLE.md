# MoonAPI 标准运行包

本包包含预编译 MoonBit JS 核心、标准/状态/CI 入口、锁定安装的 Node 依赖及其原许可。需要 Node.js ≥22.19.0，不需要 MoonBit SDK；Node、Python、Schemathesis、PocketBase 不在包内。

```sh
node bin/moonapi-standard.mjs check examples/standard-spec.json
node examples/standard-demo.mjs
node examples/standard-advanced-demo.mjs
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
```

API、写入/远端/重置许可、私有重放与报告见 docs/STANDARD_ENGINE.md 和 docs/WORKFLOW.md。默认不运行生产写测试。示例仅处理临时合成数据，不是外部用户验证。

manifest.json 逐文件 SHA-256 可用于损坏检查，不是数字签名；下载应从项目的对应 GitHub Release，并对照该发布的 SHA256SUMS。Mooncakes 安装的是纯 MoonBit 核心，不包含此 Node 网络运行层。旧便携运行包仍保留，但不冒称具有标准入口能力。
