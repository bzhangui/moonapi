import { MIMEType } from "node:util";

// Match actual Content-Type against the declared media ranges. More specific
// type/subtype and matching parameters win; declaration order breaks ties.
// MIMEType handles quoted semicolons, casing and whitespace without splitting
// parameter values by hand. This does not perform content sniffing.
export function contentKey(content = {}, actual = "") {
  let parsed;
  try {
    parsed = new MIMEType(actual);
  } catch {
    return undefined;
  }
  let selected,
    best = -1;
  for (const key of Object.keys(content)) {
    let range;
    try {
      range = new MIMEType(key);
    } catch {
      continue;
    }
    if (range.type !== "*" && range.type !== parsed.type) continue;
    if (range.subtype !== "*" && range.subtype !== parsed.subtype) continue;
    if (range.type === "*" && range.subtype !== "*") continue;
    let count = 0,
      matches = true;
    for (const [name, value] of range.params) {
      const received = parsed.params.get(name);
      if (
        received === null ||
        (name === "charset"
          ? received.toLowerCase() !== value.toLowerCase()
          : received !== value)
      ) {
        matches = false;
        break;
      }
      count++;
    }
    const score =
      (range.type === "*" ? 0 : 100000) +
      (range.subtype === "*" ? 0 : 10000) +
      count;
    if (matches && score > best) {
      selected = key;
      best = score;
    }
  }
  return selected;
}
