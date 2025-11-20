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
  extractMenuItemSchemaOrgData,
  npubToPubkey,
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
      const { foodEstablishmentType, cuisine, query, dietary } = args;
      
      const results = profiles.filter((profile) => {
        // STRICT: First check if profile has valid schema.org:FoodEstablishment tag
        const foodEstablishmentTag = profile.tags.find(t => t[0] === 'schema.org:FoodEstablishment');
        if (!foodEstablishmentTag || !foodEstablishmentTag[1]) {
          return false; // Ignore profiles without valid schema.org:FoodEstablishment tag
        }

        const establishmentType = foodEstablishmentTag[1];

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
              // Check schema.org:FoodEstablishment:servesCuisine tag
              if (tag[0] === 'schema.org:FoodEstablishment:servesCuisine' && tag[1]) {
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
              if (tag[0]?.startsWith('schema.org:PostalAddress:') && tag[1]) {
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
        .map((p) => extractSchemaOrgData(p, collections))
        .filter((data): data is Record<string, any> => data !== null);

      const structuredContent = {
        food_establishments: establishmentList,
      };
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
      const { restaurant_id, menu_identifier } = args;
      
      // Convert npub to hex pubkey for lookup
      const establishmentPubkey = npubToPubkey(restaurant_id);
      
      // Find food establishment by pubkey
      const establishment = profiles.find(p => p.pubkey === establishmentPubkey);
      if (!establishment) {
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
      
      // Find the collection (menu)
      const collection = findCollection(collections, establishmentPubkey, menu_identifier);
      if (!collection) {
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
      
      // Find products in this collection
      const menuItems = findProductsInCollection(products, establishmentPubkey, menu_identifier);
      
      // Convert to JSON-LD MenuItem format (without seller since restaurant_id is already specified)
      const menuItemsJsonLd = menuItems
        .map(item => extractMenuItemSchemaOrgData(item, false))
        .filter((item): item is Record<string, any> => item !== null);
      
      // Extract menu properties from collection (same as in search_food_establishments)
      const titleTag = collection.tags.find(t => t[0] === 'title');
      const summaryTag = collection.tags.find(t => t[0] === 'summary');
      const dTag = collection.tags.find(t => t[0] === 'd');
      
      const menuObject = {
        "@context": "https://schema.org",
        "@type": "Menu",
        "name": titleTag?.[1] || '',
        "description": summaryTag?.[1] || undefined,
        "identifier": dTag?.[1] || '',
        "hasMenuItem": menuItemsJsonLd,
      };
      
      // Remove description if empty
      if (!menuObject.description) {
        delete menuObject.description;
      }
      
      return {
        structuredContent: menuObject,
        content: [
          {
            type: "text",
            text: JSON.stringify(menuObject, null, 2),
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
      const { dish_query, dietary, restaurant_id } = args;
      
      // Filter products by food establishment if specified
      const productsToSearch = restaurant_id
        ? products.filter(p => p.pubkey === npubToPubkey(restaurant_id))
        : products;
      
      // Check if dish_query might be a dietary term
      const commonDietaryTerms = ['vegan', 'vegetarian', 'gluten free', 'gluten-free', 'dairy free', 'dairy-free', 'nut free', 'nut-free'];
      const queryLower = dish_query.toLowerCase();
      const mightBeDietaryQuery = commonDietaryTerms.some(term => queryLower.includes(term));
      
      // If no dietary parameter but query looks like a dietary term, use it as dietary filter too
      const effectiveDietary = dietary || (mightBeDietaryQuery ? dish_query : undefined);
      
      // Collect matching products
      const matchingProducts: NostrEvent[] = [];
      
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
          matchingProducts.push(product);
        }
      }

      // Group products by establishment and menu
      // Structure: Map<establishmentPubkey, Map<menuId, products[]>>
      const establishmentMap = new Map<string, Map<string, NostrEvent[]>>();
      
      for (const product of matchingProducts) {
        const establishmentPubkey = product.pubkey;
        
        // Get menus this product belongs to
        const menuTags = product.tags
          .filter(t => t[0] === 'a' && t[1] === '30405')
          .map(t => t[3])
          .filter(Boolean);
        
        if (!establishmentMap.has(establishmentPubkey)) {
          establishmentMap.set(establishmentPubkey, new Map());
        }
        const menuMap = establishmentMap.get(establishmentPubkey)!;
        
        if (menuTags.length > 0) {
          // Add product to each menu it belongs to
          for (const menuId of menuTags) {
            if (!menuMap.has(menuId)) {
              menuMap.set(menuId, []);
            }
            menuMap.get(menuId)!.push(product);
          }
        } else {
          // Product not in any menu - use empty string as key
          if (!menuMap.has('')) {
            menuMap.set('', []);
          }
          menuMap.get('')!.push(product);
        }
      }
      
      // Build @graph structure
      const graph: Record<string, any>[] = [];
      
      for (const [establishmentPubkey, menuMap] of establishmentMap) {
        // Get establishment profile
        const profile = profiles.find(p => p.pubkey === establishmentPubkey);
        if (!profile) continue;
        
        // Extract basic establishment info (name, geo, @id, @type)
        const establishmentData = extractSchemaOrgData(profile);
        if (!establishmentData) continue;
        
        // Build hasMenu array
        const hasMenu: Record<string, any>[] = [];
        
        for (const [menuId, menuProducts] of menuMap) {
          if (menuId === '') {
            // Products not in any menu - skip for now or handle differently
            continue;
          }
          
          // Find the collection (menu) to get menu name and description
          const collection = findCollection(collections, establishmentPubkey, menuId);
          if (!collection) continue;
          
          const titleTag = collection.tags.find(t => t[0] === 'title');
          const summaryTag = collection.tags.find(t => t[0] === 'summary');
          const dTag = collection.tags.find(t => t[0] === 'd');
          
          // Convert products to MenuItem format
          // Note: menuProducts only contains products that matched the search query
          // Seller not included since results are organized by restaurant
          const menuItems = menuProducts
            .map(item => extractMenuItemSchemaOrgData(item, false))
            .filter((item): item is Record<string, any> => item !== null);
          
          const menuObject: Record<string, any> = {
            "@type": "Menu",
            "name": titleTag?.[1] || '',
            "identifier": dTag?.[1] || '',
            "hasMenuItem": menuItems,
          };
          
          if (summaryTag?.[1]) {
            menuObject.description = summaryTag[1];
          }
          
          hasMenu.push(menuObject);
        }
        
        // Build establishment object
        const establishmentObject: Record<string, any> = {
          "@type": establishmentData["@type"],
          "name": establishmentData.name,
          "@id": establishmentData["@id"],
        };
        
        if (establishmentData.geo) {
          establishmentObject.geo = establishmentData.geo;
        }
        
        if (hasMenu.length > 0) {
          establishmentObject.hasMenu = hasMenu;
        }
        
        graph.push(establishmentObject);
      }
      
      const totalItems = matchingProducts.length;
      const structuredContent = {
        "@context": "https://schema.org",
        "@graph": graph,
      };
      
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
      const { restaurant_id, time, party_size, name, telephone, email } = args;

      // Validate ISO 8601 time format and extract components
      let startTimeStr: string;
      let endTimeStr: string;
      let timezoneOffset: string = "";
      try {
        // Parse ISO 8601 string: YYYY-MM-DDTHH:mm:ss[+-]HH:mm or YYYY-MM-DDTHH:mm:ssZ
        const iso8601Regex = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)?$/;
        const match = time.match(iso8601Regex);
        if (!match) {
          throw new Error("Invalid ISO 8601 format");
        }
        
        const datePart = match[1]; // YYYY-MM-DD
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3], 10);
        const seconds = parseInt(match[4], 10);
        const tzPart = match[5]; // timezone part or undefined
        
        // Validate date components
        const [year, month, day] = datePart.split('-').map(Number);
        if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
          throw new Error("Invalid date or time values");
        }
        
        // Extract timezone from input (preserve for output)
        if (tzPart) {
          timezoneOffset = tzPart === "Z" ? "+00:00" : tzPart;
        } else {
          // If no timezone specified, use local timezone offset
          const testDate = new Date(time);
          const offset = -testDate.getTimezoneOffset();
          const offsetHours = Math.floor(Math.abs(offset) / 60);
          const offsetMinutes = Math.abs(offset) % 60;
          const sign = offset >= 0 ? "+" : "-";
          timezoneOffset = `${sign}${offsetHours.toString().padStart(2, "0")}:${offsetMinutes.toString().padStart(2, "0")}`;
        }

        // Calculate end time by adding 90 minutes
        let endHours = hours;
        let endMinutes = minutes + 90;
        let endDay = day;
        let endMonth = month;
        let endYear = year;
        
        // Handle minute overflow
        while (endMinutes >= 60) {
          endMinutes -= 60;
          endHours += 1;
        }
        
        // Handle hour overflow
        while (endHours >= 24) {
          endHours -= 24;
          endDay += 1;
        }
        
        // Handle day overflow (simplified - doesn't account for month lengths)
        // This is acceptable for reservation purposes as we're just adding 90 minutes
        const daysInMonth = new Date(year, month, 0).getDate();
        if (endDay > daysInMonth) {
          endDay = 1;
          endMonth += 1;
          if (endMonth > 12) {
            endMonth = 1;
            endYear += 1;
          }
        }
        
        // Format times preserving original timezone
        const formatTime = (y: number, m: number, d: number, h: number, min: number, s: number): string => {
          return `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}T${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}${timezoneOffset}`;
        };
        
        startTimeStr = formatTime(year, month, day, hours, minutes, seconds);
        endTimeStr = formatTime(endYear, endMonth, endDay, endHours, endMinutes, seconds);
      } catch (error) {
        const errorResponse = {
          "@context": "https://schema.org",
          "@type": "ReserveAction",
          "actionStatus": "FailedActionStatus",
          "error": {
            "@type": "Thing",
            "name": "InvalidReservationRequest",
            "description": "Invalid time format. Time must be in ISO 8601 format (e.g., '2025-10-22T08:00:00-07:00').",
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

      // Convert restaurant_id from npub to pubkey
      let establishmentPubkey: string;
      try {
        establishmentPubkey = npubToPubkey(restaurant_id);
      } catch (error) {
        const errorResponse = {
          "@context": "https://schema.org",
          "@type": "ReserveAction",
          "actionStatus": "FailedActionStatus",
          "error": {
            "@type": "Thing",
            "name": "InvalidReservationRequest",
            "description": "Invalid restaurant_id format. Must be a valid npub identifier from search_food_establishments results.",
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

      // Find restaurant profile
      const establishment = profiles.find(p => p.pubkey === establishmentPubkey);
      if (!establishment) {
        const errorResponse = {
          "@context": "https://schema.org",
          "@type": "ReserveAction",
          "actionStatus": "FailedActionStatus",
          "error": {
            "@type": "Thing",
            "name": "InvalidReservationRequest",
            "description": "Restaurant not found. Please verify the restaurant_id is correct.",
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

      // Extract restaurant data
      const restaurantData = extractSchemaOrgData(establishment);
      if (!restaurantData) {
        const errorResponse = {
          "@context": "https://schema.org",
          "@type": "ReserveAction",
          "actionStatus": "FailedActionStatus",
          "error": {
            "@type": "Thing",
            "name": "InvalidReservationRequest",
            "description": "Restaurant profile is invalid or incomplete.",
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


      // Generate random reservation ID (number for now)
      const reservationId = Math.floor(Math.random() * 1000000000);

      // Build underName object
      const underName: any = {
        "@type": "Person",
        "name": name,
      };
      if (email) {
        underName.email = email.startsWith("mailto:") ? email : `mailto:${email}`;
      }
      if (telephone) {
        underName.telephone = telephone.startsWith("tel:") ? telephone : `tel:${telephone}`;
      }

      // Build reservationFor object
      const reservationFor: any = {
        "@type": "FoodEstablishment",
        "name": restaurantData.name,
      };
      if (restaurantData.address) {
        reservationFor.address = restaurantData.address;
      }

      // Build success response
      const successResponse = {
        "@context": "https://schema.org",
        "@type": "FoodEstablishmentReservation",
        "reservationId": reservationId,
        "reservationStatus": "ReservationConfirmed",
        "underName": underName,
        "broker": {
          "@type": "Organization",
          "name": "Synvya",
          "legalName": "Synvya Inc.",
        },
        "reservationFor": reservationFor,
        "startTime": startTimeStr,
        "endTime": endTimeStr,
        "partySize": party_size,
      };

      return {
        structuredContent: successResponse,
        content: [
          {
            type: "text",
            text: JSON.stringify(successResponse, null, 2),
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

