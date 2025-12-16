import { zodToJsonSchema } from "zod-to-json-schema";
import {
  FoodEstablishmentTypeEnum,
  PostalAddressSchema,
  GeoCoordinatesSchema,
  MenuSectionSchema,
  MenuSchema,
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
 * Helper function to manually construct FoodEstablishment schema
 * zodToJsonSchema has compatibility issues with Zod v4, so we manually construct
 * the full schema structure to ensure all nested properties are included.
 */
function expandFoodEstablishmentSchema(): any {
  return {
    type: "object",
    properties: {
      "@context": { 
        type: "string", 
        description: "JSON-LD context (https://schema.org)" 
      },
      "@type": { 
        type: "string", 
        description: "Schema.org FoodEstablishment type: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, or Winery" 
      },
      name: { 
        type: "string", 
        description: "Restaurant name" 
      },
      description: { 
        type: "string", 
        description: "Restaurant description" 
      },
      address: {
        type: "object",
        description: "PostalAddress from schema.org",
        properties: {
          "@type": { type: "string" },
          streetAddress: { type: "string" },
          addressLocality: { type: "string" },
          addressRegion: { type: "string" },
          postalCode: { type: "string" },
          addressCountry: { type: "string" }
        }
      },
      telephone: { type: "string" },
      email: { 
        type: "string", 
        description: "Email in mailto: format" 
      },
      openingHours: { 
        type: "array", 
        items: { type: "string" }, 
        description: "Opening hours in format: ['Mo-Fr 10:00-19:00', 'Sa 10:00-22:00']" 
      },
      image: { 
        type: "string", 
        description: "Banner image URL" 
      },
      servesCuisine: { 
        type: "array", 
        items: { type: "string" }, 
        description: "Array of cuisine types" 
      },
      geo: {
        type: "object",
        description: "GeoCoordinates from schema.org",
        properties: {
          "@type": { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" }
        }
      },
      url: { 
        type: "string", 
        description: "Website URL" 
      },
      acceptsReservations: { 
        oneOf: [
          { type: "string" },
          { type: "boolean" }
        ],
        description: "True, False, or URL"
      },
      keywords: { 
        type: "string", 
        description: "Comma-separated keywords from tags" 
      },
      "@id": { 
        type: "string", 
        description: "Food establishment identifier in bech32 format (nostr:npub1...) - use this as restaurant_id for get_menu_items" 
      },
      hasMenu: {
        type: "array",
        description: "Array of menus available at this establishment",
        items: {
          type: "object",
          properties: {
            "@type": { 
              type: "string", 
              description: "Menu" 
            },
            name: { 
              type: "string", 
              description: "Menu name" 
            },
            description: { 
              type: "string", 
              description: "Menu description" 
            },
            identifier: { 
              type: "string", 
              description: "Menu identifier - use this as menu_identifier for get_menu_items" 
            },
            hasMenuSection: {
              type: "array",
              description: "Array of menu sections within this menu",
              items: {
                type: "object",
                properties: {
                  "@type": { 
                    type: "string", 
                    description: "MenuSection" 
                  },
                  name: { 
                    type: "string", 
                    description: "Section name (e.g., 'Appetizers', 'Entrees', 'Sides')" 
                  },
                  description: { 
                    type: "string", 
                    description: "Section description" 
                  },
                  identifier: { 
                    type: "string", 
                    description: "Section identifier" 
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

/**
 * Generate OpenAPI 3.1.0 schema from Zod schemas
 */
export function generateOpenAPISchema(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Synvya MCP Server",
      description: "Discover restaurants and menus, and make reservations directly from your AI assistant. Search food establishments, get menu items, and find dishes by dietary preferences.",
      version: "1.0.0"
    },
    servers: [
      {
        url: baseUrl,
        description: "Synvya MCP Server"
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
                        items: expandFoodEstablishmentSchema()
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

