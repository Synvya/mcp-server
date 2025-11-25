import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type NostrEvent } from './data-loader.js';
import {
  searchFoodEstablishments,
  getMenuItems,
  searchMenuItems,
  makeReservation,
  type ToolData,
} from './tool-handlers.js';

// Re-export ToolData for backwards compatibility
export type { ToolData };

export function registerTools(server: McpServer, data: ToolData) {
  const { profiles, collections, products, calendar, tables } = data;

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
          "@id": z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...) - use this as restaurant_id for get_menu_items"),
          "hasMenu": z.array(z.object({
            "@type": z.string().describe("Menu"),
            "name": z.string().describe("Menu name"),
            "description": z.string().optional().describe("Menu description"),
            "identifier": z.string().describe("Menu identifier - use this as menu_identifier for get_menu_items"),
          })).optional().describe("Array of menus available at this establishment"),
        })).describe("Array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. May contain mixed types (Restaurant, Bakery, etc.)"),
      }),
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
      inputSchema: z.object({
        restaurant_id: z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results. The identifier is reported as '@id' in the JSON-LD output. Using establishment names will fail."),
        menu_identifier: z.string().describe("Menu identifier - MUST be the exact 'identifier' value from the 'hasMenu' array in search_food_establishments results. Each menu in the 'hasMenu' array has an 'identifier' field that should be used here. Do NOT guess menu names."),
      }),
      outputSchema: z.object({
        "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
        "@type": z.string().describe("JSON-LD type, always 'Menu'"),
        "name": z.string().describe("Menu name"),
        "description": z.string().optional().describe("Menu description"),
        "identifier": z.string().describe("Menu identifier"),
        "hasMenuItem": z.array(z.object({
          "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
          "@type": z.string().describe("JSON-LD type, always 'MenuItem'"),
          "name": z.string().describe("Name of the menu item"),
          "description": z.string().describe("Description of the menu item"),
          "identifier": z.string().optional().describe("Menu item identifier"),
          "image": z.string().url().optional().describe("Image URL for the menu item"),
          "suitableForDiet": z.array(z.enum([
            "DiabeticDiet",
            "GlutenFreeDiet",
            "HalalDiet",
            "HinduDiet",
            "KosherDiet",
            "LowCalorieDiet",
            "LowFatDiet",
            "LowLactoseDiet",
            "LowSaltDiet",
            "VeganDiet",
            "VegetarianDiet",
          ])).optional().describe("Array of schema.org suitableForDiet values (e.g., 'VeganDiet', 'GlutenFreeDiet')"),
          "offers": z.object({
            "@type": z.string().describe("Always 'Offer'"),
            "price": z.number().describe("Price as number"),
            "priceCurrency": z.string().describe("Currency code (e.g., 'USD')"),
          }).optional().describe("Price information formatted as schema.org Offer (seller not included since restaurant_id is already specified)"),
          "geo": z.object({
            "@type": z.string().describe("Always 'GeoCoordinates'"),
            "latitude": z.number().describe("Latitude"),
            "longitude": z.number().describe("Longitude"),
          }).optional().describe("Geographic coordinates"),
        })).describe("Array of JSON-LD formatted menu item objects following schema.org MenuItem specification"),
      }),
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
          "hasMenuItem": [],
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
      inputSchema: z.object({
        dish_query: z.string().describe("Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions. If the query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name. Example: 'pizza' or 'vegan' or 'tomato'"),
        dietary: z.string().optional().describe("Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic. If dish_query is already a dietary term, this adds an additional constraint."),
        restaurant_id: z.string().optional().describe("Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results. The identifier is reported as '@id' in bech32 format (nostr:npub1...) in the JSON-LD output."),
      }),
      outputSchema: z.object({
        "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
        "@graph": z.array(z.object({
          "@type": z.string().describe("Schema.org FoodEstablishment type (Restaurant, Bakery, etc.)"),
          "name": z.string().describe("Food establishment name"),
          "geo": z.object({
            "@type": z.string().describe("Always 'GeoCoordinates'"),
            "latitude": z.number(),
            "longitude": z.number(),
          }).optional().describe("Geographic coordinates"),
          "@id": z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...)"),
          "hasMenu": z.array(z.object({
            "@type": z.string().describe("Always 'Menu'"),
            "name": z.string().describe("Menu name"),
            "description": z.string().optional().describe("Menu description"),
            "identifier": z.string().describe("Menu identifier"),
            "hasMenuItem": z.array(z.object({
              "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
              "@type": z.string().describe("JSON-LD type, always 'MenuItem'"),
              "name": z.string().describe("Name of the menu item"),
              "description": z.string().describe("Description of the menu item"),
              "identifier": z.string().optional().describe("Menu item identifier"),
              "image": z.string().url().optional().describe("Image URL for the menu item"),
              "suitableForDiet": z.array(z.enum([
                "DiabeticDiet",
                "GlutenFreeDiet",
                "HalalDiet",
                "HinduDiet",
                "KosherDiet",
                "LowCalorieDiet",
                "LowFatDiet",
                "LowLactoseDiet",
                "LowSaltDiet",
                "VeganDiet",
                "VegetarianDiet",
              ])).optional().describe("Array of schema.org suitableForDiet values (e.g., 'VeganDiet', 'GlutenFreeDiet')"),
              "offers": z.object({
                "@type": z.string().describe("Always 'Offer'"),
                "price": z.number().describe("Price as number"),
                "priceCurrency": z.string().describe("Currency code (e.g., 'USD')"),
              }).optional().describe("Price information formatted as schema.org Offer (seller not included since results are organized by restaurant)"),
              "geo": z.object({
                "@type": z.string().describe("Always 'GeoCoordinates'"),
                "latitude": z.number().describe("Latitude"),
                "longitude": z.number().describe("Longitude"),
              }).optional().describe("Geographic coordinates"),
            })),
          })),
        })),
      }),
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
      inputSchema: z.object({
        restaurant_id: z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results."),
        time: z.string().describe("Reservation start time in ISO 8601 format (e.g., '2025-10-22T08:00:00-07:00')"),
        party_size: z.number().int().positive().describe("Number of people in the party (must be a positive integer)"),
        name: z.string().min(1).describe("Customer name"),
        telephone: z.string().optional().describe("Customer telephone number"),
        email: z.string().email().optional().describe("Customer email address"),
      }).refine(
        (data) => data.telephone || data.email,
        {
          message: "At least one of telephone or email must be provided",
          path: ["telephone", "email"],
        }
      ),
      outputSchema: z.object({
        "@context": z.string(),
        "@type": z.string().describe("Either 'FoodEstablishmentReservation' for success or 'ReserveAction' for errors"),
        "reservationId": z.number().optional().describe("Reservation ID (present only on success)"),
        "reservationStatus": z.string().optional().describe("Reservation status (present only on success)"),
        "actionStatus": z.string().optional().describe("Action status (present only on errors)"),
        "underName": z.object({
          "@type": z.string(),
          "name": z.string(),
          "email": z.string().optional(),
          "telephone": z.string().optional(),
        }).optional().describe("Customer information (present only on success)"),
        "broker": z.object({
          "@type": z.string(),
          "name": z.string(),
          "legalName": z.string(),
        }).optional().describe("Broker information (present only on success)"),
        "reservationFor": z.object({
          "@type": z.string(),
          "name": z.string(),
          "address": z.object({
            "@type": z.string(),
            "streetAddress": z.string().optional(),
            "addressLocality": z.string().optional(),
            "addressRegion": z.string().optional(),
            "postalCode": z.string().optional(),
            "addressCountry": z.string().optional(),
          }).optional(),
        }).optional().describe("Restaurant information (present only on success)"),
        "startTime": z.string().optional(),
        "endTime": z.string().optional(),
        "partySize": z.number().optional().describe("Party size (present only on success)"),
        "error": z.object({
          "@type": z.string(),
          "name": z.string(),
          "description": z.string(),
        }).optional().describe("Error information (present only on errors)"),
      }),
    },
    async (args) => {
      try {
        const structuredContent = makeReservation(args, {
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

