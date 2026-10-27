const $ = (id) => document.getElementById(id);
let token = location.hash.slice(1),
  session,
  operations = [],
  report,
  polling = false,
  checkedSource;
history.replaceState(null, "", location.pathname); // token stays in memory, not browser address/referrers.
const notice = (text, error = false) => {
  $("notice").textContent = text;
  $("notice").classList.toggle("flash-error", error);
};
async function api(route, body) {
  const res = await fetch("/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "REQUEST_FAILED");
  return data;
}
function field(id, label) {
  const wrap = document.createElement("div"),
    l = document.createElement("label"),
    s = document.createElement("select");
  l.className = "field-title";
  l.htmlFor = "op-" + id;
  l.textContent = label;
  s.id = "op-" + id;
  s.className = "form-select full";
  wrap.append(l, s);
  $("resource-selects").append(wrap);
  return s;
}
const resourceSelects = Object.fromEntries(
  [
    ["create", "创建"],
    ["read", "读取"],
    ["update", "更新"],
    ["remove", "删除"],
  ].map(([id, label]) => [id, field(id, label)]),
);
const mode = () => {
  for (const id of ["owned", "workflow"]) $(id).hidden = $("mode").value !== id;
};
$("mode").addEventListener("change", mode);
const safeAction = (fn) => async () => {
  try {
    await fn();
  } catch (error) {
    notice("未完成：" + error.message, true);
  }
};
$("import").addEventListener(
  "change",
  safeAction(async () => {
    const f = $("import").files[0];
    if (!f) return;
    if (f.size > 1048576) throw new Error("文件超过 1 MiB");
    $("source").value = await f.text();
    $("run").disabled = true;
    checkedSource = undefined;
    notice("文档已载入，请检查并生成计划。");
  }),
);
$("source").addEventListener("input", () => {
  $("run").disabled = true;
  checkedSource = undefined;
});
$("inspect").addEventListener(
  "click",
  safeAction(async () => {
    $("inspect").disabled = true;
    notice("正在隔离工作线程中检查文档和生成候选…");
    try {
      const requestedSource = $("source").value;
      const r = await api("inspect", { source: requestedSource });
      if ($("source").value !== requestedSource)
        throw new Error("文档在检查期间发生变化，请重新检查");
      operations = r.operations;
      checkedSource = r.execution_supported ? requestedSource : undefined;
      $("plan").replaceChildren();
      $("plan-empty").hidden = operations.length > 0;
      $("plan-count").textContent = operations.length;
      for (const op of operations) {
        const label = document.createElement("label");
        label.className = "operation";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = op.id;
        input.checked = r.readonly_default?.includes(op.id);
        const method = document.createElement("span");
        method.className = "method";
        method.textContent = op.method;
        const text = document.createElement("span"),
          route = document.createElement("span");
        text.textContent = op.id;
        route.className = "op-path";
        route.textContent = op.route;
        text.append(route);
        label.append(input, method, text);
        $("plan").append(label);
      }
      for (const [id, s] of Object.entries(resourceSelects)) {
        s.replaceChildren();
        for (const op of operations.filter((o) =>
          ({
            create: ["POST"],
            read: ["GET"],
            update: ["PUT", "PATCH"],
            remove: ["DELETE"],
          })[id].includes(o.method),
        )) {
          const item = document.createElement("option");
          item.value = op.id;
          item.textContent = op.id;
          s.append(item);
        }
      }
      $("plan-summary").textContent = r.execution_supported
        ? `已生成 ${r.generated_cases} 个候选，${r.blockers.length} 个阻断项。执行结果仍取决于选定接口及实际返回。`
        : `${r.dialect?.version} 结构检查：${r.dialect?.structurally_valid ? "通过" : "存在问题"}。尚未验证现代方言运行兼容性，执行禁用。`;
      $("run").disabled = !r.execution_supported;
      notice(
        r.execution_supported
          ? "检查完成。请确认目标环境、选择范围和副作用授权。"
          : "仅结构检查，不发送测试请求。",
      );
    } finally {
      $("inspect").disabled = false;
    }
  }),
);
function configuration() {
  return {
    source: $("source").value,
    base: $("base").value,
    mode: $("mode").value,
    seed: Number($("seed").value),
    limit: 64,
    totalTimeout: 60000,
    operationIds: [...$("plan").querySelectorAll("input:checked")].map(
      (x) => x.value,
    ),
    model: $("model").value,
    resource: Object.fromEntries(
      Object.entries(resourceSelects).map(([k, s]) => [k, s.value]),
    ),
    allowWrite: $("writes").checked,
    allowCleanup: $("cleanup").checked,
  };
}
function render(r) {
  report = r;
  $("executed").textContent = r.executed ?? 0;
  $("sent").textContent = r.execution?.sent ?? "—";
  $("unknown").textContent = r.execution?.unknown_writes ?? 0;
  $("result-description").textContent =
    `${r.passed ? "所选范围通过" : "未通过或未完成"} · ${r.category ?? "参见逐项分类"}${r.cleanup_verified === undefined ? "" : ` · 清理${r.cleanup_verified ? "已验证" : "未确认"}`}。未执行和未知结果不计为成功。`;
  $("records").replaceChildren();
  for (const [i, row] of (r.records ?? []).entries()) {
    const tr = document.createElement("tr");
    for (const value of [i + 1, row.status, row.category, row.code || "通过"]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    $("records").append(tr);
  }
  $("download").disabled = false;
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      const j = await api("status");
      $("state").textContent =
        {
          running: "运行中",
          finished: "已结束",
          cancelled: "已停止",
          failed: "执行失败",
          idle: "尚未运行",
        }[j.state] ?? j.state;
      if (j.state !== "running") {
        if (j.report) {
          render(j.report);
          notice(
            j.report.passed
              ? "验证完成：所选范围通过，详情见下方脱敏摘要。"
              : "验证结束：存在失败或未完成项，请检查逐项分类。",
            !j.report.passed,
          );
        }
        if (j.state === "cancelled")
          notice("后续执行已停止。已发送写入需在接收端核实，不能假定已回滚。");
        if (j.error)
          notice(
            "执行未完成。正文与凭据已隐藏；请检查授权、模型和目标可用性。",
            true,
          );
        break;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch {
    notice(
      "本机服务连接中断；已发送请求的结果可能未知，请勿直接重试写入。",
      true,
    );
  } finally {
    polling = false;
    $("cancel").disabled = true;
    $("run").disabled = !checkedSource;
  }
}
$("run").addEventListener(
  "click",
  safeAction(async () => {
    if (checkedSource !== $("source").value)
      throw new Error("请先重新检查文档");
    $("run").disabled = true;
    $("cancel").disabled = false;
    try {
      await api("run", configuration());
      notice("正在验证。停止只会阻止后续请求，不会撤销远端操作。");
      void poll();
    } catch (error) {
      $("run").disabled = false;
      $("cancel").disabled = true;
      throw error;
    }
  }),
);
$("cancel").addEventListener(
  "click",
  safeAction(async () => {
    await api("cancel", {});
    notice("已请求停止。未知写入不会自动重放，请在接收系统核实结果。");
  }),
);
$("download").addEventListener("click", () => {
  if (!report) return;
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
  a.href = url;
  a.download = "moonapi-redacted-summary.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("save").addEventListener(
  "click",
  safeAction(async () => {
    const profile = configuration();
    delete profile.allowWrite;
    delete profile.allowCleanup;
    const r = await api("profile-save", { profile });
    $("profile-id").value = r.id;
    notice("配置已加密保存。密钥不写入文件，运行时仍需重新授权。");
  }),
);
$("load").addEventListener(
  "click",
  safeAction(async () => {
    const { profile: p } = await api("profile-load", {
      id: $("profile-id").value,
    });
    for (const id of ["source", "base", "mode", "seed", "model"])
      if (p[id] !== undefined) $(id).value = p[id];
    $("writes").checked = false;
    $("cleanup").checked = false;
    $("run").disabled = true;
    checkedSource = undefined;
    mode();
    notice("私有配置已载入，请重新检查并选择范围。");
  }),
);
try {
  if (!token) throw new Error("请使用终端打印的完整会话链接重新打开");
  session = await api("session");
  $("version").textContent = "v" + session.version;
  $("writes").disabled = !session.write_capability;
  $("save").disabled = $("load").disabled = !session.encrypted_profiles;
  $("storage").textContent = session.encrypted_profiles
    ? "已配置 AES-256-GCM 私有快照。最多 10 份，不保存明文密钥。"
    : "仅当前会话；未配置持久密钥，不保存文档或模型。";
  $("environment").textContent = session.synthetic_demo
    ? "合成演示环境"
    : "用户授权环境";
  if (session.demo) {
    $("source").value = session.demo.source;
    $("base").value = session.demo.base;
  }
  notice(
    session.synthetic_demo
      ? "合成演示已就绪。它不代表真实用户或生产验证。"
      : "本机服务已连接。默认不执行写入，先导入文档。",
  );
  void poll();
} catch (e) {
  notice(e.message, true);
}
