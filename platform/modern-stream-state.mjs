// Worker-local streaming ownership. Commands acknowledge counts only; only EOF
// releases the private decoded instance for the normal response-contract path.
import { createModernStreamParser } from "./modern-media.mjs";
const fail = (code) => {
  throw new Error("MODERN_STREAM_" + code);
};
const validID = (id) =>
  typeof id === "string" && /^[A-Za-z0-9_.-]{1,96}$/.test(id);
export class ModernStreamState {
  #active = new Map();
  #finished = new Set();
  #closed = false;
  #maxActive;
  #maxHistory;
  constructor({ maxActive = 1, maxHistory = 1024 } = {}) {
    if (
      !Number.isInteger(maxActive) ||
      maxActive < 1 ||
      maxActive > 8 ||
      !Number.isInteger(maxHistory) ||
      maxHistory < 1 ||
      maxHistory > 4096
    )
      fail("STATE_OPTIONS");
    this.#maxActive = maxActive;
    this.#maxHistory = maxHistory;
  }
  #guardID(id) {
    if (this.#closed) fail("STATE_CLOSED");
    if (!validID(id)) fail("STATE_ID");
  }
  #get(id) {
    this.#guardID(id);
    const parser = this.#active.get(id);
    if (!parser) fail("STATE_NOT_OPEN");
    return parser;
  }
  #retire(id) {
    this.#active.delete(id);
    this.#finished.add(id);
  }
  open({ id, media, content = {}, options = {} } = {}) {
    this.#guardID(id);
    if (this.#active.has(id) || this.#finished.has(id)) fail("STATE_REUSED_ID");
    if (
      this.#active.size >= this.#maxActive ||
      this.#active.size + this.#finished.size >= this.#maxHistory
    )
      fail("STATE_BUDGET");
    const parser = createModernStreamParser(media, content, options);
    this.#active.set(id, parser);
    return { id, complete: false, opened: true };
  }
  chunk(id, input) {
    const parser = this.#get(id);
    try {
      let bytes = input;
      if (Array.isArray(input)) {
        if (
          input.length > 1048576 ||
          input.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
        )
          fail("CHUNK");
        bytes = Uint8Array.from(input);
      }
      return parser.feed(bytes);
    } catch (error) {
      parser.abort();
      this.#retire(id);
      throw error;
    }
  }
  end(id) {
    const parser = this.#get(id);
    try {
      return parser.finish();
    } finally {
      parser.abort();
      this.#retire(id);
    }
  }
  abort(id) {
    this.#guardID(id);
    const parser = this.#active.get(id);
    if (!parser) return { aborted: false, complete: false };
    parser.abort();
    this.#retire(id);
    return { aborted: true, complete: false };
  }
  close() {
    if (this.#closed) return;
    for (const [id, parser] of this.#active) {
      parser.abort();
      this.#finished.add(id);
    }
    this.#active.clear();
    this.#closed = true;
  }
  summary() {
    return {
      active: this.#active.size,
      terminal: this.#finished.size,
      closed: this.#closed,
      persisted: false,
    };
  }
}
