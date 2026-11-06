// Tiny arithmetic evaluator for template amount expressions, e.g.
// "abs(principal) * commission_pct / 100 + fixed_fee". No eval(): a tokenizer and
// a recursive-descent parser over + - * / ( ), numbers, field names and abs().
// Missing or non-numeric fields count as 0, so a blank "fee" column doesn't break a total.

export type Getter = (field: string) => number | undefined;
export type Compiled = { fields: string[]; evaluate: (get: Getter) => number };

type Token = { type: "num"; value: number } | { type: "id"; value: string } | { type: "op"; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)|([-+*/(),]))/giy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < expr.length) {
    re.lastIndex = pos;
    m = re.exec(expr);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(expr.slice(pos))) break;
      throw new Error(`Bad expression near "${expr.slice(pos)}"`);
    }
    if (m[1] !== undefined) tokens.push({ type: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: "id", value: m[2] });
    else tokens.push({ type: "op", value: m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

type Node = (get: Getter) => number;

export function compile(expr: string): Compiled {
  const tokens = tokenize(expr);
  const fields = new Set<string>();
  let i = 0;
  const peek = () => tokens[i];
  const take = (op?: string) => {
    const t = tokens[i];
    if (!t || (op && !(t.type === "op" && t.value === op))) throw new Error(`Expected "${op ?? "token"}" in "${expr}"`);
    i++;
    return t;
  };

  function primary(): Node {
    const t = peek();
    if (!t) throw new Error(`Unexpected end of "${expr}"`);
    if (t.type === "num") {
      i++;
      return () => t.value;
    }
    if (t.type === "op" && t.value === "(") {
      take("(");
      const inner = sum();
      take(")");
      return inner;
    }
    if (t.type === "op" && t.value === "-") {
      take("-");
      const inner = primary();
      return (g) => -inner(g);
    }
    if (t.type === "id") {
      i++;
      if (t.value === "abs" && peek()?.type === "op" && peek()?.value === "(") {
        take("(");
        const inner = sum();
        take(")");
        return (g) => Math.abs(inner(g));
      }
      fields.add(t.value);
      return (g) => g(t.value) ?? 0;
    }
    throw new Error(`Unexpected "${t.value}" in "${expr}"`);
  }

  function product(): Node {
    let left = primary();
    while (peek()?.type === "op" && (peek()!.value === "*" || peek()!.value === "/")) {
      const op = take().value;
      const right = primary();
      const l = left;
      left = op === "*" ? (g) => l(g) * right(g) : (g) => {
        const d = right(g);
        return d === 0 ? 0 : l(g) / d;
      };
    }
    return left;
  }

  function sum(): Node {
    let left = product();
    while (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = take().value;
      const right = product();
      const l = left;
      left = op === "+" ? (g) => l(g) + right(g) : (g) => l(g) - right(g);
    }
    return left;
  }

  const root = sum();
  if (i !== tokens.length) throw new Error(`Unexpected "${tokens[i].value}" in "${expr}"`);
  return { fields: [...fields], evaluate: (get) => root(get) };
}

const cache = new Map<string, Compiled>();
export function compileCached(expr: string): Compiled {
  let c = cache.get(expr);
  if (!c) cache.set(expr, (c = compile(expr)));
  return c;
}
