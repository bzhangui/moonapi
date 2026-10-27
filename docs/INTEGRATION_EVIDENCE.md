# 独立后端接入证据与边界

## 2026-10-27：新旧链路同时核验

实际运行 `scripts/interop-pocketbase.mjs`，同一已核验 PocketBase0.40.5 Windows 二进制与独立 SQLite 合成库。两类集合各三轮；每轮旧 owned CRUD 的6步/9次请求之外，增加 StandardWorkflow 的创建、读回、更新、更新确认、删除、404确认，共36步真实后端调用。每轮只剩既有哨兵，重启不变，不需全局 reset。新链路覆盖 string ID、PATCH、POST200 和组件引用，与整数 ID 合成夹具交叉核验。

本机使用显式 `--keep-fixture`：进程已结束，合成数据库留在忽略目录供复核，**没有宣称文件已清理**。Linux CI 的默认清理模式须按本轮 CI 补证。这仍不是外部用户/生产试点；适配契约由本项目编写，不是 PocketBase 官方完整定义。

## 2026-10-22：PocketBase 0.40.5 / SQLite

这次直接启动独立开源项目的官方 Windows amd64 二进制，使用其真实 SQLite 持久化、迁移和记录 REST API，非 MoonAPI 自写 HTTP 服务。两类测试集合分别选择 `title`、`name` 字段，使用 string ID、PATCH、POST 200、组件参数/请求/响应/Schema 引用，覆盖与原 integer ID / PUT / POST 201 夹具不同的形状。

结果：两类集合各 3 轮，共 6 轮、36 个选定流程步骤、54 次引擎 HTTP 请求；每轮创建、读取、更新、读回、删除、读取缺失及归属清理通过。每个集合提前插入一条不属于 runner 的哨兵记录，每轮及服务进程重启后仍原值保留；列表只剩哨兵，没有本轮 runner 合成记录。运行没有 reset 端点、管理员账号或手写状态机。

上游 [PocketBase v0.40.5](https://github.com/pocketbase/pocketbase/releases/tag/v0.40.5)，压缩包通过同发布页 `checksums.txt` 核验（这是下载完整性核验，不是独立签名/安全审计）：

```text
Windows amd64 zip SHA256:
d0980d1f3a8097ff4c03a876e8c98f3008a83c0d42cc03b636bc92b2d4788d1c
本机 pocketbase.exe SHA256:
a6d3fb3555b64655e22c797aab7f7c396e9a2c48d7de89135d868b1758734860
```

复现需要完整源码（精简运行包不包含独立后端测试脚本）：先按上游发布页下载 0.40.5 对应平台压缩包并核验校验和，解压后：

```sh
npm run build
node scripts/interop-pocketbase.mjs --pocketbase /absolute/path/to/pocketbase
# Windows 上本轮环境拒绝删除夹具时，显式保留合成数据库供复核：
node scripts/interop-pocketbase.mjs --pocketbase .local/interop/pocketbase-0.40.5/bin/pocketbase.exe --keep-fixture
```

脚本只启动自有进程、绑定 127.0.0.1 随机端口、建立 `.local/interop-runs/` 新数据库，且退出前停止自有进程；不连接用户已有 PocketBase，不使用真实备份或凭据。默认会尝试删除本次独占目录，删除失败时整个命令失败，不冒充清理成功。`--keep-fixture` 明确保留私有合成数据库，回执 `synthetic_fixture_retained=true`、`temporary_data_removed=false`。Windows 本轮保留模式验证通过；前几轮自动目录删除被系统拒绝，夹具留在本机、没有上传，不将该项算作通过。[Linux CI 39768768848](https://github.com/bzhangui/moonapi/actions/runs/39768768848) 的默认模式实际通过，回执 `temporary_process_removed=true`、`synthetic_fixture_retained=false`、`temporary_data_removed=true`，不能把该 Linux 结果写成本机 Windows 删除通过。

## 不能扩大的结论

- 这是独立后端的**合成数据库接入测试**，不是外部用户试点或生产项目效果。没有真实用户签字、长期运行收益或业务事故定位证据。
- `examples/pocketbase/spec.mjs` 是本项目为两个测试集合编写的适配契约，不是 PocketBase 官方完整 OpenAPI 输出，不代表广泛 OpenAPI 文档兼容性已验证。
- 开放集合规则只存在于专用新数据库，不能复制到真实环境；上游管理员、文件、实时订阅、认证、关系、过滤、批量事务不在本轮覆盖内。
- 进程重启不是物理断电、跨主机或生产可靠性验证；本机未运行 Schemathesis 进行同条件检出率对比。

下一项真实证据应是获得授权后接入一个现有业务测试服务，保留人工接入步骤、原始问题及修复前后结果；缺少授权时不虚构合作方。

参考：[PocketBase 迁移](https://pocketbase.io/docs/js-migrations/)、[记录 API](https://pocketbase.io/docs/api-records/)。没有把 PocketBase 的源代码、二进制或私有数据打入 MoonAPI 分发包。
