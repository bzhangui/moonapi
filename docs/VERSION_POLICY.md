# 版本与能力门禁

1. GitHub 源码、Mooncakes 纯计算核心、Node 标准运行包分别记录版本和交付状态。源码变更不自动触发包发布，三项公开操作独立授权。0.8.0-rc.1 本轮仅候选源码/本地验证包，不更改注册表、Release 或公开运行包。
2. Workflow IR v1 保持兼容；v2新增资源状态图，0.7另增可选input_protection和feedback_inputs，旧v1模板不自动升级；不识别的版本/字段先拒绝，不忽略后执行。确认见证使用加密 envelope format 2 并携带实际 IR、引擎/Node 版本、种子及哈希；反馈选值冻结，见证去除活动feedback_inputs，不自动重新学习。旧私有明文 replay format 1 不自动升级。
3. transport、credentialProvider、isolation 是 v1 受信任扩展契约。未知版本、非法返回、超时或权限不足失败关闭；扩展不是不可信代码沙箱，不能保证撤销第三方副作用。
4. OpenAPI 3.0 与原生 3.1/3.2 标准执行范围由两份公开对象矩阵及维护测试约束。3.1/3.2 保留原始版本、Schema 和资源身份，不转换成 3.0；检查与执行均须编译全部 Schema 根。能力声明不是第三方认证、任意 Schema 完备生成或所有业务/媒体组合的穷尽证明。独立 probeModernSchema 仍只做 Schema 探测，其 execution=false 不代表 StandardEngine 没有现代执行能力。未知未来版本和未安装的必需自定义词汇表明确拒绝。
5. 正式版本发布前应满足：严格 check/build/test、四目标核心、Native 对照、Node 全套、样例、三 OS CI、私有资料检查、重定位安装/运行、许可证/SBOM/哈希；保持旧入口和旧已发布包不变。破坏 IR/公开核心 API 的变更需新版本及迁移说明。
6. 默认SBOM/manifest/provenance提供可检查的组成和摘要，**仍未签名**。0.6增加调用者密钥离线签名/验证，信任根须独立提供，不自动认证项目身份；不声称全平台二进制可复现或所有真实接口兼容。长期生产性能仍待独立证据。
