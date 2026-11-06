// A small, dependency-free XML reader for UBL e-invoices. Namespaces are dropped
// (cbc:ID → ID): UBL element names are unique enough within their parent.

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

export function parseXml(xml: string): XmlNode | undefined {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml)); ) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length > 1 && stack[stack.length - 1].name === local(m[2])) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  return root.children[0];
}

/** Follows a path of child names, e.g. child(n, "AccountingSupplierParty", "Party"). */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let cur = node;
  for (const p of path) cur = cur?.children.find((c) => c.name === p);
  return cur;
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

export function text(node: XmlNode | undefined, ...path: string[]): string | undefined {
  const t = child(node, ...path)?.text.trim();
  return t ? t : undefined;
}
