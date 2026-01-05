#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.ANTI_BASE_URL || "http://localhost:8317";
const API_KEY = process.env.ANTI_API_KEY || "dummy";
const MODEL = process.env.ANTI_MODEL || "gemini-2.5-flash";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string; domain?: string };
      }>;
      groundingSupports?: Array<{
        segment?: { text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
    urlContextMetadata?: {
      urlMetadata?: Array<{
        retrievedUrl?: string;
        urlRetrievalStatus?: string;
      }>;
    };
  }>;
  error?: { message?: string; code?: number };
}

// 输出格式类型定义
interface SearchSource {
  url: string;
  site: string;
  snippet: string;
}

interface SearchResult {
  query: string;
  answer: string;
  sources: SearchSource[];
}

interface GroundedSource {
  url: string;
  site: string;
  context: string;  // 更完整的上下文
}

interface GroundedResult {
  query: string;
  answer: string;
  sources: GroundedSource[];
}

interface UrlResult {
  url: string;
  status: "success" | "failed";
  content: string;
}

async function callGemini(
  prompt: string,
  tools: Record<string, object>[]
): Promise<GeminiResponse> {
  const url = `${BASE_URL}/v1beta/models/${MODEL}:generateContent`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools,
    }),
  });

  return response.json() as Promise<GeminiResponse>;
}

function formatSearchResult(response: GeminiResponse, query: string): string {
  if (response.error) {
    return JSON.stringify({ error: response.error.message || "Unknown error" }, null, 2);
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return JSON.stringify({ error: "No results" }, null, 2);
  }

  const meta = candidate.groundingMetadata;
  const chunks = meta?.groundingChunks || [];
  const supports = meta?.groundingSupports || [];

  // 构建 chunk 索引 -> snippets 映射
  const chunkSnippets = new Map<number, string[]>();
  supports.forEach((support) => {
    const text = support.segment?.text || "";
    (support.groundingChunkIndices || []).forEach((idx) => {
      if (!chunkSnippets.has(idx)) chunkSnippets.set(idx, []);
      chunkSnippets.get(idx)!.push(text);
    });
  });

  const result: SearchResult = {
    query,
    answer: candidate.content?.parts?.[0]?.text || "",
    sources: chunks.map((chunk, i) => ({
      url: chunk.web?.uri || "",
      site: chunk.web?.domain || chunk.web?.title || "",
      snippet: (chunkSnippets.get(i) || []).join(" ").slice(0, 300),
    })),
  };

  return JSON.stringify(result, null, 2);
}

function formatGroundedResult(response: GeminiResponse, query: string): string {
  if (response.error) {
    return JSON.stringify({ error: response.error.message || "Unknown error" }, null, 2);
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return JSON.stringify({ error: "No results" }, null, 2);
  }

  const meta = candidate.groundingMetadata;
  const chunks = meta?.groundingChunks || [];
  const supports = meta?.groundingSupports || [];

  // 构建 chunk 索引 -> 完整 context 映射
  const chunkContexts = new Map<number, string[]>();
  supports.forEach((support) => {
    const text = support.segment?.text || "";
    (support.groundingChunkIndices || []).forEach((idx) => {
      if (!chunkContexts.has(idx)) chunkContexts.set(idx, []);
      chunkContexts.get(idx)!.push(text);
    });
  });

  const result: GroundedResult = {
    query,
    answer: candidate.content?.parts?.[0]?.text || "",
    sources: chunks.map((chunk, i) => ({
      url: chunk.web?.uri || "",
      site: chunk.web?.domain || chunk.web?.title || "",
      context: (chunkContexts.get(i) || []).join("\n\n"),  // 完整上下文，不截断
    })),
  };

  return JSON.stringify(result, null, 2);
}

function formatUrlResult(response: GeminiResponse, url: string): string {
  if (response.error) {
    return JSON.stringify({ error: response.error.message || "Unknown error" }, null, 2);
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    return JSON.stringify({ error: "No results" }, null, 2);
  }

  const urlMeta = candidate.urlContextMetadata?.urlMetadata || [];
  const statusInfo = urlMeta.find((m) => m.retrievedUrl === url) || urlMeta[0];

  const result: UrlResult = {
    url: statusInfo?.retrievedUrl || url,
    status: statusInfo?.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS"
      ? "success"
      : "failed",
    content: candidate.content?.parts?.[0]?.text || "",
  };

  return JSON.stringify(result, null, 2);
}

// Create MCP server
const server = new McpServer({
  name: "anti-search",
  version: "1.1.1",
});

// Tool: web_search
server.tool(
  "web_search",
  "Search the web using Google Search via Antigravity",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const response = await callGemini(query, [{ googleSearch: {} }]);
    return { content: [{ type: "text", text: formatSearchResult(response, query) }] };
  }
);

// Tool: read_url
server.tool(
  "read_url",
  "Read and summarize content from a URL",
  { 
    url: z.string().describe("URL to read"),
    instruction: z.string().optional().describe("Specific instruction for reading (e.g., 'summarize', 'extract key points')")
  },
  async ({ url, instruction }) => {
    const prompt = instruction 
      ? `${instruction}: ${url}`
      : `Summarize the content from ${url}`;
    const response = await callGemini(prompt, [{ urlContext: {} }]);
    return { content: [{ type: "text", text: formatUrlResult(response, url) }] };
  }
);

// Tool: grounded_search
server.tool(
  "grounded_search",
  "Search the web and read URLs for comprehensive research",
  { 
    query: z.string().describe("Research query"),
  },
  async ({ query }) => {
    const response = await callGemini(query, [
      { googleSearch: {} },
      { urlContext: {} }
    ]);
    return { content: [{ type: "text", text: formatGroundedResult(response, query) }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("anti-search MCP server running");
}

main().catch(console.error);
