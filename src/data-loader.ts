import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { bech32 } from '@scure/base';

const require = createRequire(import.meta.url);
const ngeohash = require('ngeohash');

// Get the directory of the current module (works in both ESM and CommonJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root (go up from dist/ to project root)
const projectRoot = join(__dirname, '..');

// Convert hex pubkey to bech32 npub format
export function pubkeyToNpub(hexPubkey: string): string {
  try {
    // Convert hex string to bytes
    const bytes = Buffer.from(hexPubkey, 'hex');
    // Encode to bech32 with 'npub' prefix
    const npub = bech32.encode('npub', bech32.toWords(bytes));
    return `nostr:${npub}`;
  } catch (error) {
    console.error('Error converting pubkey to npub:', error);
    // Fallback to hex if conversion fails
    return hexPubkey;
  }
}

// Convert bech32 npub format back to hex pubkey
export function npubToPubkey(npub: string): string {
  try {
    // Remove 'nostr:' prefix if present
    const cleanNpub = npub.replace(/^nostr:/, '');
    // Decode bech32 - decode returns { prefix: string, words: number[] }
    // @ts-ignore - bech32.decode has strict typing but accepts strings at runtime
    const decoded = bech32.decode(cleanNpub);
    // Convert words to bytes
    const bytes = Buffer.from(bech32.fromWords(decoded.words));
    // Convert bytes to hex
    return bytes.toString('hex');
  } catch (error) {
    console.error('Error converting npub to pubkey:', error);
    // If it's already hex, return as-is
    return npub;
  }
}

export type NostrEvent = {
  kind: number;
  pubkey: string;
  content: string | Record<string, any>;
  tags: string[][];
  id?: string;
  created_at?: number;
  sig?: string;
};

export async function loadProfileData(): Promise<NostrEvent[]> {
  try {
    const data = await fs.readFile(join(projectRoot, 'data', 'profiles.json'), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading profile data:', error);
    throw new Error('Failed to load profile data');
  }
}

export async function loadCollectionsData(): Promise<NostrEvent[]> {
  try {
    const data = await fs.readFile(join(projectRoot, 'data', 'collections.json'), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading collections data:', error);
    throw new Error('Failed to load collections data');
  }
}

export async function loadProductsData(): Promise<NostrEvent[]> {
  try {
    const data = await fs.readFile(join(projectRoot, 'data', 'products.json'), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading products data:', error);
    throw new Error('Failed to load products data');
  }
}

// Parse Nostr event content (may be JSON or plain text with markdown)
export function parseContent(event: NostrEvent): Record<string, any> {
  if (typeof event.content === 'string') {
    try {
      return JSON.parse(event.content);
    } catch {
      return { text: event.content };
    }
  }
  return event.content;
}

// Extract dish name from markdown or use title tag
export function extractDishName(event: NostrEvent): string {
  // First try title tag
  const titleTag = event.tags.find(t => t[0] === 'title');
  if (titleTag && titleTag[1]) {
    return titleTag[1];
  }
  
  // Try to extract from markdown bold: **Dish Name**
  if (typeof event.content === 'string') {
    const boldMatch = event.content.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      return boldMatch[1].trim();
    }
    // Fallback: use first line
    return event.content.split('\n')[0].trim();
  }
  
  return 'Unknown Dish';
}

// Normalize dietary tags for matching
// Profiles: "vegan", "gluten free" (lowercase)
// Products: "VEGAN", "GLUTEN_FREE" (uppercase with underscores - Square format)
export function normalizeDietaryTag(tag: string): string {
  return tag.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

export function matchesDietaryTag(tag1: string, tag2: string): boolean {
  return normalizeDietaryTag(tag1) === normalizeDietaryTag(tag2);
}

// Find products linked to a collection via "a" tag
// Products reference collections via: ["a", "30405", pubkey, collection_id]
export function findProductsInCollection(
  products: NostrEvent[],
  restaurantPubkey: string,
  collectionId: string
): NostrEvent[] {
  return products.filter(product => {
    return product.tags.some(tag => 
      tag[0] === 'a' &&
      tag[1] === '30405' &&
      tag[2] === restaurantPubkey &&
      tag[3] === collectionId
    );
  });
}

// Find collection by restaurant and menu identifier
export function findCollection(
  collections: NostrEvent[],
  restaurantPubkey: string,
  menuId: string
): NostrEvent | undefined {
  return collections.find(collection => 
    collection.pubkey === restaurantPubkey &&
    collection.tags.some(tag => tag[0] === 'd' && tag[1] === menuId)
  );
}

// Get price from product tags
export function getPrice(event: NostrEvent): string | undefined {
  const priceTag = event.tags.find(t => t[0] === 'price');
  if (priceTag && priceTag[1]) {
    return priceTag[1];
  }
  return undefined;
}

// Check if product matches dietary requirement
export function productMatchesDietary(product: NostrEvent, dietary: string): boolean {
  // Check "t" tags (dietary tags from Square)
  const dietaryTags = product.tags
    .filter(t => t[0] === 't')
    .map(t => t[1])
    .filter(Boolean);
  
  // Also check "schema.org:MenuItem:suitableForDiet" tags
  const suitableForDietTags = product.tags
    .filter(t => t[0] === 'schema.org:MenuItem:suitableForDiet')
    .map(t => t[1])
    .filter(Boolean);
  
  const allDietaryTags = [...dietaryTags, ...suitableForDietTags];
  
  return allDietaryTags.some(tag => matchesDietaryTag(tag, dietary));
}

// Valid FoodEstablishment types from schema.org
const VALID_FOOD_ESTABLISHMENT_TYPES = [
  'Bakery',
  'BarOrPub',
  'Brewery',
  'CafeOrCoffeeShop',
  'Distillery',
  'FastFoodRestaurant',
  'IceCreamShop',
  'Restaurant',
  'Winery',
] as const;

// Extract schema.org data from Nostr profile tags and format as JSON-LD
// Returns null if profile doesn't have a valid schema.org:FoodEstablishment tag
export function extractSchemaOrgData(profile: NostrEvent, collections?: NostrEvent[]): Record<string, any> | null {
  // Extract FoodEstablishment type from schema.org:FoodEstablishment tag: ["schema.org:FoodEstablishment", "Restaurant", "https://schema.org/FoodEstablishment"]
  const foodEstablishmentTag = profile.tags.find(t => t[0] === 'schema.org:FoodEstablishment');
  if (!foodEstablishmentTag || !foodEstablishmentTag[1]) {
    return null; // STRICT: Ignore profiles without valid schema.org:FoodEstablishment tag
  }

  const establishmentType = foodEstablishmentTag[1];
  
  // STRICT: Only accept valid FoodEstablishment types
  if (!VALID_FOOD_ESTABLISHMENT_TYPES.includes(establishmentType as any)) {
    return null; // Ignore profiles with invalid FoodEstablishment type
  }

  const content = parseContent(profile);
  const schemaData: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": establishmentType,
    "name": content.display_name || content.name || 'Unknown Restaurant',
    "description": content.about || '',
  };

  // Extract servesCuisine (always as array)
  const cuisineTags = profile.tags.filter(t => t[0] === 'schema.org:FoodEstablishment:servesCuisine');
  if (cuisineTags.length > 0) {
    schemaData.servesCuisine = cuisineTags
      .map(t => t[1])
      .filter(Boolean);
  }

  // Extract address components
  const address: Record<string, string> = {};
  profile.tags.forEach(tag => {
    if (tag[0]?.startsWith('schema.org:PostalAddress:')) {
      const parts = tag[0].split(':');
      if (parts.length >= 3) {
        const prop = parts[2]; // e.g., "streetAddress", "addressLocality" (after "schema.org:PostalAddress:")
        const value = tag[1]; // Value is in tag[1]
        if (prop && value) {
          address[prop] = value;
        }
      }
    }
  });
  if (Object.keys(address).length > 0) {
    schemaData.address = {
      "@type": "PostalAddress",
      ...address,
    };
  }

  // Extract geo coordinates
  const geo: Record<string, number> = {};
  profile.tags.forEach(tag => {
    if (tag[0]?.startsWith('schema.org:GeoCoordinates:')) {
      const parts = tag[0].split(':');
      if (parts.length >= 3) {
        const prop = parts[2]; // "latitude" or "longitude" (after "schema.org:GeoCoordinates:")
        const value = parseFloat(tag[1]); // Value is in tag[1]
        if (prop && !isNaN(value)) {
          geo[prop] = value;
        }
      }
    }
  });
  if (Object.keys(geo).length > 0) {
    schemaData.geo = {
      "@type": "GeoCoordinates",
      ...geo,
    };
  }

  // Extract telephone
  const telephoneTag = profile.tags.find(t => t[0] === 'schema.org:FoodEstablishment:telephone');
  if (telephoneTag && telephoneTag[1]) {
    schemaData.telephone = telephoneTag[1]; // Value is in tag[1]
  }

  // Extract email (keep mailto: format)
  const emailTag = profile.tags.find(t => t[0] === 'schema.org:FoodEstablishment:email');
  if (emailTag && emailTag[1]) {
    schemaData.email = emailTag[1]; // Value is in tag[1]
  }

  // Extract website
  if (content.website) {
    schemaData.url = content.website;
  }

  // Extract image (banner)
  if (content.banner) {
    schemaData.image = content.banner;
  }

  // Extract acceptsReservations
  const acceptsReservationsTag = profile.tags.find(t => t[0] === 'schema.org:acceptsReservations');
  if (acceptsReservationsTag) {
    // Use tag value if present, otherwise default to "False"
    schemaData.acceptsReservations = acceptsReservationsTag[1] || "False";
  } else {
    schemaData.acceptsReservations = "False";
  }

  // Extract opening hours - single tag with comma-separated values: "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 11:00-21:00"
  const openingHoursTag = profile.tags.find(t => t[0] === 'schema.org:openingHours');
  if (openingHoursTag && openingHoursTag[1]) {
    schemaData.openingHours = openingHoursTag[1]
      .split(',')
      .map(hours => hours.trim())
      .filter(hours => hours.length > 0);
  }

  // Extract keywords (all "t" tags, comma-separated)
  const keywordTags = profile.tags
    .filter(t => t[0] === 't')
    .map(t => t[1])
    .filter(Boolean);
  if (keywordTags.length > 0) {
    schemaData.keywords = keywordTags.join(', ');
  }

  // Add @id field with Nostr publicKey in bech32 format
  schemaData["@id"] = pubkeyToNpub(profile.pubkey);

  // Extract menus (collections kind:30405) for this establishment
  if (collections) {
    const establishmentMenus = collections
      .filter(collection => 
        collection.kind === 30405 && 
        collection.pubkey === profile.pubkey
      )
      .map(collection => {
        const titleTag = collection.tags.find(t => t[0] === 'title');
        const summaryTag = collection.tags.find(t => t[0] === 'summary');
        const dTag = collection.tags.find(t => t[0] === 'd');
        
        return {
          "@type": "Menu",
          "name": titleTag?.[1] || '',
          "description": summaryTag?.[1] || '',
          "identifier": dTag?.[1] || '',
        };
      })
      .filter(menu => menu.identifier); // Only include menus with identifier
    
    if (establishmentMenus.length > 0) {
      schemaData.hasMenu = establishmentMenus;
    }
  }

  return schemaData;
}

// Map dietary tags to schema.org suitableForDiet values
// Returns the schema.org value if mapped, null otherwise
export function mapDietaryTagToSchemaOrg(tag: string): string | null {
  const normalized = tag.toUpperCase().trim();
  
  const mapping: Record<string, string> = {
    'VEGAN': 'VeganDiet',
    'VEGETARIAN': 'VegetarianDiet',
    'GLUTEN_FREE': 'GlutenFreeDiet',
    'DAIRY_FREE': 'LowLactoseDiet',
    'HALAL': 'HalalDiet',
    'KOSHER': 'KosherDiet',
    'LOW_CALORIE': 'LowCalorieDiet',
    'LOW_FAT': 'LowFatDiet',
    'LOW_SALT': 'LowSaltDiet',
    'DIABETIC': 'DiabeticDiet',
    'HINDU': 'HinduDiet',
  };
  
  return mapping[normalized] || null;
}

// Format unmapped dietary tags for description text
// Converts "NUT_FREE" -> "Nut free", "SULPHITES" -> "Sulphites"
export function formatDietaryTagForDescription(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Decode geohash to GeoCoordinates object
export function decodeGeohashToGeoCoordinates(geohash: string): { "@type": "GeoCoordinates"; latitude: number; longitude: number } | null {
  try {
    const decoded = ngeohash.decode(geohash);
    return {
      "@type": "GeoCoordinates",
      latitude: decoded.latitude,
      longitude: decoded.longitude,
    };
  } catch (error) {
    console.error('Error decoding geohash:', error);
    return null;
  }
}

// Extract schema.org MenuItem data from Nostr kind:30402 product event
export function extractMenuItemSchemaOrgData(product: NostrEvent, includeSeller: boolean = true): Record<string, any> | null {
  const schemaData: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "MenuItem",
  };

  // Extract name from title tag
  const titleTag = product.tags.find(t => t[0] === 'title');
  if (titleTag && titleTag[1]) {
    schemaData.name = titleTag[1];
  } else {
    // Fallback to extracting from content
    schemaData.name = extractDishName(product);
  }

  // Extract description: content + allergens + unmapped dietary tags
  let description = '';
  
  // Base description from content field
  if (typeof product.content === 'string') {
    // Remove markdown formatting for description
    description = product.content
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\n\n/g, ' ') // Replace double newlines with space
      .replace(/\n/g, ' ') // Replace single newlines with space
      .trim();
  }
  
  // Add allergen tag values if present (schema.org:Recipe:recipeIngredient)
  const allergenTags = product.tags.filter(t => t[0] === 'schema.org:Recipe:recipeIngredient');
  if (allergenTags.length > 0) {
    const allergenValues = allergenTags
      .map(t => t[1])
      .filter(Boolean);
    if (allergenValues.length > 0) {
      description += `. Contains ${allergenValues.join(', ')}`;
    }
  }
  
  // Get tags from "t" tags and "schema.org:MenuItem:suitableForDiet" tags (deduplicate)
  const dietaryTagsSet = new Set<string>();
  product.tags
    .filter(t => t[0] === 't' || t[0] === 'schema.org:MenuItem:suitableForDiet')
    .forEach(t => {
      if (t[1]) dietaryTagsSet.add(t[1]);
    });
  
  const dietaryTags = Array.from(dietaryTagsSet);
  
  // Separate mapped and unmapped dietary tags
  const mappedDietaryTags: string[] = [];
  const unmappedDietaryTags: string[] = [];
  
  for (const tag of dietaryTags) {
    const mapped = mapDietaryTagToSchemaOrg(tag);
    if (mapped) {
      mappedDietaryTags.push(mapped);
    } else {
      unmappedDietaryTags.push(tag);
    }
  }
  
  // Add mapped dietary tags to suitableForDiet
  if (mappedDietaryTags.length > 0) {
    schemaData.suitableForDiet = mappedDietaryTags;
  }
  
  // Add unmapped dietary tags to description
  if (unmappedDietaryTags.length > 0) {
    const formattedUnmapped = unmappedDietaryTags.map(formatDietaryTagForDescription);
    description += `. ${formattedUnmapped.join('. ')}`;
  }
  
  schemaData.description = description.trim();

  // Extract identifier from d tag
  const dTag = product.tags.find(t => t[0] === 'd');
  if (dTag && dTag[1]) {
    schemaData.identifier = dTag[1];
  }

  // Extract image from image tag
  const imageTag = product.tags.find(t => t[0] === 'image');
  if (imageTag && imageTag[1]) {
    schemaData.image = imageTag[1];
  }

  // Extract price and format as Offer
  const priceTag = product.tags.find(t => t[0] === 'price');
  if (priceTag && priceTag[1]) {
    const price = parseFloat(priceTag[1]);
    const currency = priceTag[2] || 'USD';
    
    if (!isNaN(price)) {
      schemaData.offers = {
        "@type": "Offer",
        price: price,
        priceCurrency: currency,
      };
      if (includeSeller) {
        schemaData.offers.seller = pubkeyToNpub(product.pubkey);
      }
    }
  }

  // Extract geo coordinates from geohash (g tag)
  const geohashTag = product.tags.find(t => t[0] === 'g');
  if (geohashTag && geohashTag[1]) {
    const geo = decodeGeohashToGeoCoordinates(geohashTag[1]);
    if (geo) {
      schemaData.geo = geo;
    }
  }

  return schemaData;
}

