import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node } from "web-tree-sitter";
import { discoverWorkspace, safeSourceFile } from "./workspace.js";

export type SymbolEntry = { path: string; line: number; kind: "definition" | "import"; name: string; signature: string };
const grammar: Record<string, string> = { ".js": "javascript", ".jsx": "javascript", ".ts": "typescript", ".tsx": "tsx", ".py": "python", ".java": "java" };
const definitions = new Set(["function_declaration", "function_definition", "class_declaration", "interface_declaration", "method_definition", "method_declaration", "constructor_declaration", "record_declaration"]);
const imports = new Set(["import_statement", "import_from_statement", "import_declaration"]);

export class SymbolIndex {
  private static ready: Promise<void> | undefined;
  private languages = new Map<string, Language>();
  private cache = new Map<string, { digest: string; symbols: SymbolEntry[] }>();

  constructor(private root: string) {}

  private async language(name: string): Promise<Language> {
    SymbolIndex.ready ||= Parser.init();
    await SymbolIndex.ready;
    let language = this.languages.get(name);
    if (!language) {
      language = await Language.load(fileURLToPath(new URL(`../../assets/tree-sitter/tree-sitter-${name}.wasm`, import.meta.url)));
      this.languages.set(name, language);
    }
    return language;
  }

  async refresh(): Promise<void> {
    const active = new Set<string>();
    // shortcut: parse at most 5,000 source files per refresh; add ranked partial indexing for larger repositories.
    for (const file of discoverWorkspace(this.root).files.filter((item) => grammar[item.slice(item.lastIndexOf(".")).toLowerCase()]).slice(0, 5000)) {
      active.add(file);
      const full = safeSourceFile(this.root, file);
      if (fs.statSync(full).size > 256 * 1024) { this.cache.delete(file); continue; }
      const source = fs.readFileSync(full, "utf8");
      if (source.includes("\0")) { this.cache.delete(file); continue; }
      const digest = createHash("sha256").update(source).digest("hex");
      if (this.cache.get(file)?.digest === digest) continue;
      const language = await this.language(grammar[file.slice(file.lastIndexOf(".")).toLowerCase()]!);
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(source);
      if (!tree) { parser.delete(); throw new Error(`Could not parse ${file}.`); }
      const symbols: SymbolEntry[] = [];
      try {
        function visit(node: Node) {
          if (symbols.length >= 200) return;
          if (imports.has(node.type)) {
            symbols.push({ path: file, line: node.startPosition.row + 1, kind: "import", name: "import", signature: node.text.replace(/\s+/g, " ").slice(0, 180) });
          } else if (definitions.has(node.type)) {
            const name = node.childForFieldName("name")?.text || "";
            const body = node.childForFieldName("body");
            if (name) symbols.push({ path: file, line: node.startPosition.row + 1, kind: "definition", name,
              signature: source.slice(node.startIndex, body?.startIndex ?? node.endIndex).replace(/\s+/g, " ").trim().slice(0, 180) });
          } else if (node.type === "variable_declarator" && ["arrow_function", "function_expression"].includes(node.childForFieldName("value")?.type || "")) {
            symbols.push({ path: file, line: node.startPosition.row + 1, kind: "definition", name: node.childForFieldName("name")?.text || "",
              signature: node.text.split("{")[0]!.replace(/\s+/g, " ").slice(0, 180) });
          }
          for (const child of node.namedChildren) visit(child);
        }
        visit(tree.rootNode);
        this.cache.set(file, { digest, symbols });
      } finally { tree.delete(); parser.delete(); }
    }
    for (const file of this.cache.keys()) if (!active.has(file)) this.cache.delete(file);
  }

  entries(): SymbolEntry[] { return [...this.cache.values()].flatMap((item) => item.symbols); }

  map(query: string, tokenBudget = 4000): string {
    if (!Number.isInteger(tokenBudget) || tokenBudget < 100 || tokenBudget > 20_000) throw new Error("Repository map budget must be 100–20,000 tokens.");
    const terms = query.toLowerCase().match(/[a-z_][a-z_0-9]{2,}/g) || [];
    const groups = new Map<string, SymbolEntry[]>();
    for (const entry of this.entries()) groups.set(entry.path, [...(groups.get(entry.path) || []), entry]);
    const ranked = [...groups].map(([file, entries]) => ({ file, entries,
      score: terms.reduce((total, term) => total + (file.toLowerCase().includes(term) ? 3 : 0) + entries.filter((item) => item.name.toLowerCase().includes(term)).length * 4, 0),
    })).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    let output = "";
    // UTF-8 byte count is a conservative upper bound on model tokens.
    for (const group of ranked) {
      const lines = [`${group.file}:`, ...group.entries.slice(0, 30).map((item) => `  ${item.path}:${item.line} ${item.kind} ${item.signature}`)];
      for (const line of lines) {
        const next = line + "\n";
        if (Buffer.byteLength(output + next) > tokenBudget) return output;
        output += next;
      }
    }
    return output;
  }
}
