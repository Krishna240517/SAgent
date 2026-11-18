export type ToolIntent = "read" | "patch" | "sandbox_test" | "host_shell" | "network" | "credential" | "delete" | "publish" | "remote_write";

export function requireToolPermission(intent: ToolIntent, approvedByUser = false): void {
  if (intent === "read" || intent === "sandbox_test" || (intent === "patch" && approvedByUser)) return;
  throw new Error(intent === "patch" ? "The patch was not approved." : `No trusted ${intent} tool is available to the coding agent.`);
}
