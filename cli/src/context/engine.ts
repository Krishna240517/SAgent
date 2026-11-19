import { SymbolIndex } from "../repo/symbols.js";
import { readRange, searchText } from "../repo/tools.js";

export type Role = "planner" | "coder" | "tester" | "reviewer";
export type ContextSource = { id: string; kind: "decision" | "summary" | "message" | "map" | "search" | "file" | "tool" | "external"; content: string };
const scopes: Record<Role, Set<ContextSource["kind"]>> = {
  planner: new Set(["decision", "summary", "message", "map", "search"]),
  coder: new Set(["decision", "summary", "message", "map", "search", "file", "external"]),
  tester: new Set(["decision", "summary", "map", "search", "file", "tool"]),
  reviewer: new Set(["decision", "summary", "map", "search", "file", "tool"]),
};

export function buildContext(request: string, sources: ContextSource[], role: Role, tokenBudget = 16_000) {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 1000 || tokenBudget > 50_000) throw new Error("Context budget must be 1,000–50,000 tokens.");
  const overhead = Buffer.byteLength(request) + 200;
  if (overhead >= tokenBudget) throw new Error("Request exceeds the context budget.");
  const selected: ContextSource[] = [];
  for (const source of sources.filter((item) => scopes[role].has(item.kind)).slice(0, 40)) {
    const item = { ...source, content: source.content.slice(0, 8000) };
    const size = (content: string) => Buffer.byteLength(JSON.stringify({ sources: [...selected, { ...item, content }] })) + overhead;
    if (size(item.content) <= tokenBudget) selected.push(item);
    else {
      let low = 0, high = item.content.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (size(item.content.slice(0, middle) + "…") <= tokenBudget) low = middle;
        else high = middle - 1;
      }
      if (low >= 80) selected.push({ ...item, content: item.content.slice(0, low) + "…" });
      break;
    }
  }
  const context = JSON.stringify({ sources: selected });
  return { context, sourceIds: selected.map((source) => source.id), usedBytes: Buffer.byteLength(context) + overhead };
}

export function collectEvidence(root: string, request: string, index: SymbolIndex): ContextSource[] {
  // shortcut: three identifier-like terms drive search; add model-written queries when natural-language questions miss code.
  const stop = new Set(["where", "which", "what", "does", "this", "that", "with", "from", "called", "implemented", "implementation", "function", "class", "file", "code", "please", "find", "show"]);
  const names = new Set(index.entries().filter((entry) => entry.kind === "definition").map((entry) => entry.name));
  const terms = [...new Set(request.match(/[A-Za-z_][A-Za-z_0-9]{2,}/g) || [])]
    .filter((word) => !stop.has(word.toLowerCase()))
    .sort((a, b) => Number(names.has(b)) - Number(names.has(a)) ||
      Number(/[A-Z_]/.test(b)) - Number(/[A-Z_]/.test(a)) || b.length - a.length)
    .slice(0, 3);
  const found = new Map<string, { path: string; line: number; text: string }>();
  for (const entry of index.entries().filter((entry) => entry.kind === "definition" && terms.includes(entry.name))) {
    found.set(`${entry.path}:${entry.line}`, { path: entry.path, line: entry.line, text: entry.signature });
  }
  const sourcePaths = new Set(index.entries().map((entry) => entry.path));
  for (const term of terms) {
    for (const item of searchText(root, `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, 30)
      .sort((a, b) => Number(sourcePaths.has(b.path)) - Number(sourcePaths.has(a.path)))) {
      found.set(`${item.path}:${item.line}`, item);
    }
  }
  const map = index.map(request, 1600);
  const sources: ContextSource[] = map ? [{ id: "map:repository", kind: "map", content: map }] : [];
  for (const item of [...found.values()].slice(0, 8)) {
    sources.push({ id: `search:${item.path}:${item.line}`, kind: "search", content: item.text });
    const lines = readRange(root, item.path, Math.max(1, item.line - 5), item.line + 5);
    sources.push({ id: `file:${item.path}:${lines[0]!.line}-${lines.at(-1)!.line}`, kind: "file",
      content: lines.map((line) => `${line.line}: ${line.text}`).join("\n") });
  }
  return sources;
}
