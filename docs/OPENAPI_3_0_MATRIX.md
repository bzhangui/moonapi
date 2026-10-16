# OpenAPI 3.0 JSON 完整兼容目标与当前缺口

依据 [OpenAPI 3.0.3 官方规范](https://spec.openapis.org/oas/v3.0.3.html) 建立工作清单。目标是完整的 3.0 JSON 文档语义，不是“只把 JSON 读进来”。**当前 full_standard_support = false**；本轮独立状态引擎增强不等于下表全部完成。不能据此声称已经消除所有复审缺口。

| 单元 | 当前事实 | 达成完整目标所需工作与证据 |
|---|---|---|
| 文档结构/版本 | 已知 3.0 patch 版本；有界 paths/operations | 完整结构验证、所有合法可选字段、扩展字段及无 operationId 文档 |
| 引用 | 仅本地非递归 schema 组件 | 所有引用对象、转义指针、跨文件/远程显式加载、循环及资源错误分类 |
| Schema 基础 | 标量/对象/数组、枚举、必填、部分边界、nullable | 无 type、完整数值/集合/属性约束、schema 形式附加属性 |
| Schema 组合与语义 | 未支持，拒绝 | allOf/anyOf/oneOf/not、discriminator、readOnly/writeOnly、pattern/format、XML/byte/binary；生成与响应验证分别测试 |
| 参数 | 标量 path/query，明确样式 | header/cookie、数组/对象、全部合法 style/explode/allowReserved、content 参数及重复名称作用域 |
| 请求媒体/编码 | application/json | 多媒体选择、表单/多部分/文件/二进制、Encoding 对象及空/可选请求体 |
| 响应 | 精确状态/default、JSON/空体及 HEAD | 状态范围、媒体协商、headers、引用和 Links/运行时表达式 |
| 服务与路径 | 显式 base；基本路径模板 | 层级 servers/变量、所有合法 HTTP 方法、规范 URL/路径/编码与作用域 |
| 安全需求 | 外部手工 Bearer；未求值的声明拒绝 | apiKey/Basic/Bearer/OAuth2/OpenID 的凭据注入、AND/OR/覆盖语义；不把自动登录等同于所有认证支持 |
| 回调 | 未实现，拒绝 | 显式授权回调接收器、请求关联、运行时表达式、接口断言和资源清理 |
| 实验适配失败门禁 | 未实现的活动约束不能静默忽略 | 每项有正例、边界/拒绝、HTTP 端到端和跨目标公开 API 测试 |
| 独立行为层 | 本轮实际实现 | 在上述更广描述中验证状态模型、数据依赖和重置重放，不与单纯契约覆盖混计 |

顺序：先描述/引用与完整 Schema，再参数/媒体/响应，再服务/认证/Links/Callbacks；每阶段扩展之前固定规范夹具和兼容回归。允许资源预算，但预算错误应与“标准不合法”区分，不能靠缩小输入域宣称标准全覆盖。

最终门禁：所有上表标准单元有可查测试、所有声明能力均有真实执行样例、跨平台 CI 和独立消费者通过；仍有未实现语义时，不允许把文档/CLI 的完整支持标记改为 true。YAML、3.1/3.2、GraphQL/gRPC 是另行范围，不混称为本次 JSON 3.0 全量目标。
