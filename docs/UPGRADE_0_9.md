# 0.9：现代 Schema 实例核心迁移与验收边界

## 实质变化

生产调用链为 `modern-exact.mjs → __moonapi_modern → app/modern.mbt → core/modern_semantics.mbt`，不再在 JavaScript 递归求值实例。MoonBit 计算 boolean/type、精确 const/enum/unique、数字上下界/multipleOf、Unicode 长度、组合/条件、对象依赖、prefix/items/contains，以及成功分支的 `unevaluated*` 注解集合。静态专门化后的引用仍与兄弟约束共同求值；同一实例无进展循环拒绝。既有3.0及原生3.1.2/3.2.1能力不因迁移降级。

宿主负责规范文档与元数据、显式 URI grant/动态资源专门化、ECMA 正则/已知 format 叶子、媒体与网络。生成器、标准文档和业务执行适配仍有较多 Node 逻辑；这轮不是它们的全量移植。

## 使用

```sh
npm ci --ignore-scripts
npm run build
node examples/modern-demo.mjs
moon run examples/core --target native
npm run validate
node scripts/language-audit.mjs
```

私有 SDK 通过 `MOON_BIN` 和 `MOON_HOME` 选择；构建/维护入口拒绝未知版本或低于0.10.16。已验证的私有 SDK 是moonc0.10.18，不代表测试了每个历史编译器。

首次执行正常构建同步依赖；已安装并验证依赖后，可用 `node scripts/build.mjs --frozen` 显式离线/冻结构建。便携包使用此模式，不为打包再次联网刷新注册表索引；不会跳过编译/版本/缺失依赖检查，也不忽略同步失败。标准Node包的独立npm锁定安装仍需相应网络或缓存。

公共 `core.modern_validate` 接受**已校验语法、完成 URI 授权及专门化**的 Schema/文档图、精确 Json、独立二进制路径映射及显式正则/格式回调；不是任意原始 OpenAPI 的单函数解析器。`@json.parse(..., preserve_number_repr=true)` 保留 int64/十进制词法；不能在先舍入为 Double 后恢复精度。回调只回答叶子谓词，不能替代整个 Schema 求值。无相关关键字时可以传入遇调用即报错的回调，示例见 `examples/core/main.mbt`。

二进制由适配器从真实 Buffer/Uint8Array 建立路径到十六进制映射，在 Json 中使用占位；普通业务对象、`__proto__`、转义键不能被识别为类型标签。精确整数格式范围也由 MoonBit 求值，不委托给 Double。

## 拒绝预算与证据

实例最多50,000节点/64层，核心递归最多256层/200,000次求值；桥接 UTF-8/文本总包8MiB，解析深度128。单个二进制和数字沿用适配层预算。超限、无进展循环或输入错误明确拒绝，不转为通过或使用旧 JS 求值器回退。预算不是性能/容量认证。

冻结旧 JS 实现仅供 `tests/reference` 差分；固定上游45文件/382组/1297断言的原始字节摘要门禁保留，迁移后逐条与旧实现及上游预期比较。四目标核心与实际 HTTP/媒体/流/状态全流程结果以 [维护记录](QUALITY_REPORT.md) 为准；没有声称穷尽任意 Schema/业务空间或第三方认证。

## “主要实现语言”仍需关注

`scripts/language-audit.mjs` 同时公开所有可跟踪源码和运行目录（core/app/cmd/platform/bin/ui，排除 MoonBit 测试）的字节数；包含注释，非官方 Linguist 算法。JavaScript 仍明显更多，核心迁移不等于该验收项已经无争议满足。后续应继续迁移生成/约束候选、文档到可移植IR及领域执行决策；不通过补注释、复制代码、修改语言标记或隐藏 Node 源码改变统计。

Apache-2.0、NOTICE、第三方与上游向量许可保留。私人申报书、凭据、语料、原始报告不公开。核心库发布与 Node/桌面运行包独立；本轮未授权公开运行包。
