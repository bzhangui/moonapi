// Original RFC 9264 / RFC 8288 / RFC 8187 codec. No link is dereferenced.
// https://www.rfc-editor.org/rfc/rfc9264.html#section-4
// https://www.rfc-editor.org/rfc/rfc8288.html#section-3
// https://www.rfc-editor.org/rfc/rfc8187.html#section-3.2.1
// The output is canonical link data, not byte-identical source text. Relative
// URI references remain references unless an explicit baseURI is supplied.
import { isIP } from "node:net";

const own = (value, key) => Object.hasOwn(value ?? {}, key);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const regRelation = /^[a-z][a-z0-9.-]*$/i;
const attrChar = /^[!#$&+.^_`|~0-9A-Za-z-]$/;
const scalarAttrs = new Set(["title", "media", "type"]);
const singletonParams = new Set([
  "rel",
  "anchor",
  "media",
  "title",
  "title*",
  "type",
  "rev",
]);
const fail = (code) => {
  throw new Error("MODERN_LINKSET_" + code);
};
const put = (value, key, item) =>
  Object.defineProperty(value, key, {
    value: item,
    enumerable: true,
    configurable: true,
    writable: true,
  });

function limits(options) {
  if (!object(options)) fail("OPTIONS");
  const result = {};
  for (const [key, fallback, ceiling] of [
    ["maxBytes", 1048576, 1048576],
    ["maxLinks", 4096, 4096],
    ["maxContexts", 1024, 1024],
    ["maxAttributes", 8192, 8192],
  ]) {
    const value = options[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
      fail("OPTIONS");
    result[key] = value;
  }
  if (own(options, "header") && typeof options.header !== "boolean")
    fail("OPTIONS");
  result.header = options.header ?? false;
  result.baseURI = options.baseURI;
  if (result.baseURI !== undefined) uri(result.baseURI, true);
  return result;
}

// RFC 3986 syntax checking, without the normalizations/repairs of WHATWG URL.
// Empty references, non-HTTP schemes, IPvFuture, and empty authorities are legal.
const pchar = "(?:[A-Za-z0-9._~!$&'()*+,;=:@-]|%[A-Fa-f0-9]{2})";
const pathChars = new RegExp("^(?:" + pchar + "|/)*$");
const queryChars = new RegExp("^(?:" + pchar + "|[/?])*$");
const regName = /^(?:[A-Za-z0-9._~!$&'()*+,;=-]|%[A-Fa-f0-9]{2})*$/;
function authority(value) {
  let host = value;
  const at = value.indexOf("@");
  if (at >= 0) {
    if (
      value.indexOf("@", at + 1) >= 0 ||
      !/^(?:[A-Za-z0-9._~!$&'()*+,;=:-]|%[A-Fa-f0-9]{2})*$/.test(
        value.slice(0, at),
      )
    )
      fail("URI");
    host = value.slice(at + 1);
  }
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close < 0 || !/^(?::[0-9]*)?$/.test(host.slice(close + 1))) fail("URI");
    const literal = host.slice(1, close);
    if (
      isIP(literal) !== 6 &&
      !/^v[0-9a-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+$/i.test(literal)
    )
      fail("URI");
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0) {
      if (!/^[0-9]*$/.test(host.slice(colon + 1))) fail("URI");
      host = host.slice(0, colon);
    }
    if (!regName.test(host)) fail("URI");
  }
}
function uri(value, absolute = false) {
  if (
    typeof value !== "string" ||
    value.length > 65536 ||
    /[^\x21-\x7e]/.test(value)
  )
    fail("URI");
  let rest = value;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    if (!queryChars.test(rest.slice(hash + 1))) fail("URI");
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf("?");
  if (query >= 0) {
    if (!queryChars.test(rest.slice(query + 1))) fail("URI");
    rest = rest.slice(0, query);
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rest);
  if (absolute && !scheme) fail("RELATION");
  if (scheme) rest = rest.slice(scheme[0].length);
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
    const slash = rest.indexOf("/");
    authority(slash < 0 ? rest : rest.slice(0, slash));
    rest = slash < 0 ? "" : rest.slice(slash);
  } else if (!scheme && rest.split("/")[0].includes(":")) fail("URI");
  if (!pathChars.test(rest)) fail("URI");
  return value;
}
function relation(value) {
  if (typeof value !== "string" || !value) fail("RELATION");
  if (!regRelation.test(value)) uri(value, true);
  // RFC 8288 defines case-insensitive comparison for both forms.
  const canonical = value.toLowerCase();
  if (canonical === "anchor") fail("RELATION_COLLISION");
  return canonical;
}

const grandfathered = new Set(
  "en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu sgn-be-fr sgn-be-nl sgn-ch-de art-lojban cel-gaulish no-bok no-nyn zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang".split(
    " ",
  ),
);
const languagePattern =
  /^(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?|x(?:-[a-z0-9]{1,8})+)$/i;
function language(value) {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    (!grandfathered.has(value.toLowerCase()) && !languagePattern.test(value))
  )
    fail("LANGUAGE");
  // Grammar-only checking requires no mutable IANA registry or remote lookup.
  // Duplicate extension singletons/variants are not well-formed BCP47 tags.
  const parts = value.toLowerCase().split("-"),
    variants = new Set(),
    extensions = new Set();
  if (!grandfathered.has(value.toLowerCase())) {
    let inExtension = false;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part === "x") break;
      if (part.length === 1) {
        if (extensions.has(part)) fail("LANGUAGE");
        extensions.add(part);
        inExtension = true;
      } else if (
        !inExtension &&
        (part.length >= 5 || /^[0-9][a-z0-9]{3}$/.test(part))
      ) {
        if (variants.has(part)) fail("LANGUAGE");
        variants.add(part);
      }
    }
  }
  return value;
}
function text(value, { ascii = true } = {}) {
  if (
    typeof value !== "string" ||
    value.length > 1048576 ||
    !value.isWellFormed() ||
    /[\x00-\x08\x0a-\x1f\x7f]/.test(value) ||
    (ascii && /[^\x09\x20-\x7e]/.test(value))
  )
    fail("ATTRIBUTE");
  return value;
}
function unicode(value) {
  if (
    typeof value !== "string" ||
    value.length > 1048576 ||
    !value.isWellFormed()
  )
    fail("EXTENDED");
  return value;
}
function quote(value) {
  return '"' + text(value).replace(/["\\]/g, "\\$&") + '"';
}
function extended(value) {
  if (
    !object(value) ||
    !own(value, "value") ||
    Object.keys(value).some((k) => !["value", "language"].includes(k))
  )
    fail("EXTENDED");
  unicode(value.value);
  if (own(value, "language")) language(value.language);
  const bytes = new TextEncoder().encode(value.value);
  let encoded = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    encoded += attrChar.test(c)
      ? c
      : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return "UTF-8'" + (value.language ?? "") + "'" + encoded;
}
function unextended(value, quoted) {
  if (quoted) fail("EXTENDED");
  const match = /^([!#$%&+^_`{}~0-9A-Za-z-]+)'([^']*)'(.*)$/.exec(value);
  if (!match) fail("EXTENDED");
  const [, charset, tag, encoded] = match;
  if (tag) language(tag);
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      if (!/^[A-Fa-f0-9]{2}$/.test(encoded.slice(i + 1, i + 3)))
        fail("EXTENDED");
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      if (!attrChar.test(encoded[i])) fail("EXTENDED");
      bytes.push(encoded.charCodeAt(i));
    }
  }
  let decoded;
  if (/^utf-8$/i.test(charset)) {
    try {
      decoded = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(new Uint8Array(bytes));
    } catch {
      fail("UTF8");
    }
  } else if (/^iso-8859-1$/i.test(charset)) {
    // TextDecoder('latin1') uses Windows-1252; RFC legacy bytes must not.
    decoded = bytes.map((b) => String.fromCharCode(b)).join("");
  } else fail("CHARSET");
  unicode(decoded);
  const result = { value: decoded };
  if (tag) result.language = tag;
  return result;
}
function resolveURI(value, baseURI) {
  uri(value);
  if (baseURI === undefined) return value;
  // RFC3986 generic resolution, not WHATWG repairs or an HTTP access.
  const split = (s) => {
    const m =
      /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(
        s,
      );
    return {
      scheme: m[1],
      authority: m[2],
      path: m[3],
      query: m[4],
      fragment: m[5],
    };
  };
  const dots = (source) => {
    let input = source,
      output = "";
    while (input) {
      if (input.startsWith("../")) input = input.slice(3);
      else if (input.startsWith("./")) input = input.slice(2);
      else if (input.startsWith("/./")) input = input.slice(2);
      else if (input === "/.") input = "/";
      else if (input.startsWith("/../") || input === "/..") {
        input = input === "/.." ? "/" : input.slice(3);
        output = output.slice(0, Math.max(0, output.lastIndexOf("/")));
      } else if (input === "." || input === "..") input = "";
      else {
        const end = input.indexOf("/", input.startsWith("/") ? 1 : 0);
        output += end < 0 ? input : input.slice(0, end);
        input = end < 0 ? "" : input.slice(end);
      }
    }
    return output;
  };
  const ref = split(value),
    base = split(baseURI),
    target = { ...ref };
  if (ref.scheme !== undefined) target.path = dots(ref.path);
  else {
    target.scheme = base.scheme;
    if (ref.authority !== undefined) target.path = dots(ref.path);
    else {
      target.authority = base.authority;
      if (!ref.path) {
        target.path = base.path;
        if (ref.query === undefined) target.query = base.query;
      } else
        target.path = dots(
          ref.path.startsWith("/")
            ? ref.path
            : (base.authority !== undefined && !base.path
                ? "/"
                : base.path.slice(0, base.path.lastIndexOf("/") + 1)) +
                ref.path,
        );
    }
  }
  return (
    target.scheme +
    ":" +
    (target.authority === undefined ? "" : "//" + target.authority) +
    target.path +
    (target.query === undefined ? "" : "?" + target.query) +
    (target.fragment === undefined ? "" : "#" + target.fragment)
  );
}
function attribute(name, value) {
  if (!token.test(name) || ["href", "rel", "anchor", "rev"].includes(name))
    fail("ATTRIBUTE_NAME");
  if (scalarAttrs.has(name)) {
    if (name === "title") unicode(value);
    else text(value);
    if (
      name === "type" &&
      !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/.test(
        value,
      )
    )
      fail("TYPE");
    return;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 8192)
    fail("ATTRIBUTE");
  for (const item of value) {
    if (name.endsWith("*")) extended(item);
    else if (name === "hreflang") language(item);
    else unicode(item);
  }
}

/** Encode RFC9264 JSON link data as ASCII application/linkset / Link field text.
 * Multiple title* alternatives become separate links because RFC8288 permits
 * one title* per link-value. No language alternative is silently dropped.
 */
export function encodeLinkset(value, options = {}) {
  const budget = limits(options),
    output = [];
  let bytes = 0,
    attrs = 0;
  if (
    !object(value) ||
    Object.keys(value).some((k) => k !== "linkset") ||
    !Array.isArray(value.linkset)
  )
    fail("MODEL");
  if (value.linkset.length > budget.maxContexts) fail("CONTEXT_LIMIT");
  for (const context of value.linkset) {
    if (!object(context)) fail("MODEL");
    const anchor = own(context, "anchor")
      ? resolveURI(context.anchor, budget.baseURI)
      : budget.baseURI;
    if (!Object.keys(context).some((name) => name !== "anchor")) fail("MODEL");
    for (const [name, targets] of Object.entries(context)) {
      if (name === "anchor") continue;
      const rel = relation(name);
      if (!Array.isArray(targets) || targets.length === 0) fail("MODEL");
      for (const target of targets) {
        if (!object(target) || !own(target, "href")) fail("MODEL");
        const href = resolveURI(target.href, budget.baseURI),
          normalized = {};
        for (const [raw, item] of Object.entries(target)) {
          if (raw === "href") continue;
          const key = raw.toLowerCase();
          if (own(normalized, key)) fail("ATTRIBUTE_COLLISION");
          attribute(key, item);
          put(normalized, key, item);
        }
        // An extension's internationalized form denotes the same abstract
        // target attribute. Canonicalize Unicode/plain-control values into
        // that RFC8187 form rather than emitting forbidden non-ASCII bytes.
        for (const [key, items] of Object.entries(normalized)) {
          if (scalarAttrs.has(key) || key === "hreflang" || key.endsWith("*"))
            continue;
          const plain = items.filter((item) => !/[^\x09\x20-\x7e]/.test(item));
          const encoded = items
            .filter((item) => /[^\x09\x20-\x7e]/.test(item))
            .map((value) => ({ value }));
          if (encoded.length) {
            if (plain.length) put(normalized, key, plain);
            else delete normalized[key];
            put(normalized, key + "*", [
              ...(normalized[key + "*"] ?? []),
              ...encoded,
            ]);
          }
        }
        let title = normalized.title,
          titles = normalized["title*"] ?? [undefined];
        if (typeof title === "string" && /[^\x09\x20-\x7e]/.test(title)) {
          if (own(normalized, "title*")) fail("NON_ASCII_FALLBACK");
          titles = [{ value: title }];
          title = undefined;
        }
        for (const titleVariant of titles) {
          if (output.length >= budget.maxLinks) fail("LINK_LIMIT");
          let wire = "<" + href + ">; rel=" + quote(rel);
          if (++attrs > budget.maxAttributes) fail("ATTRIBUTE_LIMIT");
          if (anchor !== undefined) wire += "; anchor=" + quote(anchor);
          if (anchor !== undefined && ++attrs > budget.maxAttributes)
            fail("ATTRIBUTE_LIMIT");
          for (const [key, item] of Object.entries(normalized)) {
            if (key === "title*") continue;
            if (key === "title" && title === undefined) continue;
            const items = scalarAttrs.has(key) ? [item] : item;
            for (const member of items) {
              if (++attrs > budget.maxAttributes) fail("ATTRIBUTE_LIMIT");
              wire +=
                "; " +
                key +
                "=" +
                (key.endsWith("*") ? extended(member) : quote(member));
            }
          }
          if (titleVariant !== undefined) {
            if (++attrs > budget.maxAttributes) fail("ATTRIBUTE_LIMIT");
            wire += "; title*=" + extended(titleVariant);
          }
          bytes += wire.length + (output.length ? 2 : 0);
          if (bytes > budget.maxBytes) fail("BYTE_LIMIT");
          output.push(wire);
        }
      }
    }
  }
  return output.join(", ");
}

/** Decode strict ASCII Link text. Malformed messages fail closed, not partially.
 * RFC8288's mandatory first-occurrence rules apply to singleton parameters.
 * Newlines are legal only in standalone whitespace, never in field mode or
 * quoted values / URI references. Unknown target attributes remain repeatable.
 */
export function decodeLinkset(source, options = {}) {
  const budget = limits(options);
  let sourceText;
  if (typeof source === "string") sourceText = source;
  else if (source instanceof Uint8Array) {
    if (source.byteLength > budget.maxBytes) fail("BYTE_LIMIT");
    try {
      sourceText = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(source);
    } catch {
      fail("UTF8");
    }
  } else fail("TEXT");
  if (sourceText.length > budget.maxBytes) fail("BYTE_LIMIT");
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(sourceText)) fail("ASCII");
  if (budget.header && /[\r\n]/.test(sourceText)) fail("HEADER_NEWLINE");
  let i = 0,
    links = 0,
    attrs = 0;
  const contexts = new Map(),
    result = { linkset: [] };
  const whitespace = () => {
    while (/[ \t\r\n]/.test(sourceText[i] ?? "") && i < sourceText.length) i++;
  };
  const readToken = () => {
    const start = i;
    while (i < sourceText.length && token.test(sourceText[i])) i++;
    if (i === start) fail("SYNTAX");
    return sourceText.slice(start, i);
  };
  const quoted = () => {
    i++;
    let result = "";
    while (i < sourceText.length) {
      const c = sourceText[i++];
      if (c === '"') return result;
      if (c === "\r" || c === "\n") fail("SYNTAX");
      if (c === "\\") {
        if (i >= sourceText.length || /[\r\n]/.test(sourceText[i]))
          fail("SYNTAX");
        result += sourceText[i++];
      } else result += c;
    }
    fail("SYNTAX");
  };
  const append = (anchor, rel, target) => {
    const key = anchor === undefined ? null : anchor;
    let context = contexts.get(key);
    if (!context) {
      if (contexts.size >= budget.maxContexts) fail("CONTEXT_LIMIT");
      context = {};
      if (anchor !== undefined) put(context, "anchor", anchor);
      contexts.set(key, context);
      result.linkset.push(context);
    }
    if (++links > budget.maxLinks) fail("LINK_LIMIT");
    if (!own(context, rel)) put(context, rel, []);
    context[rel].push(target);
  };
  while (i < sourceText.length) {
    whitespace();
    // RFC9110's #list tolerates empty list elements at either edge or middle.
    if (sourceText[i] === ",") {
      i++;
      continue;
    }
    if (i === sourceText.length) break;
    if (sourceText[i++] !== "<") fail("SYNTAX");
    const start = i,
      end = sourceText.indexOf(">", i);
    if (end < 0) fail("SYNTAX");
    const href = resolveURI(sourceText.slice(start, end), budget.baseURI);
    i = end + 1;
    const params = new Map();
    while (true) {
      whitespace();
      if (i === sourceText.length || sourceText[i] === ",") break;
      if (sourceText[i++] !== ";") fail("SYNTAX");
      whitespace();
      const name = readToken().toLowerCase();
      whitespace();
      let value = "",
        wasQuoted = false;
      if (sourceText[i] === "=") {
        i++;
        whitespace();
        wasQuoted = sourceText[i] === '"';
        value = wasQuoted ? quoted() : readToken();
      }
      if (++attrs > budget.maxAttributes) fail("ATTRIBUTE_LIMIT");
      if (singletonParams.has(name) && params.has(name)) continue;
      if (name.endsWith("*")) value = unextended(value, wasQuoted);
      if (!params.has(name)) params.set(name, []);
      params.get(name).push(value);
    }
    if (!params.has("rel")) fail("RELATION");
    const rawRelations = params.get("rel")[0];
    if (
      !rawRelations ||
      rawRelations.trim() !== rawRelations ||
      /[^\x20-\x7e]/.test(rawRelations)
    )
      fail("RELATION");
    const relations = rawRelations.split(/ +/).map(relation);
    const anchor = params.has("anchor")
      ? resolveURI(params.get("anchor")[0], budget.baseURI)
      : budget.baseURI;
    const target = { href };
    for (const [name, values] of params) {
      if (["rel", "anchor", "rev"].includes(name)) continue;
      const value = scalarAttrs.has(name) ? values[0] : values;
      attribute(name, value);
      put(target, name, value);
    }
    // Deprecated rev still denotes inverse links. Serialize its abstract form
    // as direct links; an anonymous context cannot supply the reverse target.
    for (const rel of relations) append(anchor, rel, structuredClone(target));
    if (params.has("rev")) {
      if (anchor === undefined) fail("REVERSE_CONTEXT");
      const reversed = { ...target, href: anchor };
      for (const rel of params.get("rev")[0].split(/ +/).map(relation))
        append(href, rel, structuredClone(reversed));
    }
  }
  return result;
}
