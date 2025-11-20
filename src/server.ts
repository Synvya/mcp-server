import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import {
  loadProfileData,
  loadCollectionsData,
  loadProductsData,
  loadCalendarData,
  loadTablesData,
  type NostrEvent,
} from './data-loader.js';
import { registerTools } from './register-tools.js';

const server = new McpServer({
  name: "synvya-restaurant",
  version: "1.0.0",
});

// Initialize data
let profiles: NostrEvent[] = [];
let collections: NostrEvent[] = [];
let products: NostrEvent[] = [];
let calendar: NostrEvent[] = [];
let tables: NostrEvent[] = [];

async function initializeData() {
  try {
    profiles = await loadProfileData();
    collections = await loadCollectionsData();
    products = await loadProductsData();
    calendar = await loadCalendarData();
    tables = await loadTablesData();
    console.error("✅ Data loaded:", {
      profiles: profiles.length,
      collections: collections.length,
      products: products.length,
      calendar: calendar.length,
      tables: tables.length,
    });
  } catch (error) {
    console.error("❌ Failed to load data:", error);
    throw error;
  }
}

// Initialize data and start server
async function main() {
  await initializeData();
  
  // Register all tools with the server (after data is loaded)
  registerTools(server, {
    profiles,
    collections,
    products,
    calendar,
    tables,
  });
  
  // Check if we should use HTTP or stdio transport
  const useHttp = process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http');
  
  if (useHttp) {
    // HTTP transport mode (for testing with MCP Inspector)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });
    
    await server.connect(transport);
    
    // Create HTTP server
    const httpServer = createServer(async (req, res) => {
      // Handle CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // Handle the MCP request
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const parsedBody = body ? JSON.parse(body) : undefined;
          await transport.handleRequest(req, res, parsedBody);
        } catch (error) {
          console.error('Error handling request:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });
    
    const port = process.env.PORT || 3000;
    httpServer.listen(port, () => {
      console.error(`🚀 MCP server ready on http://localhost:${port}`);
    });
  } else {
    // Stdio transport mode (for Claude Desktop and other stdio clients)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🔌 MCP server ready on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
