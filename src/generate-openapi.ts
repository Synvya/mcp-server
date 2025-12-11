import { zodToJsonSchema } from "zod-to-json-schema";
import {
  FoodEstablishmentTypeEnum,
  FoodEstablishmentSchema,
  SearchFoodEstablishmentsOutputSchema,
  GetMenuItemsOutputSchema,
  SearchMenuItemsOutputSchema,
  MakeReservationOutputSchema,
} from './schemas.js';

/**
 * Automated OpenAPI Schema Generation
 * 
 * This module automatically generates an OpenAPI 3.1.0 schema from shared Zod schemas.
 * 
 * SINGLE SOURCE OF TRUTH: All schemas are defined in schemas.ts and imported here.
 * When you update schemas.ts, both MCP and OpenAPI schemas automatically update.
 */

/**
 * Generate OpenAPI 3.1.0 schema from Zod schemas
 */
export function generateOpenAPISchema(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "DineDirect MCP Server",
      description: "Discover restaurants and menus, and make reservations directly from your AI assistant. Search food establishments, get menu items, and find dishes by dietary preferences.",
      version: "1.0.0"
    },
    servers: [
      {
        url: baseUrl,
        description: "DineDirect MCP Server"
      }
    ],
    paths: {
      "/api/search_food_establishments": {
        get: {
          operationId: "search_food_establishments",
          summary: "Find food establishments",
          description: "Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification.",
          parameters: [
            {
              name: "foodEstablishmentType",
              in: "query",
              required: false,
              schema: zodToJsonSchema(FoodEstablishmentTypeEnum as any, { $refStrategy: "none" }),
              description: "Filter by schema.org FoodEstablishment type. If not provided, returns all FoodEstablishment types."
            },
            {
              name: "cuisine",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Cuisine type (e.g., 'Spanish', 'Italian', 'Mexican'). Searches schema.org:servesCuisine tags first, then falls back to description text matching."
            },
            {
              name: "query",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Free-text search matching establishment name, location (schema.org:PostalAddress), or description."
            },
            {
              name: "dietary",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Dietary requirement (e.g., 'vegan', 'gluten free'). Matches against lowercase dietary tags in profiles."
            }
          ],
          deprecated: false,
          responses: {
            "200": {
              description: "Successfully found food establishments",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      food_establishments: {
                        type: "array",
                        description: "Array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. May contain mixed types (Restaurant, Bakery, etc.)",
                        items: zodToJsonSchema(FoodEstablishmentSchema as any, { 
                          $refStrategy: "none"
                        })
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/get_menu_items": {
        get: {
          operationId: "get_menu_items",
          summary: "Get menu items from a restaurant",
          description: "Get all dishes from a specific food establishment menu. IMPORTANT: Use the exact '@id' field from search_food_establishments results as restaurant_id, and use the 'identifier' from the 'hasMenu' array for menu_identifier.",
          parameters: [
            {
              name: "restaurant_id",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results."
            },
            {
              name: "menu_identifier",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Menu identifier - MUST be the exact 'identifier' value from the 'hasMenu' array in search_food_establishments results."
            }
          ],
          deprecated: false,
          responses: {
            "200": {
              description: "Successfully retrieved menu items",
              content: {
                "application/json": {
                  schema: zodToJsonSchema(GetMenuItemsOutputSchema as any, { 
                    $refStrategy: "none"
                  })
                }
              }
            }
          }
        }
      },
      "/api/search_menu_items": {
        get: {
          operationId: "search_menu_items",
          summary: "Search for menu items",
          description: "Find specific dishes across all food establishments by name, ingredient, or dietary preference. Returns a JSON-LD graph structure with food establishments grouped by their matching menu items.",
          parameters: [
            {
              name: "dish_query",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions."
            },
            {
              name: "dietary",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic."
            },
            {
              name: "restaurant_id",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results."
            }
          ],
          deprecated: false,
          responses: {
            "200": {
              description: "Successfully found menu items",
              content: {
                "application/json": {
                  schema: zodToJsonSchema(SearchMenuItemsOutputSchema as any, { 
                    $refStrategy: "none"
                  })
                }
              }
            }
          }
        }
      },
      "/api/make_reservation": {
        post: {
          operationId: "make_reservation",
          summary: "Make a reservation",
          description: "Make a reservation at a food establishment. Returns JSON-LD FoodEstablishmentReservation on success, or ReserveAction on failure. IMPORTANT: Provide either telephone OR email (at least one required). Do not ask for both if user provides only one.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["restaurant_id", "time", "party_size", "name"],
                  properties: {
                    restaurant_id: { type: "string", description: "Food establishment identifier in bech32 format (nostr:npub1...)" },
                    time: { type: "string", description: "Reservation start time in ISO 8601 format" },
                    party_size: { type: "number", minimum: 1, description: "Number of people in the party" },
                    name: { type: "string", minLength: 1, description: "Customer name" },
                    telephone: { type: "string", description: "Customer telephone number (optional if email provided)" },
                    email: { type: "string", format: "email", description: "Customer email address (optional if telephone provided)" }
                  },
                  anyOf: [
                    { required: ["telephone"] },
                    { required: ["email"] }
                  ]
                }
              }
            }
          },
          deprecated: false,
          responses: {
            "200": {
              description: "Reservation response (success or error)",
              content: {
                "application/json": {
                  schema: zodToJsonSchema(MakeReservationOutputSchema as any, { 
                    $refStrategy: "none"
                  })
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {}
    }
  };
}
