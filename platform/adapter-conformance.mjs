import { transportAdapter } from "./adapters.mjs";
import { Engine } from "./runner.mjs";
// A smoke contract, not certification or a sandbox. It sends one authorized
// GET only; an unsafe server that mutates on GET remains caller responsibility.
export async function probeTransportAdapter(
  adapter,
  base,
  { allowRemote = false, timeout = 1000 } = {},
) {
  if (
    !adapter ||
    typeof allowRemote !== "boolean" ||
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 30000
  )
    throw new Error("ADAPTER_CONFORMANCE_OPTIONS");
  const target = new Engine("{}", { allowRemote }).base(base),
    transport = transportAdapter(adapter);
  const response = await transport.send(target, {
    method: "GET",
    headers: {},
    signal: AbortSignal.timeout(timeout),
  });
  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try {
    await transport.send(target, {
      method: "GET",
      headers: {},
      signal: controller.signal,
    });
  } catch {
    aborted = true;
  }
  return {
    adapter_contract: 1,
    passed: aborted,
    response_status: response.status,
    checked: ["bounded-response-shape", "pre-aborted-wrapper-refuses-dispatch"],
    raw_adapter_cooperation_certified: false,
    sandboxed: false,
    production_certified: false,
  };
}
