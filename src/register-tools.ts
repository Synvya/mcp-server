import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type NostrEvent } from './data-loader.js';
import {
  searchFoodEstablishments,
  getMenuItems,
  searchMenuItems,
  makeReservation,
  type ToolData,
} from './tool-handlers.js';
import {
  SearchFoodEstablishmentsInputSchema,
  SearchFoodEstablishmentsOutputSchema,
  GetMenuItemsInputSchema,
  GetMenuItemsOutputSchema,
  SearchMenuItemsInputSchema,
  SearchMenuItemsOutputSchema,
  MakeReservationInputSchema,
  MakeReservationOutputSchema,
} from './schemas.js';

// Re-export ToolData for backwards compatibility
export type { ToolData };

export function registerTools(server: McpServer, data: ToolData) {
  const { profiles, collections, products, calendar, tables } = data;

  // Tool 1: Food Establishment Search
  server.registerTool(
    "search_food_establishments",
    {
      description: "Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. Example: {'foodEstablishmentType': 'Restaurant', 'cuisine': 'Spanish', 'dietary': 'vegan'} to find vegan Spanish restaurants.",
      inputSchema: SearchFoodEstablishmentsInputSchema,
      outputSchema: SearchFoodEstablishmentsOutputSchema,
    },
    async (args) => {
      try {
        const structuredContent = searchFoodEstablishments(args, {
          profiles,
          collections,
          products,
          calendar,
          tables,
        });
        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in search_food_establishments:", error);
        const errorStructuredContent = {
          food_establishments: [],
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorStructuredContent, null, 2),
            },
          ],
          structuredContent: errorStructuredContent,
        };
      }
    }
  );

  // Tool 2: Get Menu Items
  server.registerTool(
    "get_menu_items",
    {
      description: "Get all dishes from a specific food establishment menu. IMPORTANT: Use the exact '@id' field from search_food_establishments results as restaurant_id, and use the 'identifier' from the 'hasMenu' array for menu_identifier. Do NOT use establishment names or guess menu names. Example: {'restaurant_id': 'nostr:npub1...', 'menu_identifier': 'Dinner'}",
      inputSchema: GetMenuItemsInputSchema,
      outputSchema: GetMenuItemsOutputSchema,
    },
    async (args) => {
      try {
        const structuredContent = getMenuItems(args, {
          profiles,
          collections,
          products,
          calendar,
          tables,
        });
        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in get_menu_items:", error);
        const errorStructuredContent = {
          "@context": "https://schema.org",
          "@type": "Menu",
          "name": "",
          "identifier": "",
          "hasMenuSection": [],
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorStructuredContent, null, 2),
            },
          ],
          structuredContent: errorStructuredContent,
        };
      }
    }
  );

  // Tool 3: Search Menu Items
  server.registerTool(
    "search_menu_items",
    {
      description: "Find specific dishes across all food establishments by name, ingredient, or dietary preference. Returns a JSON-LD graph structure with food establishments grouped by their matching menu items. Automatically detects if dish_query is a dietary term (vegan, vegetarian, gluten-free, etc.) and matches against dietary tags. Example: {'dish_query': 'pizza', 'dietary': 'vegan'} or {'dish_query': 'vegan'} (auto-detects as dietary term).",
      inputSchema: SearchMenuItemsInputSchema,
      outputSchema: SearchMenuItemsOutputSchema,
    },
    async (args) => {
      try {
        const structuredContent = searchMenuItems(args, {
          profiles,
          collections,
          products,
          calendar,
          tables,
        });
        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in search_menu_items:", error);
        const errorStructuredContent = {
          "@context": "https://schema.org",
          "@graph": [],
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorStructuredContent, null, 2),
            },
          ],
          structuredContent: errorStructuredContent,
        };
      }
    }
  );

  // Tool 4: Make Reservation
  server.registerTool(
    "make_reservation",
    {
      description: "Make a reservation at a food establishment. Returns a JSON-LD formatted FoodEstablishmentReservation object on success, or a ReserveAction with error details on failure.",
      inputSchema: MakeReservationInputSchema,
      outputSchema: MakeReservationOutputSchema,
    },
    async (args) => {
      try {
        const structuredContent = await makeReservation(args, {
          profiles,
          collections,
          products,
          calendar,
          tables,
        });
        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Error in make_reservation:", error);
        const errorResponse = {
          "@context": "https://schema.org",
          "@type": "ReserveAction",
          "actionStatus": "FailedActionStatus",
          "error": {
            "@type": "Thing",
            "name": "InvalidReservationRequest",
            "description": error instanceof Error ? error.message : "An unexpected error occurred while processing the reservation.",
          },
        };
        return {
          structuredContent: errorResponse,
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse, null, 2),
            },
          ],
        };
      }
    }
  );
}

