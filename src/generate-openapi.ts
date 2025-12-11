import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

/**
 * Automated OpenAPI Schema Generation
 * 
 * This module automatically generates an OpenAPI 3.1.0 schema from Zod schemas.
 * The Zod schemas define the structure once, and this converts them to OpenAPI format.
 * 
 * This eliminates the need to manually maintain two separate schema definitions.
 */

// Define Zod schemas matching the MCP tool definitions
const FoodEstablishmentTypeEnum = z.enum([
  'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 
  'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery'
]);

const DietEnum = z.enum([
  "DiabeticDiet", "GlutenFreeDiet", "HalalDiet", "HinduDiet", "KosherDiet",
  "LowCalorieDiet", "LowFatDiet", "LowLactoseDiet", "LowSaltDiet",
  "VeganDiet", "VegetarianDiet",
]);

const MenuSectionSchema = z.object({
  "@type": z.string().describe("MenuSection"),
  "name": z.string().describe("Section name"),
  "description": z.string().optional().describe("Section description"),
  "identifier": z.string().describe("Section identifier"),
});

const MenuSchema = z.object({
  "@type": z.string().describe("Menu"),
  "name": z.string().describe("Menu name"),
  "description": z.string().optional().describe("Menu description"),
  "identifier": z.string().describe("Menu identifier"),
  "hasMenuSection": z.array(MenuSectionSchema).optional().describe("Array of menu sections"),
});

const PostalAddressSchema = z.object({
  "@type": z.string(),
  "streetAddress": z.string().optional(),
  "addressLocality": z.string().optional(),
  "addressRegion": z.string().optional(),
  "postalCode": z.string().optional(),
  "addressCountry": z.string().optional(),
});

const GeoCoordinatesSchema = z.object({
  "@type": z.string(),
  "latitude": z.number(),
  "longitude": z.number(),
});

const FoodEstablishmentSchema = z.object({
  "@context": z.string(),
  "@type": z.string(),
  "name": z.string(),
  "description": z.string(),
  "address": PostalAddressSchema.optional(),
  "telephone": z.string().optional(),
  "email": z.string().optional(),
  "openingHours": z.array(z.string()).optional(),
  "image": z.string().optional(),
  "servesCuisine": z.array(z.string()).optional(),
  "geo": GeoCoordinatesSchema.optional(),
  "url": z.string().optional(),
  "acceptsReservations": z.union([z.string(), z.boolean()]).optional(),
  "keywords": z.string().optional(),
  "@id": z.string().describe("Food establishment identifier"),
  "hasMenu": z.array(MenuSchema).optional(),
});

const MenuItemSchema = z.object({
  "@context": z.string(),
  "@type": z.string(),
  "name": z.string(),
  "description": z.string(),
  "identifier": z.string().optional(),
  "image": z.string().url().optional(),
  "suitableForDiet": z.array(DietEnum).optional(),
  "offers": z.object({
    "@type": z.string(),
    "price": z.number(),
    "priceCurrency": z.string(),
  }).optional(),
  "geo": GeoCoordinatesSchema.optional(),
});

// Response schemas
const SearchFoodEstablishmentsOutput = z.object({
  food_establishments: z.array(FoodEstablishmentSchema),
});

const GetMenuItemsOutput = z.object({
  "@context": z.string(),
  "@type": z.string(),
  "name": z.string(),
  "description": z.string().optional(),
  "identifier": z.string(),
  "hasMenuItem": z.array(MenuItemSchema),
});

const SearchMenuItemsOutput = z.object({
  "@context": z.string(),
  "@graph": z.array(z.object({
    "@type": z.string(),
    "name": z.string(),
    "geo": GeoCoordinatesSchema.optional(),
    "@id": z.string(),
    "hasMenu": z.array(z.object({
      "@type": z.string(),
      "name": z.string(),
      "description": z.string().optional(),
      "identifier": z.string(),
      "hasMenuItem": z.array(MenuItemSchema),
    })),
  })),
});

const MakeReservationOutput = z.object({
  "@context": z.string(),
  "@type": z.string(),
  "reservationId": z.number().optional(),
  "reservationStatus": z.string().optional(),
  "actionStatus": z.string().optional(),
  "underName": z.object({
    "@type": z.string(),
    "name": z.string(),
    "email": z.string().optional(),
    "telephone": z.string().optional(),
  }).optional(),
  "broker": z.object({
    "@type": z.string(),
    "name": z.string(),
    "legalName": z.string(),
  }).optional(),
  "reservationFor": z.object({
    "@type": z.string(),
    "name": z.string(),
    "address": PostalAddressSchema.optional(),
  }).optional(),
  "startTime": z.string().optional(),
  "endTime": z.string().optional(),
  "partySize": z.number().optional(),
  "error": z.object({
    "@type": z.string(),
    "name": z.string(),
    "description": z.string(),
  }).optional(),
});

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
                  schema: zodToJsonSchema(SearchFoodEstablishmentsOutput as any, { $refStrategy: "none" })
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
                  schema: zodToJsonSchema(GetMenuItemsOutput as any, { $refStrategy: "none" })
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
                  schema: zodToJsonSchema(SearchMenuItemsOutput as any, { $refStrategy: "none" })
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
                  schema: zodToJsonSchema(MakeReservationOutput as any, { $refStrategy: "none" })
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
