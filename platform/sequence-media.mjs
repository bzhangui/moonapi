// Bounded streaming primitives, not an OpenAPI 3.2 execution capability claim.
import { parseExact } from "./standard-value.mjs";
import { within } from "./adapters.mjs";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
export async function decodeSequence(
  chunks,
  {
    media,
    maxBytes = 1048576,
    maxItems = 256,
    maxItemBytes = 65536,
    timeout = 2000,
    signal,
  } = {},
) {
  if (
    ![
      "application/x-ndjson",
      "application/json-seq",
      "text/event-stream",
    ].includes(media) ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1048576 ||
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 256 ||
    !Number.isInteger(maxItemBytes) ||
    maxItemBytes < 1 ||
    maxItemBytes > 1048576 ||
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 30000 ||
    typeof chunks?.[Symbol.asyncIterator] !== "function"
  )
    throw new Error("SEQUENCE_OPTIONS");
  const boundedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
    iterator = chunks[Symbol.asyncIterator](),
    decoder = new TextDecoder("utf-8", { fatal: true }),
    items = [],
    deadline = performance.now() + timeout;
  let buffer = "",
    total = 0,
    eventData = [],
    eventType = "",
    lastId = "",
    retry,
    eventBytes = 0,
    seqStarted = false,
    completed = false,
    chunkCount = 0;
  const add = (item) => {
    if (items.length >= maxItems) throw new Error("SEQUENCE_ITEM_BUDGET");
    items.push(item);
  };
  const check = (s) => {
    if (Buffer.byteLength(s) > maxItemBytes)
      throw new Error("SEQUENCE_RECORD_BUDGET");
  };
  const json = (s) => {
    check(s);
    try {
      return parseExact(s);
    } catch {
      throw new Error("SEQUENCE_JSON");
    }
  };
  const line = (value) => {
    check(value);
    if (media === "application/x-ndjson") {
      if (value.trim()) add(json(value));
      return;
    }
    if (value === "") {
      if (eventData.length)
        add({
          data: eventData.join("\n"),
          event: eventType || "message",
          id: lastId,
          ...(retry === undefined ? {} : { retry }),
        });
      eventData = [];
      eventType = "";
      eventBytes = 0;
      return;
    }
    eventBytes += Buffer.byteLength(value);
    if (eventBytes > maxItemBytes) throw new Error("SEQUENCE_RECORD_BUDGET");
    if (value.startsWith(":")) return;
    const at = value.indexOf(":"),
      field = at < 0 ? value : value.slice(0, at);
    let v = at < 0 ? "" : value.slice(at + 1);
    if (v.startsWith(" ")) v = v.slice(1);
    if (field === "data") eventData.push(v);
    else if (field === "event") eventType = v;
    else if (field === "id" && !v.includes("\0")) lastId = v;
    else if (
      field === "retry" &&
      /^[0-9]+$/.test(v) &&
      Number.isSafeInteger(Number(v))
    )
      retry = Number(v);
  };
  const consume = (text, final = false) => {
    buffer += text;
    if (media === "application/json-seq") {
      for (;;) {
        const at = buffer.indexOf("\x1e");
        if (at < 0) break;
        const before = buffer.slice(0, at);
        if (seqStarted) add(json(before));
        else if (before.trim()) throw new Error("SEQUENCE_FRAMING");
        seqStarted = true;
        buffer = buffer.slice(at + 1);
      }
      check(buffer);
      if (final && buffer.trim()) {
        if (!seqStarted) throw new Error("SEQUENCE_FRAMING");
        add(json(buffer));
        buffer = "";
      } else if (final && seqStarted) throw new Error("SEQUENCE_JSON");
      return;
    }
    for (;;) {
      const match = /[\r\n]/.exec(buffer);
      if (!match) break;
      const index = match.index;
      if (buffer[index] === "\r" && index === buffer.length - 1 && !final)
        break;
      line(buffer.slice(0, index));
      buffer = buffer.slice(
        index + (buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1),
      );
    }
    check(buffer);
    if (final && buffer && media === "application/x-ndjson") {
      line(buffer);
      buffer = "";
    }
    // SSE EOF does not dispatch an event without its empty-line terminator.
  };
  try {
    for (;;) {
      const next = await within(
        boundedSignal,
        () => iterator.next(),
        "SEQUENCE_DEADLINE",
      );
      if (next.done) {
        consume(decoder.decode(), true);
        completed = true;
        break;
      }
      if (++chunkCount > 8192) throw new Error("SEQUENCE_CHUNK_BUDGET");
      if (chunkCount % 64 === 0) await setImmediate();
      if (performance.now() >= deadline) throw new Error("SEQUENCE_DEADLINE");
      if (!(next.value instanceof Uint8Array))
        throw new Error("SEQUENCE_CHUNK");
      if ((total += next.value.byteLength) > maxBytes)
        throw new Error("SEQUENCE_BYTE_BUDGET");
      consume(decoder.decode(next.value, { stream: true }));
    }
    return {
      items,
      bytes: total,
      complete: true,
      discarded_unterminated_sse_event:
        media === "text/event-stream" &&
        (eventData.length > 0 || buffer.length > 0),
      experimental: true,
      openapi_execution_supported: false,
    };
  } finally {
    if (!completed && iterator.return)
      Promise.resolve()
        .then(() => iterator.return())
        .catch(() => {});
  }
}
