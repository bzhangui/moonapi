# 新标准适配入口说明

当前便携包只提供原有契约、状态和 CRUD 三个入口；不包含 `moonapi-standard.mjs` 或 npm 标准依赖，不能代表完整新版功能。使用新标准层应获取同版本 GitHub 源码，先 `npm ci --ignore-scripts`、`npm run build`，参考 [标准入口](STANDARD_ENGINE.md)。不可把本包的旧解析档误认为完整 OpenAPI 支持。

# MoonAPI 本地运行包

需要 Node.js ≥22，不要求 MoonBit。Windows 双击开始使用.cmd，或运行 node bin/moonapi.mjs help / node examples/demo.mjs。

0.2 运行包另可执行 `node examples/behavior-demo.mjs` 运行健康/缺陷五场景，或 `node bin/moonapi-behavior.mjs help`。需自有可重置环境并分别授权重置、写入和重复写；详情见 docs/BEHAVIOR_ENGINE.md。完整 OpenAPI 支持未完成，源码运行包不等于注册表新版本已经发布。

打包时先校验白名单与 SHA-256，再在私有临时复制品执行两个 CLI 的实际 plan、原三场景和五行为场景；不只测试 help，也不依赖源码工具链。描述/模型需有效 UTF-8（可带 BOM），重置 4xx/202 不作为成功。原交付目录不保存演示报告。

只对白名单文件打包，无个人资料、申报书、令牌、报告、测试证书、备份/消息数据、Git 或编译器。NATS 程序和 Node 不内置。SHA-256 是完整性检查，不是签名。

不要用演示程序对生产环境做故障注入。操作与交付边界见 docs/OPERATIONS.md、SECURITY.md。源码和安装更新见 https://github.com/bzhangui/moonapi 。

## 0.3 免手写模型入口

本运行包同时提供 `node examples/crud-demo.mjs` 和 `node bin/moonapi-crud.mjs plan examples/spec.json --collection /items --field name`。实际接口运行须按 `docs/OWNED_CRUD.md` 另行授权写入、清理与重复写，且只用于可控测试环境。运行包不包含 PocketBase 二进制或独立后端测试脚本，不需要 MoonBit SDK 重新编译。
