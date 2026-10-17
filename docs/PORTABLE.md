# MoonAPI 本地运行包

需要 Node.js ≥22，不要求 MoonBit。Windows 双击开始使用.cmd，或运行 node bin/moonapi.mjs help / node examples/demo.mjs。

0.2 运行包另可执行 `node examples/behavior-demo.mjs` 运行健康/缺陷五场景，或 `node bin/moonapi-behavior.mjs help`。需自有可重置环境并分别授权重置、写入和重复写；详情见 docs/BEHAVIOR_ENGINE.md。完整 OpenAPI 支持未完成，源码运行包不等于注册表新版本已经发布。

打包时先校验白名单与 SHA-256，再在私有临时复制品执行两个 CLI 的实际 plan、原三场景和五行为场景；不只测试 help，也不依赖源码工具链。描述/模型需有效 UTF-8（可带 BOM），重置 4xx/202 不作为成功。原交付目录不保存演示报告。

只对白名单文件打包，无个人资料、申报书、令牌、报告、测试证书、备份/消息数据、Git 或编译器。NATS 程序和 Node 不内置。SHA-256 是完整性检查，不是签名。

不要用演示程序对生产环境做故障注入。操作与交付边界见 docs/OPERATIONS.md、SECURITY.md。源码和安装更新见 https://github.com/bzhangui/moonapi 。

