# anti-search

MCP server for web search and URL reading via [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) Antigravity backend.

## Features

- **web_search** - Google Search via Gemini's googleSearch tool
- **read_url** - Read and summarize content from any URL (including Reddit, news sites, etc.)
- **grounded_search** - Combined search + URL context for comprehensive research

## Prerequisites

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) running with Antigravity login
- [Bun](https://bun.sh/) runtime

## Installation

```bash
# Via npx (recommended)
npx anti-search

# Or via bunx
bunx anti-search

# Or install globally
npm install -g anti-search
```

## Configuration

Set environment variables:

```bash
# CLIProxyAPI endpoint (default: http://localhost:8317)
ANTI_BASE_URL=http://localhost:8317

# API key for CLIProxyAPI (default: dummy)
ANTI_API_KEY=dummy

# Model to use (default: gemini-2.5-flash)
ANTI_MODEL=gemini-2.5-flash
```

## Usage with Claude Code

Add to your MCP configuration (`~/.claude.json` or lazy-mcp config):

```json
{
  "mcpServers": {
    "anti-search": {
      "command": "npx",
      "args": ["anti-search"],
      "env": {
        "ANTI_BASE_URL": "http://localhost:8317",
        "ANTI_API_KEY": "dummy"
      }
    }
  }
}
```

## Tools

### web_search

Search the web using Google Search.

```json
{
  "name": "web_search",
  "arguments": {
    "query": "latest AI news 2025"
  }
}
```

### read_url

Read and summarize content from a URL.

```json
{
  "name": "read_url",
  "arguments": {
    "url": "https://www.reddit.com/r/LocalLLaMA/",
    "instruction": "List the top 3 posts"
  }
}
```

### grounded_search

Search the web and read URLs for comprehensive research.

```json
{
  "name": "grounded_search",
  "arguments": {
    "query": "Claude Code features and capabilities"
  }
}
```

## How It Works

This MCP server connects to CLIProxyAPI which provides access to Gemini's:
- `googleSearch` - Server-side Google Search integration
- `urlContext` - Server-side URL content retrieval

Both features are part of Google's Gemini API grounding capabilities.

## License

MIT
