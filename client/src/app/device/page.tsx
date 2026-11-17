"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_SAGENT_API_URL || "http://localhost:6005",
  fetchOptions: { credentials: "include" },
  plugins: [deviceAuthorizationClient()],
});

function DevicePageContent() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("user_code") || "");
  const [signedIn, setSignedIn] = useState(false);
  const [request, setRequest] = useState<{ client_id?: string; scope?: string } | null>(null);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    authClient.getSession().then(({ data }) => setSignedIn(Boolean(data?.user))).catch(() => setMessage("Could not reach the auth server."));
  }, []);

  async function verify() {
    setMessage("");
    const userCode = code.trim().replace(/[-\s]/g, "").toUpperCase();
    if (!userCode) return setMessage("Enter the code shown in your terminal.");
    if (!signedIn) {
      const { error } = await authClient.signIn.social({ provider: "github", callbackURL: window.location.href });
      if (error) setMessage(error.message || "GitHub sign in failed.");
      return;
    }
    const { data, error } = await authClient.device({ query: { user_code: userCode } });
    if (error || !data || data.client_id !== (process.env.NEXT_PUBLIC_SAGENT_CLIENT_ID || "sagent-cli")) return setMessage("This code is invalid or expired.");
    setCode(userCode);
    setRequest(data);
  }

  async function finish(approve: boolean) {
    const result = approve
      ? await authClient.device.approve({ userCode: code })
      : await authClient.device.deny({ userCode: code });
    if (result.error) return setMessage(result.error.error_description || "Could not update this request.");
    setFinished(true);
    setMessage(approve ? "Approved. You can return to your terminal." : "Denied. You can return to your terminal.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 text-zinc-100">
      <h1 className="text-3xl font-semibold">Connect SAgent CLI</h1>
      {finished ? <p role="status">{message}</p> : <>
        <p>Enter the code shown in your terminal. Approve only a device you own.</p>
        <label htmlFor="device-code">Device code</label>
        <input id="device-code" value={code} onChange={(event) => setCode(event.target.value)}
          className="rounded border border-zinc-500 bg-zinc-900 p-3" autoComplete="off" />
        {!request ? <button onClick={verify} className="rounded bg-cyan-600 p-3 font-semibold">
          {signedIn ? "Continue" : "Sign in with GitHub"}
        </button> : <>
          <p>Code: <strong>{code}</strong></p>
          <p>Client: <strong>{request.client_id}</strong></p>
          <p>Requested access: <strong>{request.scope || "SAgent account"}</strong></p>
          <div className="flex gap-3">
            <button onClick={() => finish(true)} className="rounded bg-cyan-600 px-5 py-3 font-semibold">Approve</button>
            <button onClick={() => finish(false)} className="rounded border border-zinc-500 px-5 py-3">Deny</button>
          </div>
        </>}
        {message && <p role="alert" className="text-amber-300">{message}</p>}
      </>}
    </main>
  );
}

export default function DevicePage() {
  return <Suspense fallback={<main className="p-6">Loading device authorization...</main>}><DevicePageContent /></Suspense>;
}
