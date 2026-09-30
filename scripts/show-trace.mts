/**
 * Prints the assistant's debug trace for a chat conversation (agent_traces):
 * each turn's input, the model's raw output per step, tool calls with args and
 * results, timings, and any error.
 *
 *   npm run trace -- <conversation id> [--full]
 *
 * The id comes from the chat's "Copy conversation ID" button. `--full` also
 * prints the system prompt (page/email context) for each turn.
 */
import { Client } from "pg";

const [id, flag] = process.argv.slice(2);
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
  console.error("Usage: npm run trace -- <conversation id> [--full]");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const conv = await client.query(`SELECT title, created_at FROM agent_conversations WHERE id = $1`, [id]);
  if (conv.rowCount === 0) {
    console.error(`No conversation ${id}.`);
    process.exit(1);
  }
  console.log(`Conversation "${conv.rows[0].title}" — started ${conv.rows[0].created_at.toISOString()}\n`);
  const traces = await client.query(
    `SELECT provider, model, page_context, system_prompt, user_input, image_count, steps, final_reply, error,
            started_at, finished_at FROM agent_traces WHERE conversation_id = $1 ORDER BY started_at`,
    [id],
  );
  if (traces.rowCount === 0) console.log("(No traces — this conversation predates tracing.)");
  traces.rows.forEach((t, n) => {
    const secs = t.finished_at ? ((t.finished_at - t.started_at) / 1000).toFixed(1) + "s" : "unfinished";
    console.log(`══ Turn ${n + 1} · ${t.started_at.toISOString()} · ${t.provider} / ${t.model} · ${secs}`);
    console.log(`page: ${t.page_context ?? "—"}   images: ${t.image_count}`);
    if (flag === "--full") console.log(`\n── system prompt ──\n${t.system_prompt}\n`);
    console.log(`\n── user ──\n${t.user_input}\n`);
    for (const s of t.steps as Record<string, unknown>[]) {
      console.log(`── step ${s.step} · model ${s.modelMs}ms${s.tool ? ` · tool ${s.tool} ${s.toolMs}ms` : " · reply"}`);
      console.log(`raw: ${s.raw}`);
      if (s.tool) {
        console.log(`args: ${JSON.stringify(s.args)}`);
        console.log(`result: ${s.result}`);
      }
      console.log("");
    }
    if (t.error) console.log(`!! ERROR: ${t.error}\n`);
    else console.log(`── final reply ──\n${t.final_reply ?? "(none)"}\n`);
  });
} finally {
  await client.end();
}
