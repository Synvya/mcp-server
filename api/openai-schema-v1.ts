import type { VercelRequest, VercelResponse } from '@vercel/node';

// OpenAI function calling schema for all tools
const openaiSchema = {
  tools: [
    {
      type: "function",
      function: {
        name: "search_food_establishments",
        description: "Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. Example: {'foodEstablishmentType': 'Restaurant', 'cuisine': 'Spanish', 'dietary': 'vegan'} to find vegan Spanish restaurants.",
        parameters: {
          type: "object",
          properties: {
            foodEstablishmentType: {
              type: "string",
              enum: ['Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery'],
              description: "Filter by schema.org FoodEstablishment type. If not provided, returns all FoodEstablishment types. Valid values: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, Winery."
            },
            cuisine: {
              type: "string",
              description: "Cuisine type (e.g., 'Spanish', 'Italian', 'Mexican'). Searches schema.org:servesCuisine tags first, then falls back to description text matching."
            },
            query: {
              type: "string",
              description: "Free-text search matching establishment name, location (schema.org:PostalAddress), or description. Example: 'Snoqualmie' to find establishments in that location."
            },
            dietary: {
              type: "string",
              description: "Dietary requirement (e.g., 'vegan', 'gluten free'). Matches against lowercase dietary tags in profiles. Tags are normalized for flexible matching (handles 'gluten free' vs 'gluten-free')."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_menu_items",
        description: "Get all dishes from a specific food establishment menu. IMPORTANT: Use the exact '@id' field from search_food_establishments results as restaurant_id, and use the 'identifier' from the 'hasMenu' array for menu_identifier. Do NOT use establishment names or guess menu names. Example: {'restaurant_id': 'nostr:npub1...', 'menu_identifier': 'Dinner'}",
        parameters: {
          type: "object",
          properties: {
            restaurant_id: {
              type: "string",
              description: "Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results. The identifier is reported as '@id' in the JSON-LD output. Using establishment names will fail."
            },
            menu_identifier: {
              type: "string",
              description: "Menu identifier - MUST be the exact 'identifier' value from the 'hasMenu' array in search_food_establishments results. Each menu in the 'hasMenu' array has an 'identifier' field that should be used here. Do NOT guess menu names."
            }
          },
          required: ["restaurant_id", "menu_identifier"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_menu_items",
        description: "Find specific dishes across all food establishments by name, ingredient, or dietary preference. Returns a JSON-LD graph structure with food establishments grouped by their matching menu items. Automatically detects if dish_query is a dietary term (vegan, vegetarian, gluten-free, etc.) and matches against dietary tags. Example: {'dish_query': 'pizza', 'dietary': 'vegan'} or {'dish_query': 'vegan'} (auto-detects as dietary term).",
        parameters: {
          type: "object",
          properties: {
            dish_query: {
              type: "string",
              description: "Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions. If the query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name. Example: 'pizza' or 'vegan' or 'tomato'"
            },
            dietary: {
              type: "string",
              description: "Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic. If dish_query is already a dietary term, this adds an additional constraint."
            },
            restaurant_id: {
              type: "string",
              description: "Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results. The identifier is reported as '@id' in bech32 format (nostr:npub1...) in the JSON-LD output."
            }
          },
          required: ["dish_query"]
        }
      }
    }
  ]
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json(openaiSchema);
}

