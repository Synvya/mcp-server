import {
  parseContent,
  extractDishName,
  matchesDietaryTag,
  normalizeDietaryTag,
  findProductsInCollection,
  findCollection,
  productMatchesDietary,
  extractSchemaOrgData,
  extractMenuItemSchemaOrgData,
  npubToPubkey,
  checkTableAvailability,
  type NostrEvent,
} from './data-loader.js';

export interface ToolData {
  profiles: NostrEvent[];
  collections: NostrEvent[];
  products: NostrEvent[];
  calendar: NostrEvent[];
  tables: NostrEvent[];
}

export interface SearchFoodEstablishmentsArgs {
  foodEstablishmentType?: string;
  cuisine?: string;
  query?: string;
  dietary?: string;
}

export interface GetMenuItemsArgs {
  restaurant_id: string;
  menu_identifier: string;
}

export interface SearchMenuItemsArgs {
  dish_query: string;
  dietary?: string;
  restaurant_id?: string;
}

export interface MakeReservationArgs {
  restaurant_id: string;
  time: string;
  party_size: number;
  name: string;
  telephone?: string;
  email?: string;
}

/**
 * Search for food establishments based on various criteria
 */
export function searchFoodEstablishments(
  args: SearchFoodEstablishmentsArgs,
  data: ToolData
): { food_establishments: Record<string, any>[] } {
  const { foodEstablishmentType, cuisine, query, dietary } = args;
  const { profiles, collections } = data;
  
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
  // Filter out null results (profiles without valid schema.org:FoodEstablishment tag)
  const establishmentList = results
    .map((p) => extractSchemaOrgData(p, collections))
    .filter((data): data is Record<string, any> => data !== null);

  return {
    food_establishments: establishmentList,
  };
}

/**
 * Get menu items from a specific restaurant menu
 * Supports three patterns:
 * 1. Direct items (hasMenuItem at Menu level)
 * 2. Sectioned items (hasMenuSection with nested hasMenuItem)
 * 3. Mixed (both direct items and sections)
 */
export function getMenuItems(
  args: GetMenuItemsArgs,
  data: ToolData
): Record<string, any> {
  const { restaurant_id, menu_identifier } = args;
  const { profiles, collections, products } = data;
  
  // Convert npub to hex pubkey for lookup
  const establishmentPubkey = npubToPubkey(restaurant_id);
  
  // Find food establishment by pubkey
  const establishment = profiles.find(p => p.pubkey === establishmentPubkey);
  if (!establishment) {
    return {
      "@context": "https://schema.org",
      "@type": "Menu",
      "name": "",
      "identifier": "",
    };
  }
  
  // Find the collection (menu)
  const collection = findCollection(collections, establishmentPubkey, menu_identifier);
  if (!collection) {
    return {
      "@context": "https://schema.org",
      "@type": "Menu",
      "name": "",
      "identifier": "",
    };
  }
  
  // Get product IDs from menu's "a" tags (compact format: "30402:pubkey:productId")
  const menuProductIds = new Set<string>();
  collection.tags
    .filter(tag => tag[0] === 'a' && tag[1] && typeof tag[1] === 'string' && tag[1].includes(':'))
    .forEach(tag => {
      const parts = tag[1].split(':');
      if (parts.length >= 3 && parts[0] === '30402') {
        menuProductIds.add(parts[2]);
      }
    });
  
  // Find all menu sections (collections with same pubkey that are not the main menu)
  // Check if collection title contains "Menu Section" to identify sections
  const allSections = collections.filter(c => {
    if (c.kind !== 30405 || c.pubkey !== establishmentPubkey) return false;
    const dTag = c.tags.find(t => t[0] === 'd');
    if (!dTag || dTag[1] === menu_identifier) return false;
    const titleTag = c.tags.find(t => t[0] === 'title');
    const title = titleTag?.[1] || '';
    return title.toLowerCase().includes('menu section');
  });
  
  // Track which product IDs are in sections
  const productIdsInSections = new Set<string>();
  
  // Build MenuSection objects for sections that share products with this menu
  const menuSectionsJsonLd: Record<string, any>[] = [];
  
  for (const section of allSections) {
    const sectionId = section.tags.find(t => t[0] === 'd')?.[1];
    if (!sectionId) continue;
    
    // Get all products in this section
    const sectionProducts = findProductsInCollection(products, establishmentPubkey, sectionId);
    
    // Also check section's "a" tags for product references
    const sectionProductIds = new Set<string>();
    section.tags
      .filter(tag => tag[0] === 'a' && tag[1] && typeof tag[1] === 'string' && tag[1].includes(':'))
      .forEach(tag => {
        const parts = tag[1].split(':');
        if (parts.length >= 3 && parts[0] === '30402') {
          sectionProductIds.add(parts[2]);
        }
      });
    
    // Check if this section has any products that are also in the menu
    const hasSharedProducts = Array.from(sectionProductIds).some(productId => 
      menuProductIds.has(productId)
    );
    
    if (!hasSharedProducts) continue;
    
    // Get all products for this section that are also in the menu
    const sectionProductEvents = new Set<NostrEvent>();
    
    // Add products from collection lookup
    sectionProducts.forEach(p => {
      const dTag = p.tags.find(t => t[0] === 'd');
      if (dTag && menuProductIds.has(dTag[1])) {
        sectionProductEvents.add(p);
        productIdsInSections.add(dTag[1]);
      }
    });
    
    // Add products from section's "a" tags
    for (const productId of sectionProductIds) {
      if (!menuProductIds.has(productId)) continue;
      const product = products.find(p => {
        const dTag = p.tags.find(t => t[0] === 'd');
        return dTag && dTag[1] === productId && p.pubkey === establishmentPubkey;
      });
      if (product) {
        sectionProductEvents.add(product);
        productIdsInSections.add(productId);
      }
    }
    
    // Convert products to MenuItem JSON-LD
    const menuItems = Array.from(sectionProductEvents)
      .map(item => extractMenuItemSchemaOrgData(item, false))
      .filter((item): item is Record<string, any> => item !== null);
    
    if (menuItems.length === 0) continue;
    
    // Extract section properties
    const secTitleTag = section.tags.find(t => t[0] === 'title');
    const secSummaryTag = section.tags.find(t => t[0] === 'summary');
    const secDTag = section.tags.find(t => t[0] === 'd');
    
    // Clean up the section name by removing "Menu Section" suffix
    let sectionName = secTitleTag?.[1] || '';
    sectionName = sectionName.replace(/\s*Menu Section\s*$/i, '').trim();
    
    const menuSection: Record<string, any> = {
      "@type": "MenuSection",
      "name": sectionName,
      "description": secSummaryTag?.[1] || '',
      "identifier": secDTag?.[1] || '',
      "hasMenuItem": menuItems,
    };
    
    menuSectionsJsonLd.push(menuSection);
  }
  
  // Find products that are directly in the menu but not in any section
  const directMenuItems: Record<string, any>[] = [];
  
  for (const productId of menuProductIds) {
    if (productIdsInSections.has(productId)) continue; // Skip if already in a section
    
    const product = products.find(p => {
      const dTag = p.tags.find(t => t[0] === 'd');
      return dTag && dTag[1] === productId && p.pubkey === establishmentPubkey;
    });
    
    if (product) {
      const menuItem = extractMenuItemSchemaOrgData(product, false);
      if (menuItem) {
        directMenuItems.push(menuItem);
      }
    }
  }
  
  // Extract menu properties from collection
  const titleTag = collection.tags.find(t => t[0] === 'title');
  const summaryTag = collection.tags.find(t => t[0] === 'summary');
  const dTag = collection.tags.find(t => t[0] === 'd');
  
  const menuObject: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Menu",
    "name": titleTag?.[1] || '',
    "identifier": dTag?.[1] || '',
  };
  
  if (summaryTag?.[1]) {
    menuObject.description = summaryTag[1];
  }
  
  // Add direct items if any
  if (directMenuItems.length > 0) {
    menuObject.hasMenuItem = directMenuItems;
  }
  
  // Add sections if any
  if (menuSectionsJsonLd.length > 0) {
    menuObject.hasMenuSection = menuSectionsJsonLd;
  }
  
  return menuObject;
}

/**
 * Search for menu items across food establishments
 */
export function searchMenuItems(
  args: SearchMenuItemsArgs,
  data: ToolData
): { "@context": string; "@graph": Record<string, any>[] } {
  const { dish_query, dietary, restaurant_id } = args;
  const { profiles, collections, products } = data;
  
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
    
    // Extract ingredient tags (schema.org:Recipe:recipeIngredient)
    const ingredientTags = product.tags
      .filter(t => t[0] === 'schema.org:Recipe:recipeIngredient')
      .map(t => t[1])
      .filter(Boolean)
      .join(' ');
    
    // Extract dietary tags (normalized for search)
    const dietaryTags = product.tags
      .filter(t => t[0] === 't' || t[0] === 'schema.org:MenuItem:suitableForDiet')
      .map(t => t[1])
      .filter(Boolean)
      .map(tag => normalizeDietaryTag(tag)) // Normalize "GLUTEN_FREE" -> "gluten free"
      .join(' ');
    
    // Match dish name/description/ingredients/dietary tags
    const searchText = `${dishName} ${description} ${contentText} ${ingredientTags} ${dietaryTags}`.toLowerCase();
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
  // We need to distinguish between Menus and MenuSections
  const establishmentMap = new Map<string, Map<string, NostrEvent[]>>();
  
  for (const product of matchingProducts) {
    const establishmentPubkey = product.pubkey;
    
    // Get collections (menus/sections) this product belongs to (parse compact format: "30405:pubkey:collectionId")
    const collectionTags: string[] = [];
    product.tags
      .filter(t => t[0] === 'a' && t[1] && typeof t[1] === 'string' && t[1].includes(':'))
      .forEach(tag => {
        const parts = tag[1].split(':');
        if (parts.length >= 3 && parts[0] === '30405' && parts[1] === establishmentPubkey) {
          collectionTags.push(parts[2]); // collectionId
        }
      });
    
    if (!establishmentMap.has(establishmentPubkey)) {
      establishmentMap.set(establishmentPubkey, new Map());
    }
    const menuMap = establishmentMap.get(establishmentPubkey)!;
    
    // Separate actual menus from sections
    const actualMenuIds = new Set<string>();
    
    for (const collectionId of collectionTags) {
      const collection = findCollection(collections, establishmentPubkey, collectionId);
      if (!collection) continue;
      
      const titleTag = collection.tags.find(t => t[0] === 'title');
      const title = titleTag?.[1] || '';
      
      // Check if this is a Menu (not MenuSection)
      if (!title.toLowerCase().includes('menu section')) {
        actualMenuIds.add(collectionId);
      }
    }
    
    if (actualMenuIds.size > 0) {
      // Add product to each menu it belongs to
      for (const menuId of actualMenuIds) {
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
      
      // Find all menu sections for this establishment
      const allSections = collections.filter(c => {
        if (c.kind !== 30405 || c.pubkey !== establishmentPubkey) return false;
        const secDTag = c.tags.find(t => t[0] === 'd');
        if (!secDTag || secDTag[1] === menuId) return false;
        const secTitleTag = c.tags.find(t => t[0] === 'title');
        const secTitle = secTitleTag?.[1] || '';
        return secTitle.toLowerCase().includes('menu section');
      });
      
      // Track which product IDs are in sections (for this menu)
      const productIdsInSections = new Set<string>();
      const menuSectionsJsonLd: Record<string, any>[] = [];
      
      // Build MenuSection objects for sections that contain matching products
      for (const section of allSections) {
        const sectionId = section.tags.find(t => t[0] === 'd')?.[1];
        if (!sectionId) continue;
        
        // Get product IDs from section's "a" tags
        const sectionProductIds = new Set<string>();
        section.tags
          .filter(tag => tag[0] === 'a' && tag[1] && typeof tag[1] === 'string' && tag[1].includes(':'))
          .forEach(tag => {
            const parts = tag[1].split(':');
            if (parts.length >= 3 && parts[0] === '30402') {
              sectionProductIds.add(parts[2]);
            }
          });
        
        // Find which of our matching products are in this section
        const sectionMatchingProducts: NostrEvent[] = [];
        for (const product of menuProducts) {
          const productDTag = product.tags.find(t => t[0] === 'd');
          const productId = productDTag?.[1];
          if (productId && sectionProductIds.has(productId)) {
            sectionMatchingProducts.push(product);
            productIdsInSections.add(productId);
          }
        }
        
        if (sectionMatchingProducts.length === 0) continue;
        
        // Convert products to MenuItem JSON-LD
        const menuItems = sectionMatchingProducts
          .map(item => extractMenuItemSchemaOrgData(item, false))
          .filter((item): item is Record<string, any> => item !== null);
        
        // Extract section properties
        const secTitleTag = section.tags.find(t => t[0] === 'title');
        const secSummaryTag = section.tags.find(t => t[0] === 'summary');
        const secDTag = section.tags.find(t => t[0] === 'd');
        
        // Clean up the section name by removing "Menu Section" suffix
        let sectionName = secTitleTag?.[1] || '';
        sectionName = sectionName.replace(/\s*Menu Section\s*$/i, '').trim();
        
        const menuSection: Record<string, any> = {
          "@type": "MenuSection",
          "name": sectionName,
          "description": secSummaryTag?.[1] || '',
          "identifier": secDTag?.[1] || '',
          "hasMenuItem": menuItems,
        };
        
        menuSectionsJsonLd.push(menuSection);
      }
      
      // Find products that are directly in the menu but not in any section
      const directMenuItems: Record<string, any>[] = [];
      for (const product of menuProducts) {
        const productDTag = product.tags.find(t => t[0] === 'd');
        const productId = productDTag?.[1];
        if (productId && !productIdsInSections.has(productId)) {
          const menuItem = extractMenuItemSchemaOrgData(product, false);
          if (menuItem) {
            directMenuItems.push(menuItem);
          }
        }
      }
      
      // Build menu object
      const menuObject: Record<string, any> = {
        "@type": "Menu",
        "name": titleTag?.[1] || '',
        "identifier": dTag?.[1] || '',
      };
      
      if (summaryTag?.[1]) {
        menuObject.description = summaryTag[1];
      }
      
      // Add direct items if any
      if (directMenuItems.length > 0) {
        menuObject.hasMenuItem = directMenuItems;
      }
      
      // Add sections if any
      if (menuSectionsJsonLd.length > 0) {
        menuObject.hasMenuSection = menuSectionsJsonLd;
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
  
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

/**
 * Make a reservation at a food establishment
 */
export function makeReservation(
  args: MakeReservationArgs,
  data: ToolData
): Record<string, any> {
  const { restaurant_id, time, party_size, name, telephone, email } = args;
  const { profiles, tables, calendar } = data;

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
    return {
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "error": {
        "@type": "Thing",
        "name": "InvalidReservationRequest",
        "description": "Invalid time format. Time must be in ISO 8601 format (e.g., '2025-10-22T08:00:00-07:00').",
      },
    };
  }

  // Convert restaurant_id from npub to pubkey
  let establishmentPubkey: string;
  try {
    establishmentPubkey = npubToPubkey(restaurant_id);
  } catch (error) {
    return {
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "error": {
        "@type": "Thing",
        "name": "InvalidReservationRequest",
        "description": "Invalid restaurant_id format. Must be a valid npub identifier from search_food_establishments results.",
      },
    };
  }

  // Find restaurant profile
  const establishment = profiles.find(p => p.pubkey === establishmentPubkey);
  if (!establishment) {
    return {
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "error": {
        "@type": "Thing",
        "name": "InvalidReservationRequest",
        "description": "Restaurant not found. Please verify the restaurant_id is correct.",
      },
    };
  }

  // Extract restaurant data
  const restaurantData = extractSchemaOrgData(establishment);
  if (!restaurantData) {
    return {
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "error": {
        "@type": "Thing",
        "name": "InvalidReservationRequest",
        "description": "Restaurant profile is invalid or incomplete.",
      },
    };
  }

  // Convert ISO 8601 time strings to Unix timestamps for availability check
  const requestStartTimestamp = Math.floor(new Date(startTimeStr).getTime() / 1000);
  const requestEndTimestamp = Math.floor(new Date(endTimeStr).getTime() / 1000);

  // Check table availability
  const availability = checkTableAvailability(
    establishmentPubkey,
    requestStartTimestamp,
    requestEndTimestamp,
    party_size,
    tables,
    calendar
  );

  if (!availability.available) {
    return {
      "@context": "https://schema.org",
      "@type": "ReserveAction",
      "actionStatus": "FailedActionStatus",
      "startTime": startTimeStr,
      "endTime": endTimeStr,
      "error": {
        "@type": "Thing",
        "name": "ReservationDenied",
        "description": availability.reason || "The restaurant is fully booked at the requested time.",
      },
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
  return {
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
}

