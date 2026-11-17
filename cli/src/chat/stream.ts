export async function* textDeltas(response: Response): AsyncGenerator<string> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  if (!response.body) throw new Error("The model returned no stream.");

  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  for await (const chunk of response.body) {
    pending = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
    let boundary: number;
    while ((boundary = pending.indexOf("\n\n")) !== -1) {
      const event = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      const item = JSON.parse(data);
      if (item.type === "response.output_text.delta") yield item.delta;
      if (item.type === "response.completed") completed = true;
      if (item.type === "response.failed" || item.type === "error") throw new Error(item.response?.error?.message || item.message || "Model generation failed.");
    }
  }
  if (!completed) throw new Error("The model stream ended before completion.");
}
