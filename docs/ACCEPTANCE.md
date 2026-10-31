# 九条验收复核：0.10.0（2026-10-31）

本表区分源码实现、本机验证、远端CI、注册表分发和官方裁定。不能将某次测试通过或能力标记替代全部九项。用户已授权测试后推送GitHub并发布Mooncakes，运行包不公开。

| 条目 | 当前状态与证据 | 更正及边界 |
| --- | --- | --- |
| 1 MoonBit主要实现、moonc≥0.10.16 | 编译门槛满足，私有moonc0.10.18，四目标运行。Schema实例求值、精确候选、覆盖调度、状态/缩减/业务策略由MoonBit实现。 | 主要实现语言仍有审查风险：Node文档/生成/协议实现明显较多。已实际迁移候选算术和依赖IR，不按自定占比宣布通过；不得填充代码或隐藏JS。需进一步迁移和主办判定，暂不标为无条件满足。 |
| 2 公开仓库、清晰提交 | 仓库bzhangui/moonapi已核为PUBLIC，默认main；本轮最终提交/推送以PUBLICATION补证。 | 只提交实质源码/测试/文档，不制造空开发提交；私人申报书、凭据及原始数据不公开。 |
| 3 清晰结构及声明功能 | core/app计算层、platform宿主层、bin、examples、tests分层；标准契约、生成、状态/缩减有健康/故障对照。 | 新接入草案不授予执行许可；缓存不取代校验；未知写入、阻塞、截断和清理失败不报通过。现代差异分析保守全套，不声称精细裁剪。 |
| 4 README目标/安装/使用/示例可复现 | 根README和UPGRADE_0_10含Node/moonc门槛、锁定安装、构建、inspect/init/run及权限；历史状态已单独归档。 | release-state门禁核对源码/已发布核心/运行包状态，修复旧版本冲突及工作台过时提示。 |
| 5 持续集成检查/构建/测试 | 三OS工作流覆盖check/build/test、四目标、全部样例、Node、覆盖、包审计；Linux新增规模/耐久、FastAPI和既有PocketBase。 | 最终版本远端状态待具体SHA补录，不能借用0.9绿线。 |
| 6 至少一个运行样例 | examples/core、planning_core及标准/现代/业务回环示例；planning_core纯MoonBit消费者四目标已运行。 | FastAPI另需独立venv，不把Python夹具混入核心库运行要求。 |
| 7 核心功能测试 | 完整旧回归保留，新增576组精确候选迁移向量、依赖/覆盖/缓存/凭据范围/取消/故障组合；FastAPI11组合及100轮本机耐久。 | 最终数量按QUALITY_REPORT；选定向量/合成测试不等于全部极端情况或真实用户。Windows PocketBase功能/持久化通过，临时目录删除仍受EPERM/本机策略限制，未记成全绿。 |
| 8 发布mooncakes.io | 已发布0.9.0仍可用；0.10.0须在最终维护、CI、隐私检查后发布并验证注册表摘要及下载后的独立四目标消费。 | 结果待PUBLICATION补证，不以旧包证明新API已发布；Mooncakes核心不是完整Node运行包。 |
| 9 OSI认可许可及合规 | Apache-2.0、LICENSE/NOTICE、MoonBit和固定向量原许可保留；npm依赖锁及原许可、集成Python依赖说明完整。 | 新增Python框架仅在独立测试环境安装，不复制为原创、不分发venv/二进制；来源元数据/SBOM不是可信签名或法律审计。 |

可复验入口：`npm run validate`、`node scripts/scale.mjs`、`node --expose-gc scripts/soak.mjs --rounds 100`、FastAPI集成命令见[升级指南](UPGRADE_0_10.md)。许可证为[Apache-2.0](https://opensource.org/license/apache-2-0)。

结论：不得宣布九项全部无缺口。第1条编译器版本已达标，但“主要实现语言”需继续实质迁移并由主办认定；Windows独立后端夹具清理、真实用户/长期生产、正式可信签名均有明确边界。完成实现与受控证据不保证赛事验收结论。

[历史验收记录](ACCEPTANCE_HISTORY.md)仅描述相应版本，不代表当前状态；当前测试与发布见[QUALITY_REPORT](QUALITY_REPORT.md)、[PUBLICATION](PUBLICATION.md)。
