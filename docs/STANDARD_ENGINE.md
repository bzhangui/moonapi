# OpenAPI 标准适配、测试生成与契约验证

本地源码 0.4.0-rc.1。长期验收范围是完整 OpenAPI 3.0，而不是仅同步 CRUD 或精选 Schema 子集。**当前未达成完整标准支持**；本指南按实际可运行能力说明，缺口不得在申报书中改成“已实现”。

## 启动与三个不同结果

```sh
npm ci --ignore-scripts
npm run build
node bin/moonapi-standard.mjs check examples/standard-spec.json
node bin/moonapi-standard.mjs plan examples/standard-spec.json
npm run demo:standard
```

`check` 检查文档结构、引用和部分语义一致性，不发送 HTTP；并非官方全标准认证。`plan` 生成并交叉校验候选，不发送 HTTP，CLI 不输出候选正文。`run` 才执行请求并检查响应。合法文档可能因生成预算或未实现执行语义而无法完成测试；这与文档非法不同，不得静默省略操作后报告完成。

退出码：0 为该命令完成（`check/plan` 不代表测试通过）；1 为运行失败、不完整、截断或计划有阻塞项；2 为输入、配置或编译错误。错误只返回类别，不返回库原始异常、文档片段或本机路径。

```sh
node bin/moonapi-standard.mjs run your-spec.yaml --base http://127.0.0.1:8080
# 在可控、可丢弃的测试环境，进一步允许非只读方法：
node bin/moonapi-standard.mjs run your-spec.yaml --base http://127.0.0.1:8080 --allow-write
```

GET/HEAD/OPTIONS 默认允许；其他方法须 `--allow-write`。方法许可不保证 GET 没有业务副作用，目标必须有权测试。远端另需 `--allow-remote`。不会跟随重定向，不关闭 TLS 校验。不自动做全库 reset、删除或失败序列重放；复杂状态测试继续使用独立状态引擎并满足重置、重复写许可。

## 计算核心与标准库的职责

- MoonBit `standard_schedule` 为每个操作公平分配候选再追加变体，固定种子保证顺序可复现；不把前几个端点的多样例当作所有端点覆盖。
- MoonBit `standard_oracle` 将契约校验与请求语义合并：无效输入被接受、有效输入返回 4xx、5xx、认证/限流、重定向均不当作通过。4xx 也可能源自业务前置状态不足，不能仅据此断言服务有缺陷。
- MoonBit `standard_verdict` 要求计划全部执行、无失败、无阻塞、无预算截断；即使当前采样完整也保持 `full_openapi_support=false`。
- Node 使用 Swagger Parser 做文档结构与受控引用处理；使用独立 Ajv Draft-04 与 OAS 方向/nullable 转换验证原始约束；Enforcer **仅产生候选**，不是契约裁判。已复现其 `not` 转换、组合拒绝及 AND 安全声明限制，不据此判合法文档不支持。
- JSON/YAML、规范处理及 HTTP 属于 Node 适配，不声称可从 `moon add` 获得四目标网络客户端。新 policy API 的四目标证据也不等于 Node 兼容层四目标实现。

所有生成的正例必须满足请求约束；负例必须被请求约束拒绝，防止把不合法“正例”误判成服务问题。候选含有效值、Schema 边界、参数遗漏和无效正文。复杂/不可满足约束可能耗尽有限搜索，不证明 Schema 无解。种子可复现只限同源码和 lockfile，不保证跨不同依赖版本得到相同随机值。

## 库使用与生命周期

```js
import { StandardEngine } from "./platform/standard.mjs";
const engine = await StandardEngine.open(source, { seed: 42, limit: 256 });
try {
  const plan = await engine.plan(); // 正文和示例可能含敏感业务数据，只保存在私有环境。
  const result = await engine.run("http://127.0.0.1:8080");
} finally {
  await engine.close();
}
```

必须 `close()`，包括异常路径。每个实例独立的工作线程有内存与单命令 CPU 预算，可中断灾难性正则/随机生成；关闭后不能复用，不并发执行同一实例的计划/运行。HTTP 及响应体读取由单请求和总时限约束。默认源文档 1 MiB、外部文档合计 4 MiB/16 个、操作 256、计划 256、每操作候选 128、请求 256 KiB、响应 1 MiB；预算导致的不完整不会报通过。

`validateRequest(case)` 校验逻辑参数与请求体，`validateResponse(id,status,body,headers,empty)` 校验已解码的响应；网络模式会额外验证 UTF-8、JSON 编码及整数精度。离线调用者须正确提供解码值和空体标志，不可将其当作原始 HTTP 报文解析器。

## 引用与服务地址

本地及递归 `$ref` 保留语义，不展开成无限副本。外部引用**不会自动联网或读文件**。库选项 `documents` 是“绝对 HTTP(S) URI → 文档字符串”的精确映射，可含 JSON/YAML，路径按虚拟根 `https://moonapi.invalid/openapi.json` 解析；不给授权内容则编译失败。禁止 `file:`，不扫描邻近目录。CLI `--references private-reference-map.json` 读取这个映射，文件应保持私有。

`engine.server(operationId,index,variables)` 离线解析操作/路径/根 servers 的继承、默认值和枚举；返回 URL 不代表授权连接。执行仍以显式 `base` 为准，不能借服务器变量改变实际请求源。参数值分开编码，路径穿越、未绑定占位符及 CR/LF 头注入拒绝。

## 凭据

库选项 `credentials` 或 CLI 环境变量 `MOONAPI_STANDARD_CREDENTIALS` 提供安全方案名到凭据对象的映射。例如 apiKey/Bearer 用 `{value: ...}`，Basic 用 `{username: ...,password: ...}`，OAuth2/OpenID 令牌用 `{value: ...,scopes: ['read']}`。示例中的值均由使用者从安全存储注入，不在命令行、规范或源码中写真实令牌。

执行按安全需求 OR 选可满足的一组，再对组内 AND 注入；OAuth/OpenID 需显式声明具备所需 scopes，不自动登录，不证明实际 token 权限。缺凭据、未知方案、远端非 TLS、无作用域或非法编码均阻塞。库报告不输出凭据/请求/响应/捕获正文；operationId 等业务标识在库报告中仍可能敏感，CLI 只显示编号。

## 明确保留的完整兼容缺口

- XML 模型/编码/验证、Encoding 对象全部语义、多部分复杂文件组合仍需实现和端到端矩阵；默认 multipart 已有生成和线格式测试，不等于全部编码已完成。
- Links/operationRef/运行时表达式的自动依赖执行、Callbacks 的授权接收/关联/清理尚未实现。声明被保留并标记阻塞，不静默删掉。
- TRACE 传输、非 Basic/Bearer HTTP 认证方案、discriminator 更广语义交互、部分保留分隔符/嵌套参数和更多序列化交互仍有缺口；无法确保正确时阻塞。
- 当前 JSON 数值超过安全整数范围拒绝核验，不声称完整 int64/精确十进制。所有合法标准输入的支持尚未经过全面一致性套件证明。
- 需要更广独立服务、各媒体实际 HTTP 端到端、对照工具一致性和真实项目授权验证；受控反例和官方定义导入不能替代这些证据。

后续按 [完整兼容矩阵](OPENAPI_3_0_MATRIX.md) 清零，而不是缩小申报范围。这些缺口存在期间不得宣称已完全消除本轮驳回原因，也不能保证复审通过。
