import { z } from "zod";

/**
 * Shared Schema Definitions
 * 
 * This file contains all Zod schemas used by both:
 * - MCP Server (register-tools.ts)
 * - OpenAPI Generation (generate-openapi.ts)
 * 
 * SINGLE SOURCE OF TRUTH - Define schemas once, use everywhere.
 */

// ============================================================================
// ENUMS
// ============================================================================

export const FoodEstablishmentTypeEnum = z.enum([
  'Bakery',
  'BarOrPub',
  'Brewery',
  'CafeOrCoffeeShop',
  'Distillery',
  'FastFoodRestaurant',
  'IceCreamShop',
  'Restaurant',
  'Winery'
]);

export const DietEnum = z.enum([
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
]);

export const OfferTypeEnum = z.enum([
  'coupon',
  'discount',
  'bogo',
  'free-item',
  'happy-hour'
]);

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

export const PostalAddressSchema = z.object({
  "@type": z.string(),
  streetAddress: z.string().optional(),
  addressLocality: z.string().optional(),
  addressRegion: z.string().optional(),
  postalCode: z.string().optional(),
  addressCountry: z.string().optional(),
});

export const GeoCoordinatesSchema = z.object({
  "@type": z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

// ============================================================================
// MENU SCHEMAS
// ============================================================================

export const MenuSectionSchema: z.ZodType<any> = z.lazy(() => z.object({
  "@type": z.string().describe("MenuSection"),
  name: z.string().describe("Section name (e.g., 'Appetizers', 'Entrees', 'Sides')"),
  description: z.string().optional().describe("Section description"),
  identifier: z.string().describe("Section identifier"),
  hasMenuItem: z.array(MenuItemSchema).optional().describe("Array of menu items in this section"),
}));

export const MenuSchema = z.object({
  "@type": z.string().describe("Menu"),
  name: z.string().describe("Menu name"),
  description: z.string().optional().describe("Menu description"),
  identifier: z.string().describe("Menu identifier - use this as menu_identifier for get_menu_items"),
  hasMenuSection: z.array(MenuSectionSchema).optional().describe("Array of menu sections within this menu"),
});

export const MenuItemSchema = z.object({
  "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
  "@type": z.string().describe("JSON-LD type, always 'MenuItem'"),
  name: z.string().describe("Name of the menu item"),
  description: z.string().describe("Description of the menu item"),
  identifier: z.string().optional().describe("Menu item identifier"),
  image: z.string().url().optional().describe("Image URL for the menu item"),
  suitableForDiet: z.array(DietEnum).optional().describe("Array of schema.org suitableForDiet values (e.g., 'VeganDiet', 'GlutenFreeDiet')"),
  offers: z.object({
    "@type": z.string().describe("Always 'Offer'"),
    price: z.number().describe("Price as number"),
    priceCurrency: z.string().describe("Currency code (e.g., 'USD')"),
  }).optional().describe("Price information formatted as schema.org Offer"),
  geo: GeoCoordinatesSchema.optional().describe("Geographic coordinates"),
});

export const OfferSchema = z.object({
  "@type": z.string().describe("Always 'Offer'"),
  identifier: z.string().describe("Offer identifier from d tag"),
  description: z.string().describe("Offer description"),
  category: OfferTypeEnum.describe("Offer type: coupon, discount, bogo, free-item, or happy-hour"),
  validFrom: z.string().describe("ISO 8601 timestamp with timezone (e.g., '2026-01-08T16:00:00-08:00')"),
  validThrough: z.string().describe("ISO 8601 timestamp with timezone (e.g., '2026-02-07T17:00:00-08:00')"),
});

// ============================================================================
// FOOD ESTABLISHMENT SCHEMAS
// ============================================================================

export const FoodEstablishmentSchema = z.object({
  "@context": z.string().describe("JSON-LD context (https://schema.org)"),
  "@type": z.string().describe("Schema.org FoodEstablishment type: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, or Winery"),
  name: z.string().describe("Restaurant name"),
  description: z.string().describe("Restaurant description"),
  address: PostalAddressSchema.optional().describe("PostalAddress from schema.org"),
  telephone: z.string().optional(),
  email: z.string().optional().describe("Email in mailto: format"),
  openingHours: z.array(z.string()).optional().describe("Opening hours in format: ['Mo-Fr 10:00-19:00', 'Sa 10:00-22:00']"),
  image: z.string().optional().describe("Banner image URL"),
  servesCuisine: z.array(z.string()).optional().describe("Array of cuisine types"),
  geo: GeoCoordinatesSchema.optional().describe("GeoCoordinates from schema.org"),
  url: z.string().optional().describe("Website URL"),
  acceptsReservations: z.union([z.string(), z.boolean()]).optional().describe("True, False, or URL"),
  keywords: z.string().optional().describe("Comma-separated keywords from tags"),
  "@id": z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...) - use this as restaurant_id for get_menu_items"),
  hasMenu: z.array(MenuSchema).optional().describe("Array of menus available at this establishment"),
});

// ============================================================================
// TOOL INPUT SCHEMAS
// ============================================================================

export const SearchFoodEstablishmentsInputSchema = z.object({
  foodEstablishmentType: FoodEstablishmentTypeEnum.optional().describe("Filter by schema.org FoodEstablishment type. If not provided, returns all FoodEstablishment types. Valid values: Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, Winery."),
  cuisine: z.string().optional().describe("Cuisine type (e.g., 'Spanish', 'Italian', 'Mexican'). Searches schema.org:servesCuisine tags first, then falls back to description text matching."),
  query: z.string().optional().describe("Free-text search matching establishment name, location (schema.org:PostalAddress), or description. Example: 'Snoqualmie' to find establishments in that location."),
  dietary: z.string().optional().describe("Dietary requirement (e.g., 'vegan', 'gluten free'). Matches against lowercase dietary tags in profiles. Tags are normalized for flexible matching (handles 'gluten free' vs 'gluten-free')."),
});

export const GetMenuItemsInputSchema = z.object({
  restaurant_id: z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results. The identifier is reported as '@id' in the JSON-LD output. Using establishment names will fail."),
  menu_identifier: z.string().describe("Menu identifier - MUST be the exact 'identifier' value from the 'hasMenu' array in search_food_establishments results. Each menu in the 'hasMenu' array has an 'identifier' field that should be used here. Do NOT guess menu names."),
});

export const SearchMenuItemsInputSchema = z.object({
  dish_query: z.string().describe("Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions. If the query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name. Example: 'pizza' or 'vegan' or 'tomato'"),
  dietary: z.string().optional().describe("Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic. If dish_query is already a dietary term, this adds an additional constraint."),
  restaurant_id: z.string().optional().describe("Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results. The identifier is reported as '@id' in bech32 format (nostr:npub1...) in the JSON-LD output."),
});

export const MakeReservationInputSchema = z.object({
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
);

export const SearchOffersInputSchema = z.object({
  offer_type: OfferTypeEnum.optional().describe("Filter by offer type. Valid values: coupon, discount, bogo, free-item, happy-hour."),
  restaurant_id: z.string().optional().describe("Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results. The identifier is reported as '@id' in bech32 format (nostr:npub1...) in the JSON-LD output."),
});

// ============================================================================
// TOOL OUTPUT SCHEMAS
// ============================================================================

export const SearchFoodEstablishmentsOutputSchema = z.object({
  food_establishments: z.array(FoodEstablishmentSchema).describe("Array of JSON-LD formatted food establishment objects following schema.org FoodEstablishment specification. May contain mixed types (Restaurant, Bakery, etc.)"),
});

export const GetMenuItemsOutputSchema = z.object({
  "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
  "@type": z.string().describe("JSON-LD type, always 'Menu'"),
  name: z.string().describe("Menu name"),
  description: z.string().optional().describe("Menu description"),
  identifier: z.string().describe("Menu identifier"),
  hasMenuItem: z.array(MenuItemSchema).optional().describe("Array of menu items directly in the menu (not in sections)"),
  hasMenuSection: z.array(MenuSectionSchema).optional().describe("Array of menu sections, each containing menu items grouped by section"),
});

export const SearchMenuItemsOutputSchema = z.object({
  "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
  "@graph": z.array(z.object({
    "@type": z.string().describe("Schema.org FoodEstablishment type (Restaurant, Bakery, etc.)"),
    name: z.string().describe("Food establishment name"),
    geo: GeoCoordinatesSchema.optional().describe("Geographic coordinates"),
    "@id": z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...)"),
    hasMenu: z.array(z.object({
      "@type": z.string().describe("Always 'Menu'"),
      name: z.string().describe("Menu name"),
      description: z.string().optional().describe("Menu description"),
      identifier: z.string().describe("Menu identifier"),
      hasMenuItem: z.array(MenuItemSchema).optional().describe("Array of menu items directly in the menu (not in sections)"),
      hasMenuSection: z.array(MenuSectionSchema).optional().describe("Array of menu sections, each containing grouped menu items"),
    })),
  })),
});

export const MakeReservationOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.string().describe("Either 'FoodEstablishmentReservation' for success or 'ReserveAction' for errors"),
  reservationId: z.number().optional().describe("Reservation ID (present only on success)"),
  reservationStatus: z.string().optional().describe("Reservation status (present only on success)"),
  actionStatus: z.string().optional().describe("Action status (present only on errors)"),
  underName: z.object({
    "@type": z.string(),
    name: z.string(),
    email: z.string().optional(),
    telephone: z.string().optional(),
  }).optional().describe("Customer information (present only on success)"),
  broker: z.object({
    "@type": z.string(),
    name: z.string(),
    legalName: z.string(),
  }).optional().describe("Broker information (present only on success)"),
  reservationFor: z.object({
    "@type": z.string(),
    name: z.string(),
    address: PostalAddressSchema.optional(),
  }).optional().describe("Restaurant information (present only on success)"),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  partySize: z.number().optional().describe("Party size (present only on success)"),
  error: z.object({
    "@type": z.string(),
    name: z.string(),
    description: z.string(),
  }).optional().describe("Error information (present only on errors)"),
});

export const SearchOffersOutputSchema = z.object({
  "@context": z.string().describe("JSON-LD context, always 'https://schema.org'"),
  "@graph": z.array(z.object({
    "@type": z.string().describe("Schema.org FoodEstablishment type (Restaurant, Bakery, etc.)"),
    name: z.string().describe("Food establishment name"),
    geo: GeoCoordinatesSchema.optional().describe("Geographic coordinates"),
    "@id": z.string().describe("Food establishment identifier in bech32 format (nostr:npub1...)"),
    makesOffer: z.array(OfferSchema).describe("Array of Offer objects"),
  })),
});
