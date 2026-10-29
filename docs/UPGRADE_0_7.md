# 0.7.0-rc.1：保护归属的输入缩减与响应反馈

本轮继续补齐0.6候选的两项业务缺口，改进独立现代Schema探针。仅推送通过测试的源码；**不发布Mooncakes、GitHub Release或运行包**。本地包用于验证可重定位交付，不能当作已公开安装版本。维护结果以 [QUALITY_REPORT](QUALITY_REPORT.md) 为准，旧版本证据按原日期保留。

新增反馈/来源锁从库API显式启用；工作台和低配置CLI不自动采集响应，也不自动升级已有模型。

## 运行可复现的受控示例

```sh
npm ci --ignore-scripts
npm run build
node examples/owned-reduction-demo.mjs
node examples/feedback-demo.mjs
npm run validate
```

两个演示自行启动/关闭回环合成服务，分别验证健康对照和故意注入的缺陷，不接触客户系统或真实资料。不需要凭据、外部账号或清空业务库；默认报告不输出正文、归属标记和返回ID。不要将这些模拟改称真实用户试点。

## 1. owned模型现在可以有条件地缩减外生输入

新增 `protectedOwnedWorkflow(options)` 模板，保留旧 `ownedResourceWorkflow` 的v1行为。新模板返回v2 IR，显式锁定create/update中的归属标记来源。手写v2模型可声明：

```js
model.input_protection = [
  { step: 'create', target: '$request.body#/name' },
  { step: 'update', target: '$request.body#/name' },
];
model.steps.find(s => s.id === 'update').shrink_inputs = ['$request.body#/payload'];
const report = await engine.run(base, model, { allowCleanup: true, shrink: true });
```

引用步骤名须匹配自己的模型（完整示例见演示源码）。锁只接受实际存在的request body/query值，快照精确比较；删祖先对象或缩减父级不得改变锁值。只有全部声明归属标记均出现在锁值中、且显式允许清理时，才能以每次核验清理代替全局reset进行缩减。旧v1或缺少完整锁的模型仍不开放这条路径；已有显式reset授权路径保留。

每次试验重新捕获返回ID；修改和删除前仍走GET归属核验，删除后必须确认不存在。**锁是调用者对来源的声明，不是工具自动证明任意服务端归属转换/外部副作用的证据**。不得使用生产资料；应有独立到期回收策略。任一清理无法确认立即停止后续候选/确认/重置，报告blocked；响应丢失的写入不会自动重发或猜ID删除。

## 2. 响应值与Schema联合反馈（显式启用、内存私有）

新增 `ResponseCorpus`，绑定 `documentDigest(source, documents)` 和 `intentEnvironmentBinding(base)`；构造时逐项授权操作、JSON Pointer、角色和消费者。它不是自动爬取所有字段的代理，不学习错误/拒绝/契约失败响应，也不采集归属GET探针。

```js
import { ResponseCorpus } from '../platform/response-corpus.mjs';
import { documentDigest } from '../platform/ci-tools.mjs';
import { intentEnvironmentBinding } from '../platform/execution-intent.mjs';

const corpus = new ResponseCorpus({
  documentBinding: documentDigest(source),
  environmentBinding: intentEnvironmentBinding(base),
  sources: [{ id: 'codes', operation: 'hints', pointer: '/values',
    explode: true, consumers: ['quote'] }],
});
// v2模型中的quote步骤（示例操作名，需在文档中存在）：
step.feedback_inputs = [{ source: 'codes', target: '$request.body#/code', required: true }];
const report = await engine.run(base, model, { feedbackCorpus: corpus });
```

代码片段按examples目录导入路径书写，完整可运行版本见 `examples/feedback-demo.mjs`。请求必须已有可绑定位置；只允许body/query，不覆盖header/path、已声明query API-key、返回值绑定或归属锁；互相重叠的反馈目标也拒绝。不自动识别业务正文中的自定义登录字段，来源/目标映射仍需调用者审查。带归属门禁的工作流须有完整显式来源锁才能使用反馈。授权、文档与环境不匹配时在reset/HTTP之前拒绝。绑定使用与求值相同的表达式解析，保留字段名中的字面 `}`，不会截断并写到相邻字段。

初始试验先用成功2xx、契约及业务断言通过的响应收集样本。每个候选先验证整个请求Schema，再由MoonBit `feedback_choice` 依固定seed和最少使用次数选择。`required:true` 无合法候选则blocked；可选映射回退原输入。选中值冻结到本次私有模型；缩减和最终确认不重新学习、不消耗新选择。它提升输入多样性，**不承诺穷尽状态空间、自动理解业务或替代业务断言**。

默认最多128值/128KiB；上限256值/256KiB，每来源最多16值，单样本8KiB，每次explode只取前16个。满额逐出/丢弃并计数。报告仅计数，无原始样本/来源操作名；计数是该实例累计值而非单run增量。实例不落盘，必须视为可能含敏感正文的内存对象，不共享给不受信任代码，也不要跨并发执行共享。显式导出的确认见证有冻结输入，仍须使用独立密钥加密并私下保管。

未知写入、清理失败或隔离失效/释放无法确认会将corpus标为不可继续使用；后续run在reset/HTTP之前拒绝。先只读对账/人工处置，不自动解锁或重试；确认环境安全后由调用者决定是否新建实例。反馈只用于主试验步骤，cleanup不接受反馈字段。

## 3. 独立2020-12 Schema探针

`probeModernSchema(schemaJSON, dataJSON, options)` 保留原始十进制和int64词法，精确判断类型、边界、multipleOf、const/enum/uniqueItems；不再因转换成double而误判相邻整数。用显式属性/索引集合处理组合、条件、contains和unevaluated*注解；离线资源解析保留$id、anchor/dynamicRef及引用兄弟约束。Ajv用于原始Schema元数据校验，格式断言使用锁定ajv-formats，不将这些依赖能力冒称MoonBit原生实现。

仅解析调用者传入的最多16份URI→文档内容，绝不自动联网/读URI文件。只允许2020-12方言，未知必需词汇、未授权引用、超出数值/资源预算或无进展循环失败关闭。默认format是注解；显式 `assertFormats:true` 对已知格式断言，未知格式拒绝。contentEncoding/contentMediaType/contentSchema是注解，不解码执行正文。未知可选词汇不自动成为自定义断言。

公开工作线程API限制合并输入1MiB、128MiB老生代/16MiB新生代、CPU超时100–30000ms；默认2000ms。每份值最多50000节点/64层，系数4096位、指数绝对值10000；离线展开1024变体/4MiB，求值200000步/256深度。内部直接编译器用于可信维护测试，不是同进程CPU沙箱。正则风险仍通过工作线程强制超时隔离。

`tests/vectors/draft2020-12` 固定上游原始文件/提交和Git blob摘要，保留MIT许可；执行19文件、184组、660断言，不删除失败组。它是**已选词汇向量的证据，不是整个JSON Schema认证**；尚未将3.1/3.2整套文档、媒体、安全、回调等接入执行。主入口继续拒绝这些版本，两个full-modern/execution标志保持false。

规范依据：[JSON Schema 2020-12](https://json-schema.org/draft/2020-12)、[验证规范](https://json-schema.org/draft/2020-12/json-schema-validation)、[上游测试套件固定版本](https://github.com/json-schema-org/JSON-Schema-Test-Suite/tree/89e83a74014617ffbe79a56d83d14d054cd11417)。

## 仍未完成，不用模拟替代

完整OAS3.1/3.2执行、更多集合/队列并发模型、多个独立业务后端接入、生产身份服务和跨主机隔离、真实用户/长期生产效果仍有缺口。8MiB账本仍非无限归档；响应反馈为有界显式映射，不是自由搜索全部业务。Windows独立数据库自动清理的历史环境缺口另见维护报告。Apache-2.0/NOTICE、上游测试和依赖原许可保留；私人申报书、密钥、语料、账本和原始报告不公开。
