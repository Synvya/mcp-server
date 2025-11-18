import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module (works in both ESM and CommonJS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root (go up from dist/ to project root)
const projectRoot = join(__dirname, '..');

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
  
  // Also check "suitableForDiet" tags
  const suitableForDietTags = product.tags
    .filter(t => t[0] === 'suitableForDiet')
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
// Returns null if profile doesn't have a valid l tag with FoodEstablishment type
export function extractSchemaOrgData(profile: NostrEvent, collections?: NostrEvent[]): Record<string, any> | null {
  // Extract FoodEstablishment type from l tag: ["l", "https://schema.org:<type>"]
  const lTag = profile.tags.find(t => t[0] === 'l' && t[1]?.startsWith('https://schema.org:'));
  if (!lTag || !lTag[1]) {
    return null; // STRICT: Ignore profiles without valid l tag
  }

  // Extract type from URL: "https://schema.org:Restaurant" -> "Restaurant"
  const typeMatch = lTag[1].match(/^https:\/\/schema\.org:(.+)$/);
  if (!typeMatch || !typeMatch[1]) {
    return null; // STRICT: Ignore profiles with invalid l tag format
  }

  const establishmentType = typeMatch[1];
  
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
  const cuisineTags = profile.tags.filter(t => t[0] === 'schema.org:servesCuisine');
  if (cuisineTags.length > 0) {
    schemaData.servesCuisine = cuisineTags
      .map(t => t[1])
      .filter(Boolean);
  }

  // Extract address components
  const address: Record<string, string> = {};
  profile.tags.forEach(tag => {
    if (tag[0] === 'i' && tag[1]?.startsWith('schema.org:PostalAddress:')) {
      const parts = tag[1].split(':');
      if (parts.length >= 4) {
        const prop = parts[2]; // e.g., "streetAddress", "addressLocality" (after "schema.org:PostalAddress:")
        const value = parts.slice(3).join(':'); // Handle values that might contain colons
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
    if (tag[0] === 'i' && tag[1]?.startsWith('schema.org:GeoCoordinates:')) {
      const parts = tag[1].split(':');
      if (parts.length >= 4) {
        const prop = parts[2]; // "latitude" or "longitude" (after "schema.org:GeoCoordinates:")
        const value = parseFloat(parts[3]);
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
  const telephoneTag = profile.tags.find(t => t[0] === 'i' && t[1]?.startsWith('schema.org:telephone:'));
  if (telephoneTag && telephoneTag[1]) {
    const parts = telephoneTag[1].split(':');
    if (parts.length >= 3) {
      const phone = parts.slice(2).join(':'); // Handle phone numbers with colons (after "schema.org:telephone:")
      if (phone) schemaData.telephone = phone;
    }
  }

  // Extract email (keep mailto: format)
  const emailTag = profile.tags.find(t => t[0] === 'i' && t[1]?.startsWith('schema.org:email:'));
  if (emailTag && emailTag[1]) {
    const parts = emailTag[1].split(':');
    if (parts.length >= 3) {
      const email = parts.slice(2).join(':'); // Keep mailto: format (after "schema.org:email:")
      if (email) schemaData.email = email;
    }
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

  // Add identifier field with Nostr publicKey (schema.org standard)
  schemaData.identifier = profile.pubkey;

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

