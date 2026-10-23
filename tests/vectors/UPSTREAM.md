# 固定独立测试向量

来源：https://github.com/json-schema-org/JSON-Schema-Test-Suite

提交：89e83a74014617ffbe79a56d83d14d054cd11417。

draft4/ 中 21 份 JSON 以原样下载，未重写预期值或删除测试；LICENSE 保留上游 Copyright (c) 2012 Julian Berman 的 MIT 全文。

执行器 ../standard-vectors.test.mjs 明确判断该组是否使用 OAS 3.0 自身没有定义的 JSON Schema 词汇/类型。当前适用 81 组/344 断言，另外 23 组不属于 OAS 3.0 Schema，仍原样保留供检查。没有通过删除合法 OAS 约束来取得通过；OAS 扩展语义、参数、引用、媒体、HTTP、安全、Links 和 Callbacks 在独立专项测试中覆盖。这不是官方 OpenAPI 一致性认证。
