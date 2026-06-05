import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ── MCP + OpenAI setup ────────────────────────────────────────────────────

class MCPClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.client = null;
  }

  async connect() {
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl));
    this.client = new Client({ name: "web-client", version: "1.0.0" });
    await this.client.connect(transport);
  }

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  async callTool(name, input) {
    return await this.client.callTool({ name, arguments: input });
  }
}

const mcpClient = new MCPClient(process.env.MCP_SERVER_URL ?? "http://localhost:8000/mcp");
await mcpClient.connect();
console.log("✅ Connected to MCP server");

const openai = new OpenAI({
  baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1",
  apiKey: "ollama",
});

const model = process.env.LLM_MODEL ?? "qwen2.5:7b";

// Conversation history per session (simple in-memory)
const sessions = {};

// ── Chat endpoint (SSE streaming to browser) ──────────────────────────────

app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!sessions[sessionId]) sessions[sessionId] = [];
  const messages = sessions[sessionId];
  messages.push({ role: "user", content: message });

  // SSE headers so browser receives chunks in real time
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const mcpTools = await mcpClient.listTools();
  const tools = mcpTools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  try {
    while (true) {
      // Stream from Ollama
      const stream = await openai.chat.completions.create({
        model,
        max_tokens: 8000,
        tools,
        tool_choice: "auto",
        messages,
        stream: true,
      });

      let fullContent = "";
      let toolCalls = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (delta?.content) {
          fullContent += delta.content;
          send({ type: "text", content: delta.content });
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) toolCalls[idx] = { id: "", name: "", args: "" };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
          }
        }

        if (finishReason === "tool_calls") {
          messages.push({
            role: "assistant",
            content: fullContent || null,
            tool_calls: Object.values(toolCalls).map(tc => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.args },
            })),
          });

          // Execute each tool
          for (const tc of Object.values(toolCalls)) {
            send({ type: "tool_call", name: tc.name, args: JSON.parse(tc.args) });

            const result = await mcpClient.callTool(tc.name, JSON.parse(tc.args));
            const content = result.content.filter(c => c.type === "text").map(c => c.text);

            send({ type: "tool_result", name: tc.name, result: content });

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(content),
            });
          }

          toolCalls = {};
          break; // re-enter while loop for next LLM response
        }

        if (finishReason === "stop") {
          messages.push({ role: "assistant", content: fullContent });
          send({ type: "done" });
          res.end();
          return;
        }
      }
    }
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

app.listen(3000, () => console.log("🌐 Chat UI at http://localhost:3000"));