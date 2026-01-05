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

function formatSearchResult(response: GeminiResponse): string {
  if (response.error) {
    return `Error: ${response.error.message || "Unknown error"}`;
  }

  const candidate = response.candidates?.[0];
  if (!candidate) return "No results";

  const text = candidate.content?.parts?.[0]?.text || "";
  const chunks = candidate.groundingMetadata?.groundingChunks || [];

  let result = text + "\n\n";

  if (chunks.length > 0) {
    result += "## Sources\n";
    chunks.forEach((chunk, i) => {
      if (chunk.web) {
        result += `${i + 1}. [${chunk.web.title || chunk.web.domain}](${chunk.web.uri})\n`;
      }
    });
  }

  return result;
}

function formatUrlResult(response: GeminiResponse): string {
  if (response.error) {
    return `Error: ${response.error.message || "Unknown error"}`;
  }

  const candidate = response.candidates?.[0];
  if (!candidate) return "No results";

  const text = candidate.content?.parts?.[0]?.text || "";
  const urlMeta = candidate.urlContextMetadata?.urlMetadata || [];

  let result = text + "\n\n";

  if (urlMeta.length > 0) {
    result += "## URL Status\n";
    urlMeta.forEach((meta) => {
      const status = meta.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS" ? "✓" : "✗";
      result += `${status} ${meta.retrievedUrl}\n`;
    });
  }

  return result;
}

// Create MCP server
const server = new McpServer({
  name: "anti-search",
  version: "1.0.0",
});

// Tool: web_search
server.tool(
  "web_search",
  "Search the web using Google Search via Antigravity",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const response = await callGemini(query, [{ googleSearch: {} }]);
    return { content: [{ type: "text", text: formatSearchResult(response) }] };
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
    return { content: [{ type: "text", text: formatUrlResult(response) }] };
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
    return { content: [{ type: "text", text: formatSearchResult(response) }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("anti-search MCP server running");
}

main().catch(console.error);
