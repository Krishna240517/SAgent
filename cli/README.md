# SAgent CLI

Node.js 22.13 or newer is required. Build with `npm ci && npm run build`.
The package exposes `sagent`. `sagent --help` works offline.

For projects with dependencies, run `sagent code prepare npm --directory cli`
from this checkout, or choose `python`, `maven`, or `gradle` and the appropriate
workspace-relative directory. Review the displayed container command before
approving network access and package/build scripts. npm requires a lockfile,
Python uses requirements.txt, and Maven/Gradle preparation runs the project's
tests to populate their offline caches.

Subsequent sandbox tests use the prepared image with networking disabled.
Manifest and lockfile changes select a new image and require preparation again.
Run preparation again after changing local dependency source or build logic
outside those files. Preparation has a 15-minute timeout. Sandbox scratch space
is limited to 512 MiB per mount. Prepared-image test containers have a 2 GiB
memory limit and a 256-process/thread limit. Gradle tests have up to ten minutes
to finish. Larger dependency sets may exceed the sandbox limits.

The CLI uses `~/.sagent/` for its local files. Set `SAGENT_API_URL` to override
the development API URL. The API must be running for login, model responses,
and sync. Existing chats remain readable offline.

```text
sagent login                 Open the browser to approve this CLI
sagent chat                  Continue the latest conversation
sagent chat new              Start a conversation
sagent chat list             Refresh and list conversations
sagent chat open <id>        Continue a specific conversation
sagent chat rename <id> <title>
sagent chat remember <text>  Save an explicitly approved preference
sagent chat preferences      List approved preferences
sagent chat decide <text>    Save a decision
sagent sync                  Push queued changes and pull remote changes
sagent sync conflicts        Inspect divergent records
sagent sync resolve <kind> <id> local|remote
sagent whoami                Validate and show the current account
sagent logout                Revoke the session and remove the local token
sagent project inspect       Show branch, revision, language mix, and changes
sagent project register      Register this checkout's stable project ID
sagent project list          List project IDs on your account
sagent project link <id>     Link another checkout to a registered ID
sagent project sync          Sync coding chats and decisions for this project
sagent repo glob <pattern>   List readable source paths
sagent repo search <regex>   Find bounded source matches with line numbers
sagent repo read <path>      Read source lines (optional --start/--end)
sagent repo map [query]      Show a bounded Tree-sitter symbol map
sagent code ask <question>   Ask a read-only question about this repository
sagent code fix <task>       Preview one model-proposed edit, approve it, and run Docker checks
sagent code actions          List recent edit and verification actions
sagent code action <id>      Show a recorded diff or check failure
sagent code list             List local coding conversations
sagent code decide <text>    Record an approved project decision
```

Chat syncs when it opens and after each prompt. If the API is unreachable,
messages stay in the local outbox and `sagent sync` sends them later. A local
history is bound to one account; use a separate SAgent home for another account.
Only chat messages, decisions, and explicitly saved preferences sync. Source
files and environment values remain local.

Coding search bundles Ripgrep. The CLI also bundles Tree-sitter WASM grammars for
JavaScript, TypeScript, TSX, Python, and Java, so installation needs no C++
compiler. Their licenses are included in `assets/tree-sitter/`. Coding questions
send only selected, bounded source excerpts to the model gateway; files stay in
the checkout. Before resuming work on another machine, run `sagent project
check-revision <sha>` against the expected Git commit.

`code fix` requires an interactive terminal, local Linux Docker, and the relevant
preinstalled test image. It proposes one replacement in an existing source file;
you approve its diff before it changes the checkout. SAgent runs matching focused
tests first, then available repository checks in an isolated copy with no network.
If a check fails, the edit remains visible and the CLI reports failure. Use
`code actions` and `code action <id>` to inspect its record. Ordinary chat and
read-only coding questions still work without Docker. Dependency installation in
the sandbox is not supported yet, so projects needing uncached packages may fail
verification.

### Multi-agent coding

Run `sagent code run "fix the parser"` in the checkout. The CLI prints a task
ID before planning. Review the exact patch at the prompt. The supervisor permits
one edit and requires passing sandbox checks and a review without a blocking
finding. Use `sagent code tasks` and `sagent code resume <id>` after a restart.
Role outputs are available through `sagent code actions` and `sagent code action <id>`.

For a handoff before editing, use `sagent code run "fix the parser" --prepare`,
approve the summary, and run `sagent project sync` in both linked checkouts.
Resume the ID at the same Git revision with matching readable files. After
execution begins, approvals and execution checkpoints belong to the original
checkout. Project sync carries the assignment, status and approved summary.
Use `sagent code decide "new policy" --supersedes <decision-id>` to retain the
previous decision while giving future roles the new one.

### MCP connectors

Use `sagent mcp setup hub`, `sagent mcp setup eks`, or `sagent mcp setup kubernetes` for interactive, read-only setup. Have the installed MCP server path and its trusted SHA-256 ready. Hub masks PAT entry and saves a supplied token in `~/.sagent/hub.pat`. An exported `HUB_PAT_TOKEN` takes precedence, followed by the saved PAT and then the private env file. EKS uses an existing AWS CLI profile, and local Kubernetes uses an existing kubeconfig. Setup saves the connection settings locally. Provider authentication is checked when you call an action.

Run `sagent mcp list` to see enabled connectors and `sagent mcp list github` to see actions supported by the connected server. `sagent mcp call github issue '{"issue_number":42}'` reads an issue. On PowerShell, pass the JSON as a single argument. An action takes JSON fields only. The broker supplies the target from your user configuration. Inspect outcomes with `sagent code actions`.

Create `~/.sagent/mcp.json` with only the entries you need. Replace the example paths, identities and SHA-256 values with values from your trusted local installations. Use `Get-FileHash` on Windows or `shasum -a 256` on macOS/Linux. Keep the executables, their dependencies, and this configuration outside the project checkout. These examples use Linux path syntax.

```json
{
  "github": {"account":"your-login","owner":"your-org","repo":"demo","base":"main","branch":"sagent-fix"},
  "docker": {"docker":"/usr/bin/docker","dockerSha256":"<sha256>","daemon":"<engine-id>","account":"yourhubuser","repository":"demo","tag":"dev"},
  "hub": {"server":"/opt/docker-hub-mcp/dist/index.js","sha256":"<sha256>","account":"yourhubuser","repository":"demo"},
  "kubernetes": {"server":"/opt/bin/kubernetes-mcp-server","sha256":"<sha256>","kubectl":"/usr/bin/kubectl","kubeconfig":"/home/user/.kube/sagent","context":"dev","cluster":"dev","namespace":"app","account":"system:serviceaccount:app:sagent"},
  "eks": {"server":"/opt/eks-mcp/bin/awslabs.eks-mcp-server","sha256":"<sha256>","aws":"/usr/local/bin/aws","account":"123456789012","profile":"eks-dev","region":"us-east-1","cluster":"demo","namespace":"app"}
}
```

Each entry starts read-only. Set `"writes":"true"` on an individual entry to expose its write actions. Each invocation still needs interactive approval for the exact arguments and target. A write interrupted after dispatch may already have happened. Inspect the target before retrying.

| Connector | Operations and setup |
| --- | --- |
| GitHub | Official remote MCP endpoint. Use a fine-grained PAT restricted to the selected repository and required permissions. Read a repository, issue or PR. Approved actions can create/update issues, create the configured branch, push files to it and open a PR against the configured base. |
| Local Docker | Set the engine ID from `docker --context default info --format '{{.ID}}'`. Use a local Linux engine. Inspect an image, build a filtered workspace snapshot, start the configured image, delete a container labeled for it, or push the configured image to Docker Hub. A started container persists until removed. |
| Docker Hub | Install the official docker/hub-mcp stdio server into a trusted directory with its lockfile. Inspect a repository, list tags, create a private repository, or update its description. Use a token scoped to those operations. |
| Kubernetes | Install the containers/kubernetes-mcp-server binary and kubectl. Bind the identity with a Role and RoleBinding in the selected namespace. Reads list pods. Approved operations can apply a ConfigMap, delete a named pod, run a fixed identity check in a pod, or confirm a Secret exists with its contents withheld. |
| EKS | Install the AWS Labs EKS MCP server at a pinned version and configure the named AWS profile. Scope its IAM role to the cluster and its Kubernetes RBAC to the namespace. Reads list or inspect pods. An approved delete targets one named pod. |

The CLI reads `SAGENT_GITHUB_MCP_TOKEN` and `HUB_PAT_TOKEN` from the process environment or `~/.sagent/.env`. For development, set `SAGENT_MCP_ENV_FILE` to the absolute path of the private env file containing those placeholders. AWS authentication uses the named profile. Kubernetes uses the configured kubeconfig. Credentials belong on the operator's machine. The action log records the target, operation, and outcome. Connector output is displayed as bounded, untrusted data.

To send one connector read to the model, use `sagent code ask "Summarize issue 42" --mcp-read github.issue --mcp-input '{"issue_number":42}'`. The context engine labels the result with its local action ID and applies the coding context budget.
