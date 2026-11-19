import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { homedir } from "node:os";

type Args = Record<string, unknown>;
export type Action = { tool: string; omitOutput?: boolean; fields: string[]; write: boolean; bind: (args: Args) => Args };
export type Profile = {
  target: string; secrets?: readonly string[]; writes: boolean; actions: Record<string, Action>;
  transport: () => Transport; verify: () => Promise<void>;
};
export function action(tool: string, fields: string[], fixed: Args, write = false): Action {
  return { tool, fields, write, bind: args => ({ ...args, ...fixed }) };
}
export function pinned(file: string, digest: string) {
  if (!isAbsolute(file) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("Configure an absolute executable path and its SHA-256.");
  const actual = realpathSync(file);
  if (createHash("sha256").update(readFileSync(actual)).digest("hex") !== digest) throw new Error("Local MCP server pin mismatch.");
  return actual;
}
export function stdio(command: string, args: string[], env: Record<string,string> = {}) {
  return new StdioClientTransport({ command, args, env, cwd: homedir(), stderr: "ignore" });
}
export function githubHTTP(token: string) {
  return new StreamableHTTPClientTransport(new URL("https://api.githubcopilot.com/mcp/"), {
    requestInit: { headers: { Authorization: "Bearer " + token }, redirect: "error" }
  });
}

export function display(data: unknown, limit = 16000) {
  return JSON.stringify(data).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c => "\u005c"+"u"+c.charCodeAt(0).toString(16).padStart(4,"0")).slice(0, limit);
}

export async function discover(client: Pick<Client,"listTools">, profile: Profile) {
  const enabled = new Set(Object.values(profile.actions).filter(a => !a.write || profile.writes).map(a => a.tool));
  const schemas = new Map<string,object>();
  let cursor: string | undefined;
  for (let page=0; page<16; page++) {
    const result = await client.listTools({cursor}, {timeout:10000});
    for (const tool of result.tools) if (enabled.has(tool.name)) schemas.set(tool.name, tool.inputSchema);
    if (!result.nextCursor) return schemas;
    cursor = result.nextCursor;
  }
  throw new Error("MCP discovery page limit exceeded.");
}

export async function dispatch(client: Pick<Client,"callTool">, profile: Profile, schemas: Map<string,object>,
  name: string, input: Args, approve: (preview:string)=>Promise<boolean>, audit:(status:string)=>void) {
  audit("pending");
  try {
    if (!Object.hasOwn(profile.actions,name)) throw new Error("Unknown MCP action.");
    const op = profile.actions[name]!;
    if (op.write && !profile.writes) throw new Error("Writes are disabled.");
    if (!input || Array.isArray(input) || typeof input !== "object" || JSON.stringify(input).length>16000 ||
        Object.keys(input).some(k => !op.fields.includes(k))) throw new Error("Invalid fields or target override.");
    const args = op.bind(input);
    const schema = schemas.get(op.tool);
    if (!schema || !new AjvJsonSchemaValidator().getValidator(schema as Record<string,unknown>)(args).valid) throw new Error("Tool unavailable or input fails its schema.");
    const preview = display({target:profile.target, action:name, args}, 32001);
    if (preview.length > 32000) throw new Error("Approval preview exceeds limit.");
    if (op.write && !await approve(preview)) {
      audit("rejected"); return {status:"rejected"};
    }
    await profile.verify();
    const result = await client.callTool({name:op.tool, arguments:args}, undefined,{timeout:60000});
    if (result.isError) throw new Error("Connector reported a tool failure.");
    audit("completed");
    let output = op.omitOutput ? "Result withheld." : JSON.stringify(result.content ?? result.structuredContent ?? []);
    for (const secret of profile.secrets ?? []) if (secret) output = output.replaceAll(secret, "[redacted]");
    return {status:"completed", untrusted:output.replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,"?").slice(0,16000)};
  } catch(error) { audit("failed"); throw error; }
}

export async function connected<T>(profile: Profile, run:(c:Client, schemas:Map<string,object>)=>Promise<T>) {
  const client = new Client({name:"sagent",version:"0.1.0"});
  try {
    await client.connect(profile.transport(),{timeout:10000});
    return await run(client,await discover(client,profile));
  } finally { await client.close(); }
}
