# MoonAPI 标准运行包

0.8.0-rc.1为源码候选，本轮暂不上传公开Release/注册表。标准源码已接入原生OpenAPI3.1/3.2，核对基线为3.1.2/3.2.1，不降级为3.0；现代能力声明为 `implementation_status=native-standard`、`full_openapi_support=true`，不是第三方认证、单次测试通过或穷尽业务保证。见 [在线0.8指南](https://github.com/bzhangui/moonapi/blob/main/docs/UPGRADE_0_8.md)、[现代覆盖矩阵](https://github.com/bzhangui/moonapi/blob/main/docs/OPENAPI_3_1_3_2_MATRIX.md)，离线包内保留对应 `docs/` 文件。旧0.7运行包不能代表本轮新API已分发。

本包包含预编译 MoonBit JS 核心、标准/状态/CI 入口、锁定安装的 Node 依赖及其原许可。需要 Node.js ≥22.19.0，不需要 MoonBit SDK；Node、Python、Schemathesis、PocketBase 不在包内。

```sh
node bin/moonapi-standard.mjs check examples/standard-spec.json
node examples/standard-demo.mjs
node examples/standard-advanced-demo.mjs
node examples/modern-demo.mjs
node examples/workflow-demo.mjs
node bin/moonapi-ci.mjs discover examples/standard-spec.json
node examples/safe-workflow-demo.mjs
node examples/recovery-demo.mjs
node examples/owned-reduction-demo.mjs
node examples/feedback-demo.mjs
node bin/moonapi-workbench.mjs --demo --allow-write
```

API、写入/远端/重置许可、私有重放与报告见 docs/STANDARD_ENGINE.md 和 docs/WORKFLOW.md。默认不运行生产写测试。示例仅处理临时合成数据，不是外部用户验证。

本轮候选包（0.8.0-rc.1）只用于本地打包/重定位验证，不发布。工作台/低配置项目/加密账本与扩展 API 见 docs/UPGRADE_0_5.md 至 docs/UPGRADE_0_8.md；版本策略见 docs/VERSION_POLICY.md。sbom.cdx.json 列出锁定依赖；provenance.json 标明提交、工作区状态与锁摘要，默认未签名。原生现代执行、受控样例、完整维护和跨平台CI的结果分开记录，不能用一个局部绿灯替代全部门禁。

`modern-demo`使用临时回环HTTP服务和合成值，分别检查3.1.2精确JSON与3.2.1 QUERY/NDJSON健康及故障对照。默认GET/HEAD/OPTIONS/QUERY只读；额外方法token区分大小写并默认需要写许可。顺序流须真实EOF且逐项/整体校验完成；取消、截断、超时和预算限制均不报告完整通过。真实TLS/mTLS端到端回归使用临时内存证书，不包含在生产可复用凭据中。

manifest.json 逐文件 SHA-256 可用于损坏检查，不是数字签名；下载应从项目的对应 GitHub Release，并对照该发布的 SHA256SUMS。Mooncakes 安装的是纯 MoonBit 核心，不包含此 Node 网络运行层。旧便携运行包仍保留，但不冒称具有标准入口能力。
