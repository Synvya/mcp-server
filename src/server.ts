import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { z } from "zod";
import {
  loadProfileData,
  loadCollectionsData,
  loadProductsData,
  parseContent,
  extractDishName,
  matchesDietaryTag,
  findProductsInCollection,
  findCollection,
  getPrice,
  productMatchesDietary,
  extractSchemaOrgData,
  type NostrEvent,
} from './data-loader.js';

const server = new McpServer({
  name: "synvya-restaurant",
  version: "1.0.0",
});

// Initialize data
let profiles: NostrEvent[] = [];
let collections: NostrEvent[] = [];
let products: NostrEvent[] = [];

async function initializeData() {
  try {
    profiles = await loadProfileData();
    collections = await loadCollectionsData();
    products = await loadProductsData();
    console.error("✅ Data loaded:", {
      profiles: profiles.length,
      collections: collections.length,
      products: products.length,
    });
  } catch (error) {
    console.error("❌ Failed to load data:", error);
    throw error;
  }
}

// Tool 1: Food Establishment Search
server.registerTool(
  "search_food_establishments",
  {
    description: "Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. Example: {'foodEstablishmentType': 'Restaurant', 'cuisine': 'Spanish', 'dietary': 'vegan'} to find vegan Spanish restaurants.",
    inputSchema: z.object({
      foodEstablishmentType: z.enum(['Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery']).optional().describe("Filter by schema.org FoodEstablishment type. If not provided, returns all FoodEstablishment types. Valid values: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, Winery."),
      cuisine: z.string().optional().describe("Cuisine type (e.g., 'Spanish', 'Italian', 'Mexican'). Searches schema.org:servesCuisine tags first, then falls back to description text matching."),
      query: z.string().optional().describe("Free-text search matching establishment name, location (schema.org:PostalAddress), or description. Example: 'Snoqualmie' to find establishments in that location."),
      dietary: z.string().optional().describe("Dietary requirement (e.g., 'vegan', 'gluten free'). Matches against lowercase dietary tags in profiles. Tags are normalized for flexible matching (handles 'gluten free' vs 'gluten-free')."),
    }),
    outputSchema: z.object({
      food_establishments: z.array(z.object({
        "@context": z.string().describe("JSON-LD context (https://schema.org)"),
        "@type": z.string().describe("Schema.org FoodEstablishment type: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, or Winery"),
        "name": z.string().describe("Restaurant name"),
        "description": z.string().describe("Restaurant description"),
        "address": z.object({
          "@type": z.string(),
          "streetAddress": z.string().optional(),
          "addressLocality": z.string().optional(),
          "addressRegion": z.string().optional(),
          "postalCode": z.string().optional(),
          "addressCountry": z.string().optional(),
        }).optional().describe("PostalAddress from schema.org"),
        "telephone": z.string().optional(),
        "email": z.string().optional().describe("Email in mailto: format"),
        "openingHours": z.array(z.string()).optional().describe("Opening hours in format: ['Mo-Fr 10:00-19:00', 'Sa 10:00-22:00']"),
        "image": z.string().optional().describe("Banner image URL"),
        "servesCuisine": z.array(z.string()).optional().describe("Array of cuisine types"),
        "geo": z.object({
          "@type": z.string(),
          "latitude": z.number(),
          "longitude": z.number(),
        }).optional().describe("GeoCoordinates from schema.org"),
        "url": z.string().optional().describe("Website URL"),
        "acceptsReservations": z.union([z.string(), z.boolean()]).optional().describe("True, False, or URL"),
        "keywords": z.string().optional().describe("Comma-separated keywords from tags"),
        "identifier": z.string().describe("Restaurant pubkey (Nostr identifier) - use this for get_menu_items"),
      })).describe("Array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. May contain mixed types (Restaurant, Bakery, etc.)"),
    }),
  },
  async (args) => {
    try {
      const { foodEstablishmentType, cuisine, query, dietary } = args;
      
      const results = profiles.filter((profile) => {
        // STRICT: First check if profile has valid l tag with FoodEstablishment type
        const lTag = profile.tags.find(t => t[0] === 'l' && t[1]?.startsWith('https://schema.org:'));
        if (!lTag || !lTag[1]) {
          return false; // Ignore profiles without valid l tag
        }

        // Extract type from l tag
        const typeMatch = lTag[1].match(/^https:\/\/schema\.org:(.+)$/);
        if (!typeMatch || !typeMatch[1]) {
          return false; // Ignore profiles with invalid l tag format
        }

        const establishmentType = typeMatch[1];

        // Filter by foodEstablishmentType if provided
        if (foodEstablishmentType && establishmentType !== foodEstablishmentType) {
          return false;
        }

        const content = parseContent(profile);
        const profileName = content.name || content.display_name || '';
        const about = content.about || '';
        
        // Match cuisine - check tags and content
        const matchesCuisine = cuisine
          ? profile.tags.some(tag => {
              // Check schema.org:servesCuisine tag
              if (tag[0] === 'schema.org:servesCuisine' && tag[1]) {
                return tag[1].toLowerCase().includes(cuisine.toLowerCase());
              }
              return false;
            }) || about.toLowerCase().includes(cuisine.toLowerCase())
          : true;
        
        // Match free-text query (name, location, description)
        const matchesQuery = query
          ? profileName.toLowerCase().includes(query.toLowerCase()) ||
            about.toLowerCase().includes(query.toLowerCase()) ||
            profile.tags.some(tag => {
              // Check location tags
              if (tag[0] === 'i' && tag[1] && tag[1].includes('schema.org:PostalAddress')) {
                return tag[1].toLowerCase().includes(query.toLowerCase());
              }
              return false;
            })
          : true;
        
        // Match dietary tags (profiles use lowercase tags in "t" tags)
        const matchesDietary = dietary
          ? profile.tags.some(tag => 
              tag[0] === 't' && tag[1] && matchesDietaryTag(tag[1], dietary)
            )
          : true;
        
        return matchesCuisine && matchesQuery && matchesDietary;
      });

      // Format as JSON-LD with schema.org structure
      // Filter out null results (profiles without valid l tag)
      const establishmentList = results
        .map((p) => extractSchemaOrgData(p))
        .filter((data): data is Record<string, any> => data !== null);

      return {
        structuredContent: {
          food_establishments: establishmentList,
        },
        content: [
          {
            type: "text",
            text: establishmentList.length > 0
              ? `Found ${establishmentList.length} matching food establishment${establishmentList.length > 1 ? 's' : ''}`
              : "No food establishments match your criteria",
          },
        ],
      };
    } catch (error) {
      console.error("Error in search_food_establishments:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error searching food establishments: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  }
);

// Tool 2: Get Menu Items
server.registerTool(
  "get_menu_items",
  {
    description: "Get all dishes from a specific food establishment menu. IMPORTANT: Use the exact 'identifier' field (pubkey) from search_food_establishments results as food_establishment_identifier. Do NOT use establishment names. Example: {'food_establishment_identifier': 'e01e4b0b...', 'menu_id': 'Lunch'}",
    inputSchema: z.object({
      food_establishment_identifier: z.string().describe("Food establishment pubkey (ID) - MUST be the exact 'identifier' value from search_food_establishments results. The pubkey is reported as 'identifier' in the JSON-LD output. Using establishment names will fail."),
      menu_id: z.string().describe("Menu identifier from the restaurant's menu collections. Common values: 'Lunch', 'Dinner', 'Brunch', 'Breakfast'. The menu_id comes from the 'd' tag in Nostr kind:30405 collection events."),
    }),
    outputSchema: z.object({
      items: z.array(z.object({
        name: z.string().describe("Dish name"),
        description: z.string().optional().describe("Dish description"),
        price: z.string().optional().describe("Price in USD"),
      })),
    }),
  },
  async (args) => {
    try {
      const { food_establishment_identifier, menu_id } = args;
      
      // Find food establishment by pubkey only
      const establishment = profiles.find(p => p.pubkey === food_establishment_identifier);
      if (!establishment) {
        const availableEstablishments = profiles
          .map(p => {
            const schemaData = extractSchemaOrgData(p);
            if (!schemaData) return null;
            return {
              identifier: p.pubkey,
              name: schemaData.name || 'Unknown'
            };
          })
          .filter((e): e is { identifier: string; name: string } => e !== null);
        return {
          content: [
            {
              type: "text",
              text: `Invalid food_establishment_identifier: "${food_establishment_identifier}". You must use the exact 'identifier' (pubkey) from search_food_establishments results. Available establishments with their identifiers: ${availableEstablishments.map(e => `${e.name} (identifier: ${e.identifier})`).join('; ')}`,
            },
          ],
          structuredContent: { results: [] },
        };
      }
      
      const establishmentPubkey = establishment.pubkey;
      
      // Find the collection (menu)
      const collection = findCollection(collections, establishmentPubkey, menu_id);
      if (!collection) {
        // List available menus for this food establishment
        const availableMenus = collections
          .filter(c => c.pubkey === establishmentPubkey)
          .map(c => {
            const menuTag = c.tags.find(t => t[0] === 'd');
            return menuTag?.[1] || 'Unknown';
          })
          .filter(Boolean);
        
        return {
          content: [
            {
              type: "text",
              text: `Menu "${menu_id}" not found for this restaurant. Available menus: ${availableMenus.join(', ')}`,
            },
          ],
          structuredContent: { results: [] },
        };
      }
      
      // Find products in this collection
      const menuItems = findProductsInCollection(products, establishmentPubkey, menu_id);
      
      const items = menuItems.map((item) => {
        const dishName = extractDishName(item);
        const price = getPrice(item);
        const summaryTag = item.tags.find(t => t[0] === 'summary');
        const description = summaryTag?.[1] || '';
        
        return {
          name: dishName,
          description: description,
          price: price ? `$${price}` : undefined,
        };
      });

      const itemNames = items.map(item => item.name).join(', ');
      
      return {
        structuredContent: {
          items: items,
        },
        content: [
          {
            type: "text",
            text: items.length > 0
              ? `Found ${items.length} item${items.length > 1 ? 's' : ''} in ${menu_id} menu: ${itemNames}`
              : `No items found in ${menu_id} menu`,
          },
          ...(items.length > 0 ? [{
            type: "resource" as const,
            resource: {
              uri: `dinedirect://menu/${establishmentPubkey}/${menu_id}`,
              mimeType: "application/json",
              text: JSON.stringify({ items: items }, null, 2),
            },
          }] : []),
        ],
      };
    } catch (error) {
      console.error("Error in get_menu_items:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error getting menu items: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        structuredContent: { results: [] },
      };
    }
  }
);

// Tool 3: Search Menu Items
server.registerTool(
  "search_menu_items",
  {
    description: "Find specific dishes across all restaurants by name, ingredient, or dietary preference. Automatically detects if dish_query is a dietary term (vegan, vegetarian, gluten-free, etc.) and matches against dietary tags. Example: {'dish_query': 'pizza', 'dietary': 'vegan'} or {'dish_query': 'vegan'} (auto-detects as dietary term).",
    inputSchema: z.object({
      dish_query: z.string().describe("Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions. If the query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name. Example: 'pizza' or 'vegan' or 'tomato'"),
      dietary: z.string().optional().describe("Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic. If dish_query is already a dietary term, this adds an additional constraint."),
      food_establishment_identifier: z.string().optional().describe("Optional: Filter results to a specific food establishment by pubkey. Use the 'identifier' from search_food_establishments results. The pubkey is reported as 'identifier' in the JSON-LD output."),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        dish: z.string().describe("Dish name"),
        description: z.string().optional().describe("Dish description"),
        price: z.string().optional().describe("Price in USD"),
        restaurant: z.string().describe("Restaurant name"),
        food_establishment_identifier: z.string().describe("Food establishment pubkey (identifier)"),
        menu: z.string().optional().describe("Menu name"),
      })),
    }),
  },
  async (args) => {
    try {
      const { dish_query, dietary, food_establishment_identifier } = args;
      
      const results: Array<{
        dish: string;
        description?: string;
        price?: string;
        restaurant: string;
        food_establishment_identifier: string;
        menu?: string;
      }> = [];
      
      // Filter products by food establishment if specified
      const productsToSearch = food_establishment_identifier
        ? products.filter(p => p.pubkey === food_establishment_identifier)
        : products;
      
      // Check if dish_query might be a dietary term
      const commonDietaryTerms = ['vegan', 'vegetarian', 'gluten free', 'gluten-free', 'dairy free', 'dairy-free', 'nut free', 'nut-free'];
      const queryLower = dish_query.toLowerCase();
      const mightBeDietaryQuery = commonDietaryTerms.some(term => queryLower.includes(term));
      
      // If no dietary parameter but query looks like a dietary term, use it as dietary filter too
      const effectiveDietary = dietary || (mightBeDietaryQuery ? dish_query : undefined);
      
      for (const product of productsToSearch) {
        const dishName = extractDishName(product);
        const summaryTag = product.tags.find(t => t[0] === 'summary');
        const description = summaryTag?.[1] || '';
        const contentText = typeof product.content === 'string' ? product.content : '';
        
        // Match dish name/description
        const searchText = `${dishName} ${description} ${contentText}`.toLowerCase();
        const matchesDish = searchText.includes(dish_query.toLowerCase());
        
        // Match dietary tags if provided or if query looks like dietary term
        const matchesDietary = effectiveDietary
          ? productMatchesDietary(product, effectiveDietary)
          : true;
        
        // If query looks like dietary term, also match if dietary tags match (even if word not in name)
        const matchesByDietaryTag = mightBeDietaryQuery && effectiveDietary
          ? productMatchesDietary(product, effectiveDietary)
          : false;
        
        if ((matchesDish || matchesByDietaryTag) && matchesDietary) {
          // Find restaurant details
          const restaurant = profiles.find((p) => p.pubkey === product.pubkey);
          const restaurantName = restaurant
            ? parseContent(restaurant).display_name || parseContent(restaurant).name || 'Unknown'
            : 'Unknown';
          
          // Find which menu(s) this product belongs to
          const menuTags = product.tags
            .filter(t => t[0] === 'a' && t[1] === '30405')
            .map(t => t[3])
            .filter(Boolean);
          
          const price = getPrice(product);
          
          // Add result for each menu the product appears in
          if (menuTags.length > 0) {
            for (const menu of menuTags) {
              results.push({
                dish: dishName,
                description: description,
                price: price ? `$${price}` : undefined,
                restaurant: restaurantName,
                food_establishment_identifier: product.pubkey,
                menu: menu,
              });
            }
          } else {
            // Product not in any menu, still include it
            results.push({
              dish: dishName,
              description: description,
              price: price ? `$${price}` : undefined,
              restaurant: restaurantName,
              food_establishment_identifier: product.pubkey,
            });
          }
        }
      }

      const dishList = results.map(r => `${r.dish} at ${r.restaurant}${r.price ? ` (${r.price})` : ''}`).join('; ');
      
      return {
        structuredContent: {
          results: results,
        },
        content: [
          {
            type: "text",
            text: results.length > 0
              ? `Found ${results.length} matching dish${results.length > 1 ? 'es' : ''}: ${dishList}`
              : "No dishes match your search",
          },
          ...(results.length > 0 ? [{
            type: "resource" as const,
            resource: {
              uri: "dinedirect://dishes/search",
              mimeType: "application/json",
              text: JSON.stringify({ results: results }, null, 2),
            },
          }] : []),
        ],
      };
    } catch (error) {
      console.error("Error in search_menu_items:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error searching menu items: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        structuredContent: { results: [] },
      };
    }
  }
);

// Initialize data and start server
async function main() {
  await initializeData();
  
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

