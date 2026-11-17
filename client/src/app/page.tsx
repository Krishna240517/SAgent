"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, GitFork, Sparkles, ArrowUpRight, Check } from "lucide-react";
import "./globals.css";

const installCommands = {
  "macos-linux": 'curl -fsSL https://sagent.dev/install.sh | bash',
  powershell: 'irm https://sagent.dev/install.sh | iex',
  cmd: 'curl -fsSL https://sagent.dev/install.sh -o install.cmd && install.cmd && del install.cmd',
};

const bentoCards = [
  {
    id: "ast-reasoning",
    icon: "account_tree",
    title: "Autonomous Multi-file Reasoning",
    subtitle: "Autonomous AST Engine",
    description: "Instead of trivial single-file edits, SAGENT constructs an in-memory dependency DAG. When an interface changes, it traverses references, updates callers, and refactors migrations in parallel.",
    accent: "from-emerald-500 to-cyan-500",
    accentColor: "#10b981",
    wide: true,
    visual: (
      <div className="bg-zinc-900/50 p-4 rounded-lg flex flex-col gap-3 text-xs">
        <div className="flex items-center justify-between text-zinc-500">
          <span>Dependency Reconciliation Engine</span>
          <span className="font-mono text-emerald-400">0.03ms per node</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-800/50 p-2 rounded text-zinc-100">AST Parse</div>
          <div className="bg-zinc-800/50 p-2 rounded text-cyan-400">Symbol Index</div>
          <div className="bg-zinc-800/50 p-2 rounded text-emerald-400">Diff Plan</div>
        </div>
      </div>
    ),
  },
  {
    id: "verification-loop",
    icon: "sync_saved_locally",
    title: "In-Terminal Verification Loop",
    subtitle: "Self-Correcting",
    description: "Catches syntax errors, compiler warnings, and failing assertions immediately. When a test breaks, SAGENT reads the stderr, forms a diagnosis, and patches the file automatically.",
    accent: "from-cyan-500 to-blue-500",
    accentColor: "#06b6d4",
    visual: (
      <div className="flex items-center gap-2 text-cyan-400 text-xs mt-auto">
        <span className="material-symbols-outlined text-[16px]">check_circle</span>
        <span>Zero human intervention required</span>
      </div>
    ),
  },
  {
    id: "zero-context",
    icon: "terminal",
    title: "Zero Context Switching",
    subtitle: "Tmux & Neovim Ready",
    description: "Never leave your terminal. Operates over pipes, stdin/stdout, and headless socket demons. Works seamlessly within your tmux splits, zsh aliases, and IDE terminal drawers.",
    accent: "from-indigo-500 to-purple-500",
    accentColor: "#6366f1",
    visual: (
      <div className="flex items-center gap-2 text-zinc-100 font-mono text-xs">
        <span className="text-cyan-400">$</span> cat logs.txt | sagent fix
      </div>
    ),
  },
  {
    id: "sandboxed",
    icon: "shield",
    title: "Sandboxed Native Execution",
    subtitle: "Atomic Snapshots",
    description: "Every file modification creates an atomic rollback tree in memory. If an autonomous patch fails or an anomalous command executes, you revert with a single keypress.",
    accent: "from-emerald-500 to-teal-500",
    accentColor: "#10b981",
    visual: (
      <div className="flex items-center gap-2 text-emerald-400 text-xs">
        <span className="material-symbols-outlined text-[16px]">history</span>
        <span>Instant undo via git shadow ref</span>
      </div>
    ),
  },
  {
    id: "semantic-graph",
    icon: "hub",
    title: "Semantic Codebase Graph",
    subtitle: "Local Vector Index",
    description: "Instant local vector embedding across 1,000,000+ lines of code without leaving your machine. Queries resolve in sub-millisecond ranges using SIMD-accelerated vectors.",
    accent: "from-cyan-500 to-blue-500",
    accentColor: "#06b6d4",
    visual: (
      <div className="flex items-center gap-2 text-cyan-400 text-xs">
        <span className="material-symbols-outlined text-[16px]">memory</span>
        <span>Zero cloud embedding cost</span>
      </div>
    ),
  },
];

const metrics = [
  { label: "Planning Latency", value: "180ms", detail: "Rust native tokenizer", icon: "speed", color: "text-emerald-400" },
  { label: "SWE-Bench Lite", value: "84.2%", detail: "State-of-the-art verified", icon: "verified", color: "text-emerald-400" },
  { label: "Code Context", value: "1.2M LOC", detail: "Local vectorized graph", icon: "memory", color: "text-cyan-400" },
  { label: "Zero Exfiltration", value: "100% Local", detail: "Air-gap LLM compliant", icon: "lock", color: "text-indigo-400" },
];

const benchmarks = [
  { name: "SAGENT Autonomous CLI (v1.4)", value: 84.2, color: "from-emerald-500 to-cyan-500", current: true },
  { name: "Cloud Browser AI Coding Assistants", value: 52.8, color: "from-zinc-600 to-zinc-500", current: false },
  { name: "Copy-Paste Chatbot LLM Interfaces", value: 31.4, color: "from-zinc-700 to-zinc-600", current: false },
];

const steps = [
  { num: "01", title: "Synthesize", desc: "Consumes your issue prompt or prompt flags. Scans existing interfaces and generates concrete execution steps.", icon: "psychology", label: "DAG Planner", color: "bg-emerald-500 text-zinc-950" },
  { num: "02", title: "Mutate", desc: "Applies precise line and AST level edits across targeted files with complete snapshot rollback buffering.", icon: "edit_note", label: "Native AST Write", color: "bg-cyan-500 text-zinc-950" },
  { num: "03", title: "Validate", desc: "Triggers your configured test suites, linting rules, and typecheckers in sandbox. Auto-repairs broken assumptions.", icon: "flaky", label: "Self-Correction", color: "bg-indigo-500 text-white" },
  { num: "04", title: "Commit", desc: "Generates an atomic, conventional commit with linked issues and descriptive diff summaries ready for git push.", icon: "commit", label: "Git Staging", color: "bg-emerald-500 text-zinc-950" },
];

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="font-mono text-xl font-bold tracking-tight text-zinc-100">SAGENT</div>
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Features</a>
          <a href="#workflow" className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Workflow</a>
          <a href="#benchmarks" className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Benchmarks</a>
          <a href="#docs" className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Docs</a>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors border border-zinc-800 rounded-lg hover:border-zinc-700">
            <GitFork className="w-4 h-4" />
            Star
          </a>
        </div>
      </div>
    </nav>
  );
}

function MouseLitGrid() {
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setMousePos({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div
      ref={gridRef}
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        backgroundImage: `
          radial-gradient(circle 600px at ${mousePos.x}% ${mousePos.y}%, rgba(16, 185, 129, 0.08), rgba(6, 182, 212, 0.03) 25%, transparent 60%),
          linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 32px 32px, 32px 32px",
      }}
    />
  );
}

function HeroSection({ heroRef }: { heroRef: React.RefObject<HTMLDivElement | null> }) {
  const [activeTab, setActiveTab] = useState<keyof typeof installCommands>("macos-linux");
  const [copied, setCopied] = useState<keyof typeof installCommands | null>(null);

  const copyCommand = async (cmd: string, key: keyof typeof installCommands) => {
    await navigator.clipboard.writeText(cmd);
    setCopied(key);
    setTimeout(() => setCopied(null), 2400);
  };

  return (
    <section ref={heroRef} className="relative pt-32 pb-28 px-6 max-w-7xl mx-auto">
      <div className="text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-zinc-950/80 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)] mb-8 backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-80" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-mono text-sm uppercase tracking-wider text-zinc-100 font-semibold">
            v1.4.0 Engine Unleashed • <span className="text-cyan-400 font-mono">Bun & Rust Powered</span>
          </span>
          <span className="material-symbols-outlined text-emerald-400 text-[14px]">bolt</span>
        </div>
        <h1 className="text-5xl md:text-[54px] lg:text-[64px] font-bold tracking-tight mb-6 bg-gradient-to-r from-zinc-100 via-zinc-300 to-zinc-100 bg-clip-text text-transparent font-[Plus_Jakarta_Sans]">
          Autonomous CLI Coding Agent that executes{" "}
          <span className="bg-gradient-to-r from-emerald-500 via-cyan-500 to-emerald-500 bg-clip-text text-transparent">
            directly in your shell
          </span>.
        </h1>
        <p className="text-xl md:text-2xl text-zinc-400 mb-12 max-w-2xl mx-auto leading-relaxed">
          Plans, edits, and verifies code natively in your terminal. Zero web tab switching. Full atomic execution with automated test self-correction.
        </p>

        <div className="w-full max-w-xl flex flex-col sm:flex-row items-center gap-3 bg-zinc-950/80 p-2 rounded-xl shadow-2xl mb-16 backdrop-blur-xl border border-zinc-800/50">
          <div className="flex items-center gap-2 w-full px-4 py-2 overflow-x-auto bg-zinc-900/50 rounded-lg">
            <span className="text-emerald-400 font-mono text-sm select-none font-bold">$</span>
            <code className="font-mono text-sm text-zinc-100 whitespace-nowrap">{installCommands[activeTab]}</code>
          </div>
          <button
            onClick={() => copyCommand(installCommands[activeTab], activeTab)}
            className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-mono text-sm uppercase font-semibold transition-all shadow-[0_0_16px_rgba(16,185,129,0.35)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">{copied === activeTab ? "check" : "content_copy"}</span>
            <span>{copied === activeTab ? "Copied to Clipboard!" : "Copy Command"}</span>
          </button>
        </div>

        <div className="w-full max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-3 mb-16">
          {metrics.map((metric, i) => (
            <div key={i} className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-lg flex flex-col items-center text-center shadow-lg backdrop-blur-sm">
              <span className="font-mono text-xs text-zinc-500 uppercase mb-1">{metric.label}</span>
              <span className="text-2xl font-bold font-mono {metric.color}">{metric.value}</span>
              <span className="font-mono text-xs text-zinc-500 mt-1">{metric.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TerminalDemo() {
  const [activeTab, setActiveTab] = useState<"plan" | "edit" | "verify" | "diff">("plan");
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    if (!autoRotate) return;
    const interval = setInterval(() => {
      const tabs: ("plan" | "edit" | "verify" | "diff")[] = ["plan", "edit", "verify", "diff"];
      setActiveTab((current) => tabs[(tabs.indexOf(current) + 1) % tabs.length]);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoRotate]);

  const tabs = [
    { id: "plan" as const, label: "1. Plan", content: TerminalPlanContent },
    { id: "edit" as const, label: "2. Edit", content: TerminalEditContent },
    { id: "verify" as const, label: "3. Verify", content: TerminalVerifyContent },
    { id: "diff" as const, label: "4. Diff", content: TerminalDiffContent },
  ];

  return (
    <section id="workflow" className="py-20 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">See It In Action</h2>
        <p className="text-zinc-500 max-w-2xl mx-auto">Real terminal output from SAGENT autonomously completing a task</p>
      </div>

      <div className="bg-zinc-950/80 border border-zinc-800/50 rounded-2xl overflow-hidden shadow-2xl max-w-5xl mx-auto backdrop-blur-xl relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="bg-zinc-900/80 px-5 py-3 flex items-center justify-between border-b border-zinc-800/50 backdrop-blur-sm relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-zinc-500 font-mono text-sm ml-2">sagent-cli — session: #9042-omega</span>
          </div>
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setAutoRotate(false); }}
                className={`px-4 py-1 rounded font-mono text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-2 font-mono text-sm text-emerald-400">
            <span className="material-symbols-outlined text-[14px]">sensors</span>
            <span>ONLINE</span>
          </div>
        </div>

        <div className="p-6 font-mono text-sm text-zinc-200 min-h-[340px] flex flex-col justify-between">
          <div className="flex flex-col gap-3">
            <TerminalPlanContent />
            <TerminalEditContent />
            <TerminalVerifyContent />
            <TerminalDiffContent />
          </div>

          <div className="flex items-center justify-between pt-4 mt-4 text-zinc-500 font-mono text-sm border-t border-zinc-800/50">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                AGENT IDLE
              </span>
              <span>Mem: 42MB</span>
              <span>Tokens: 3.4k in / 812 out</span>
            </div>
            <span className="text-cyan-400">Ctrl+Space to summon</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TerminalPlanContent() {
  return (
    <div className="terminal-pane flex flex-col gap-3">
      <div className="text-zinc-500 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">{">"}</span>
        <span className="text-cyan-400 font-semibold">sagent plan</span>
        <span className="text-zinc-200">&quot;Refactor AuthMiddleware to support ECDSA token rotation and add regression suite&quot;</span>
      </div>
      <div className="text-zinc-500 mt-2">[00:00.04] Indexing abstract syntax tree across 142 repository files...</div>
      <div className="text-zinc-500">[00:00.12] Found 3 reference sinks in <span className="text-zinc-200">src/middleware/auth.rs</span> and <span className="text-zinc-200">src/crypto/keys.rs</span></div>
      <div className="bg-zinc-900/50 p-4 rounded-lg mt-3 flex flex-col gap-1">
        <span className="text-cyan-400 font-semibold">PLAN MANIFEST DECLARED:</span>
        <span className="text-zinc-200 flex items-center gap-2"><span className="text-emerald-400">✓</span> Step 1: Ingest ECDSA secp256k1 key verification helper via ring crate</span>
        <span className="text-zinc-200 flex items-center gap-2"><span className="text-emerald-400">✓</span> Step 2: Inject non-blocking async keyring cache with TTL invalidation</span>
        <span className="text-zinc-200 flex items-center gap-2"><span className="text-emerald-400">✓</span> Step 3: Implement unit mocks for expired, malformed, and valid rotations</span>
        <span className="text-zinc-200 flex items-center gap-2"><span className="text-emerald-400">✓</span> Step 4: Run cargo test --test auth_integration and auto-heal test panics</span>
      </div>
      <div className="text-emerald-400 font-semibold mt-2 flex items-center gap-2">
        <span className="animate-pulse">•</span> Executing autonomous tool invocation: FilePatcher(src/middleware/auth.rs)
      </div>
    </div>
  );
}

function TerminalEditContent() {
  return (
    <div className="terminal-pane flex flex-col gap-3 hidden">
      <div className="text-zinc-500 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">{">"}</span>
        <span className="text-cyan-400 font-semibold">sagent edit</span>
        <span className="text-zinc-200">Applying atomic AST rewrite on <code>src/middleware/auth.rs</code></span>
      </div>
      <pre className="bg-zinc-950 p-4 rounded-lg mt-3 font-mono text-xs overflow-x-auto">
{`@@ -34,7 +34,14 @@ pub async fn verify_jwt(token: &str, state: &AppState) -> Result<claims, autherror> {
  let key = state.static_hmac_secret.as_bytes();
  jwt::decode::<claims>(token, &DecodingKey::from_secret(key), &Validation::default())?
+   let kid = jwt::header(token)?.kid.ok_or(AuthError::MissingKeyId)?;
+   let pub_key = state.keyring.fetch_rotated_ecdsa(&kid).await?;
+   let claims = jwt::decode::<claims>(token, &pub_key.decoding_key, &Validation::new(Algorithm::ES256))?;
+   state.telemetry.record_auth_success(&claims.sub);
+   Ok(claims)
 }`}
      </pre>
      <div className="text-cyan-400 text-xs mt-2">✓ Symbol consistency check passed. No hanging borrows detected.</div>
    </div>
  );
}

function TerminalVerifyContent() {
  return (
    <div className="terminal-pane flex flex-col gap-3 hidden">
      <div className="text-zinc-500 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">{">"}</span>
        <span className="text-cyan-400 font-semibold">sagent verify</span>
        <span className="text-zinc-200">Running native test harnesses & benchmark fixtures</span>
      </div>
      <div className="text-zinc-500 mt-2">[00:01.02] Invoking cargo test --lib -- --nocapture</div>
      <div className="bg-zinc-900/50 p-4 rounded-lg flex flex-col gap-1 font-mono text-xs">
        <div className="text-zinc-200">test crypto::keys::tests::test_empty_kid_rejection ... <span className="text-emerald-400 font-bold">ok</span></div>
        <div className="text-zinc-200">test middleware::auth::tests::test_expired_ecdsa_signature ... <span className="text-emerald-400 font-bold">ok</span></div>
        <div className="text-zinc-200">test middleware::auth::tests::test_concurrent_key_rotation_under_load ... <span className="text-emerald-400 font-bold">ok (14,290 req/s)</span></div>
        <div className="text-zinc-200">test middleware::auth::tests::test_malformed_token_header ... <span className="text-emerald-400 font-bold">ok</span></div>
      </div>
      <div className="text-emerald-400 font-semibold mt-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[16px]">verified</span> 4/4 verification targets succeeded (0 retries required, 0 compiler panics).
      </div>
    </div>
  );
}

function TerminalDiffContent() {
  return (
    <div className="terminal-pane flex flex-col gap-3 hidden">
      <div className="text-zinc-500 flex items-center gap-2">
        <span className="text-emerald-400 font-bold">{">"}</span>
        <span className="text-cyan-400 font-semibold">sagent commit-preview</span>
        <span className="text-zinc-200">Branch: feat/ecdsa-rotation-verified</span>
      </div>
      <div className="bg-zinc-900/50 p-4 rounded-lg mt-3 flex flex-col gap-2 font-mono text-xs">
        <div className="flex justify-between text-zinc-500">
          <span>2 files changed, 48 insertions(+), 8 deletions(-)</span>
          <span className="text-emerald-400">Commit Cleanliness: 100%</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500" style={{ width: "85%" }} />
          <div className="h-full bg-red-500" style={{ width: "15%" }} />
        </div>
        <span className="text-zinc-200 mt-1">commit c8fa2b1 (&quot;feat(auth): integrate ECDSA token key-rotation with zero alloc caching&quot;)</span>
      </div>
      <div className="text-cyan-400 font-semibold mt-2">✓ Ready to push. Staged cleanly in your native git index.</div>
    </div>
  );
}

function BentoCard({ card, delay }: { card: typeof bentoCards[0]; delay: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative bg-zinc-950/50 border border-zinc-800/50 rounded-2xl p-6 transition-all duration-500 overflow-hidden ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${card.wide ? "md:col-span-2" : ""}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0.5 rounded-[1.875rem] bg-gradient-to-br from-transparent via-white/10 to-transparent" />
        <div className={`absolute inset-0.5 rounded-[1.875rem] bg-gradient-to-br ${card.accent} opacity-30`} />
      </div>
      <div className={`absolute inset-0 ${isHovered ? "translate-x-full" : "-translate-x-full"} transition-transform duration-700 ease-out pointer-events-none`} aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-15deg]" />
      </div>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-5">
          <div className={`w-10 h-10 rounded-lg bg-zinc-900/50 flex items-center justify-center shadow-[0_0_12px_${card.accentColor}40]`}>
            <span className="material-symbols-outlined text-[24px] text-emerald-400">{card.icon}</span>
          </div>
          <span className="font-mono text-xs text-cyan-400 bg-zinc-900/50 px-3 py-1 rounded-full">{card.subtitle}</span>
        </div>
        <h3 className="text-lg font-semibold mb-2 text-zinc-100 group-hover:text-emerald-400 transition-colors duration-300">{card.title}</h3>
        <p className="text-zinc-500 text-sm leading-relaxed mb-5 flex-1">{card.description}</p>
        <div className="pt-4 border-t border-zinc-800/50">
          {card.visual}
        </div>
      </div>
    </div>
  );
}

function FeaturesSection({ featuresRef }: { featuresRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={featuresRef} id="features" className="py-20 px-6 max-w-7xl mx-auto">
      <div className="max-w-3xl mb-16">
        <span className="font-mono text-xs text-emerald-400 uppercase font-bold tracking-widest">Built For Terminal Purists</span>
        <h2 className="text-3xl md:text-4xl font-bold text-zinc-100 mt-2 font-semibold">Sovereign engineering workflow with complete systemic autonomy.</h2>
        <p className="text-zinc-500 mt-2">Designed around UNIX philosophies: compose small fast tools, stream stdio cleanly, and run directly where your code lives.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-7xl mx-auto">
        {bentoCards.map((card, i) => (
          <BentoCard key={card.id} card={card} delay={i * 80} />
        ))}
      </div>
    </section>
  );
}

function StepsSection() {
  return (
    <section id="workflow" className="py-20 px-6 max-w-7xl mx-auto bg-zinc-950/40">
      <div className="max-w-4xl mx-auto text-center mb-16">
        <span className="font-mono text-xs text-cyan-400 uppercase font-bold tracking-widest">Deterministic Architecture</span>
        <h2 className="text-3xl md:text-4xl font-bold text-zinc-100 mt-2 font-semibold">The 4-Stage Autonomous Lifecycle</h2>
        <p className="text-zinc-500 mt-2">How SAGENT turns fuzzy prompt instructions into bulletproof, compiler-verified code changes.</p>
      </div>
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-4 relative">
        {steps.map((step, i) => (
          <div key={step.num} className="bg-zinc-950/50 border border-zinc-800/50 p-6 rounded-xl shadow-md flex flex-col items-start hover:bg-zinc-900/80 transition-colors">
            <span className={`w-7 h-7 rounded ${step.color} font-mono text-sm flex items-center justify-center font-bold mb-4`}>{step.num}</span>
            <h4 className="text-lg font-semibold text-zinc-100 font-semibold">{step.title}</h4>
            <p className="text-zinc-500 text-sm mt-2 mb-4">{step.desc}</p>
            <div className="mt-auto flex items-center gap-1 text-emerald-400 font-mono text-xs">
              <span className="material-symbols-outlined text-[14px]">{step.icon}</span>
              <span>{step.label}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BenchmarksSection({ metricsRef }: { metricsRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <section ref={metricsRef} id="benchmarks" className="py-20 px-6 max-w-7xl mx-auto">
      <div className="max-w-5xl mx-auto bg-zinc-950/50 border border-zinc-800/50 p-8 rounded-2xl shadow-2xl flex flex-col gap-8 backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs text-emerald-400 uppercase font-bold tracking-widest">Empirical Superiority</span>
            <h3 className="text-2xl md:text-3xl font-bold text-zinc-100 mt-2 font-semibold">SWE-Bench Verified & Execution Latency</h3>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
            <span className="material-symbols-outlined text-[16px] text-cyan-400">update</span>
            <span>Benchmark suite updated: Q1 2025</span>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          {benchmarks.map((bm, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex justify-between font-mono text-xs">
                <span className={`font-bold flex items-center gap-1 ${bm.current ? "text-zinc-100" : "text-zinc-500"}`}>
                  {bm.current && <span className="text-emerald-500 font-black">•</span>}
                  {bm.name}
                </span>
                <span className={`${bm.current ? "text-emerald-400" : "text-zinc-500"} font-mono text-xs font-bold`}>{bm.value}% Resolved{bm.current && " (First Attempt)"}</span>
              </div>
              <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ${bm.current ? "bg-gradient-to-r from-emerald-500 to-cyan-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" : "bg-zinc-700"}`} style={{ width: `${bm.value}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
          <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs">
            <span className="material-symbols-outlined text-[18px] text-emerald-400">speed</span>
            <span>Cold start in under 12ms</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs">
            <span className="material-symbols-outlined text-[18px] text-cyan-400">memory</span>
            <span>Zero background telemetry leak</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs">
            <span className="material-symbols-outlined text-[18px] text-indigo-400">lock</span>
            <span>Local Ollama & vLLM compliant</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    await navigator.clipboard.writeText(installCommands["macos-linux"]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  return (
    <section className="py-20 px-6 max-w-7xl mx-auto">
      <div className="max-w-5xl mx-auto bg-gradient-to-b from-zinc-900/50 to-zinc-950/50 p-8 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.1)] flex flex-col items-center text-center border border-zinc-800/50">
        <span className="font-mono text-xs text-emerald-400 uppercase font-bold tracking-widest mb-2">Terminal Sovereignty</span>
        <h2 className="text-3xl md:text-4xl font-bold text-zinc-100 mb-4 font-semibold">Ready to give your terminal full coding agency?</h2>
        <p className="max-w-xl text-zinc-500 mb-8">Install SAGENT in seconds with our single binary distribution. Compatible with macOS, Linux, and Windows WSL.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button onClick={copyCommand} className="flex items-center gap-2 px-8 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-mono text-sm uppercase font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95">
            <span className="material-symbols-outlined text-[18px]">terminal</span>
            <span>Install Now ($ curl)</span>
          </button>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-8 py-3 rounded-lg bg-zinc-900/50 hover:bg-zinc-800/50 text-zinc-100 font-mono text-sm uppercase font-semibold transition-all shadow-md border border-zinc-800/50">
            <span className="material-symbols-outlined text-[18px]">code</span>
            <span>Explore GitHub Repo</span>
          </a>
        </div>
        <div className="mt-6 flex items-center justify-center gap-6 font-mono text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">✓</span> Open-source core</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">✓</span> MIT Licensed</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">✓</span> Offline model support</span>
        </div>
      </div>
    </section>
  );
}

function Footer({ footerRef }: { footerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <footer id="docs" className="bg-zinc-950 border-t border-zinc-800/50 py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-8 border-b border-zinc-800/50">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-900/50 border border-zinc-800/50">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="font-mono text-xs text-emerald-400 uppercase">Autonomous Core Ready</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-500">
              <span className="material-symbols-outlined text-[14px] text-cyan-400">cloud_done</span>
              <span>US-EAST Neural Node: <span className="text-zinc-100">0.84ms</span></span>
            </div>
            <div className="flex items-center gap-2 px-2 py-2 rounded bg-zinc-900/50 font-mono text-xs text-zinc-400 border border-zinc-800/50">
              <span className="text-zinc-500">CLI VER:</span>
              <span className="text-cyan-400">v2.8.4-alpha</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="p-2 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors" aria-label="GitHub">
              <GitFork className="w-5 h-5" />
            </a>
            <a href="#" className="p-2 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors" aria-label="Terminal">
              <Terminal className="w-5 h-5" />
            </a>
            <a href="#" className="p-2 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors" aria-label="Discord">
              <Sparkles className="w-5 h-5" />
            </a>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8">
          <div>
            <div className="font-mono text-xl font-bold tracking-tight mb-4 text-zinc-100">SAGENT</div>
            <p className="text-zinc-500 mb-6 max-w-xs">Autonomous coding agent that plans, edits, and verifies code directly in your terminal.</p>
          </div>
          <div>
            <h4 className="font-semibold text-zinc-100 mb-4">Quick Install</h4>
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-4 font-mono text-sm text-emerald-400 overflow-x-auto">
              <code>{installCommands["macos-linux"]}</code>
            </div>
            <p className="text-zinc-500 text-sm mt-3">Also available for PowerShell & CMD</p>
          </div>
          <div>
            <h4 className="font-semibold text-zinc-100 mb-4">Links</h4>
            <ul className="space-y-2 text-zinc-500">
              <li><a href="#features" className="hover:text-emerald-400 transition-colors">Features</a></li>
              <li><a href="#workflow" className="hover:text-emerald-400 transition-colors">Workflow</a></li>
              <li><a href="#benchmarks" className="hover:text-emerald-400 transition-colors">Benchmarks</a></li>
              <li><a href="#docs" className="hover:text-emerald-400 transition-colors">Documentation</a></li>
              <li><a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400 transition-colors flex items-center gap-2">
                <GitFork className="w-4 h-4" />
                GitHub Repository
              </a></li>
              <li><a href="#" className="hover:text-emerald-400 transition-colors">Discord Community</a></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-zinc-800/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-zinc-500 text-sm">MIT Licensed • Built with Bun, Rust, TypeScript, and ❤️</p>
          <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-zinc-500 hover:text-emerald-400 transition-colors">
            <ArrowUpRight className="w-4 h-4" />
            Star on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  const [heroVisible, setHeroVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const [metricsVisible, setMetricsVisible] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.target === heroRef.current) setHeroVisible(entry.isIntersecting);
        if (entry.target === featuresRef.current) setFeaturesVisible(entry.isIntersecting);
        if (entry.target === metricsRef.current) setMetricsVisible(entry.isIntersecting);
        if (entry.target === footerRef.current) setFooterVisible(entry.isIntersecting);
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    [heroRef.current, featuresRef.current, metricsRef.current, footerRef.current].forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased relative overflow-x-hidden">
      <MouseLitGrid />
      <Navbar />
      <HeroSection heroRef={heroRef} />
      <TerminalDemo />
      <FeaturesSection featuresRef={featuresRef} />
      <StepsSection />
      <BenchmarksSection metricsRef={metricsRef} />
      <CTASection />
      <Footer footerRef={footerRef} />
    </div>
  );
}
