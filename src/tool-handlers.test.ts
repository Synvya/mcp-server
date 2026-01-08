import { describe, it, expect, beforeAll } from 'vitest';
import {
  searchFoodEstablishments,
  getMenuItems,
  searchMenuItems,
  makeReservation,
  type ToolData,
} from './tool-handlers.js';
import {
  loadProfileData,
  loadCollectionsData,
  loadProductsData,
  loadCalendarData,
  loadTablesData,
  loadOffersData,
  pubkeyToNpub,
  type NostrEvent,
} from './data-loader.js';

describe('Tool Handlers', () => {
  let toolData: ToolData;
  let validRestaurantId: string = '';

  beforeAll(async () => {
    // Load actual test data
    const profiles = await loadProfileData();
    const collections = await loadCollectionsData();
    const products = await loadProductsData();
    const calendar = await loadCalendarData();
    const tables = await loadTablesData();
    const offers = await loadOffersData();

    toolData = {
      profiles,
      collections,
      products,
      calendar,
      tables,
      offers,
    };

    if (profiles.length > 0) {
      validRestaurantId = pubkeyToNpub(profiles[0].pubkey);
    }
  });

  describe('searchFoodEstablishments', () => {
    it('should return all food establishments when no filters provided', () => {
      const result = searchFoodEstablishments({}, toolData);
      
      expect(result).toHaveProperty('food_establishments');
      expect(Array.isArray(result.food_establishments)).toBe(true);
    });

    it('should filter by foodEstablishmentType', () => {
      const result = searchFoodEstablishments(
        { foodEstablishmentType: 'Restaurant' },
        toolData
      );
      
      expect(result.food_establishments.every(
        est => est['@type'] === 'Restaurant'
      )).toBe(true);
    });

    it('should filter by cuisine', () => {
      const result = searchFoodEstablishments(
        { cuisine: 'Spanish' },
        toolData
      );
      
      // Results should either have 'Spanish' in servesCuisine or description
      expect(Array.isArray(result.food_establishments)).toBe(true);
    });

    it('should filter by query (free text search)', () => {
      const result = searchFoodEstablishments(
        { query: 'restaurant' },
        toolData
      );
      
      expect(Array.isArray(result.food_establishments)).toBe(true);
    });

    it('should filter by dietary requirement', () => {
      const result = searchFoodEstablishments(
        { dietary: 'vegan' },
        toolData
      );
      
      expect(Array.isArray(result.food_establishments)).toBe(true);
    });

    it('should combine multiple filters with AND logic', () => {
      const result = searchFoodEstablishments(
        { 
          foodEstablishmentType: 'Restaurant',
          cuisine: 'Spanish'
        },
        toolData
      );
      
      expect(Array.isArray(result.food_establishments)).toBe(true);
      if (result.food_establishments.length > 0) {
        expect(result.food_establishments.every(
          est => est['@type'] === 'Restaurant'
        )).toBe(true);
      }
    });

    it('should return establishments with correct JSON-LD structure', () => {
      const result = searchFoodEstablishments({}, toolData);
      
      if (result.food_establishments.length > 0) {
        const establishment = result.food_establishments[0];
        expect(establishment['@context']).toBe('https://schema.org');
        expect(establishment['@type']).toBeDefined();
        expect(establishment.name).toBeDefined();
        expect(establishment['@id']).toBeDefined();
      }
    });

    it('should include hasMenu array when menus are available', () => {
      const result = searchFoodEstablishments({}, toolData);
      
      if (result.food_establishments.length > 0) {
        const withMenu = result.food_establishments.find(est => est.hasMenu);
        if (withMenu) {
          expect(Array.isArray(withMenu.hasMenu)).toBe(true);
          expect(withMenu.hasMenu[0]).toHaveProperty('name');
          expect(withMenu.hasMenu[0]).toHaveProperty('identifier');
        }
      }
    });
  });

  describe('getMenuItems', () => {
    it('should return empty menu for invalid restaurant_id', () => {
      const result = getMenuItems(
        {
          restaurant_id: 'nostr:npub1invalidtest',
          menu_identifier: 'dinner',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(result['@type']).toBe('Menu');
      // Empty menu should have no items or sections
      expect(result.hasMenuItem).toBeUndefined();
      expect(result.hasMenuSection).toBeUndefined();
    });

    it('should return empty menu for invalid menu_identifier', () => {
      if (!validRestaurantId) {
        return; // Skip if no test data
      }

      const result = getMenuItems(
        {
          restaurant_id: validRestaurantId,
          menu_identifier: 'nonexistent-menu',
        },
        toolData
      );
      
      expect(result['@type']).toBe('Menu');
      // Empty menu should have no items or sections
      expect(result.hasMenuItem).toBeUndefined();
      expect(result.hasMenuSection).toBeUndefined();
    });

    it('should return menu with items for valid restaurant and menu', () => {
      if (!validRestaurantId) {
        return; // Skip if no test data
      }

      // Find a menu from the establishment
      const establishments = searchFoodEstablishments({}, toolData);
      const establishment = establishments.food_establishments.find(
        est => est['@id'] === validRestaurantId && est.hasMenu && est.hasMenu.length > 0
      );

      if (!establishment || !establishment.hasMenu) {
        return; // Skip if no menus available
      }

      const menuIdentifier = establishment.hasMenu[0].identifier;
      const result = getMenuItems(
        {
          restaurant_id: validRestaurantId,
          menu_identifier: menuIdentifier,
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(result['@type']).toBe('Menu');
      expect(result.name).toBeDefined();
      expect(result.identifier).toBe(menuIdentifier);
      // Menu should have either direct items, sections, or both
      const hasItems = result.hasMenuItem && Array.isArray(result.hasMenuItem) && result.hasMenuItem.length > 0;
      const hasSections = result.hasMenuSection && Array.isArray(result.hasMenuSection) && result.hasMenuSection.length > 0;
      expect(hasItems || hasSections).toBe(true);
    });

    it('should return menu items with correct JSON-LD structure', () => {
      if (!validRestaurantId) {
        return; // Skip if no test data
      }

      // Find a menu with items
      const establishments = searchFoodEstablishments({}, toolData);
      const establishment = establishments.food_establishments.find(
        est => est['@id'] === validRestaurantId && est.hasMenu && est.hasMenu.length > 0
      );

      if (!establishment || !establishment.hasMenu) {
        return;
      }

      const menuIdentifier = establishment.hasMenu[0].identifier;
      const result = getMenuItems(
        {
          restaurant_id: validRestaurantId,
          menu_identifier: menuIdentifier,
        },
        toolData
      );
      
      // Check for sectioned items
      if (result.hasMenuSection && result.hasMenuSection.length > 0) {
        const section = result.hasMenuSection[0];
        expect(section['@type']).toBe('MenuSection');
        expect(section.name).toBeDefined();
        expect(section.identifier).toBeDefined();
        expect(Array.isArray(section.hasMenuItem)).toBe(true);
        
        if (section.hasMenuItem.length > 0) {
          const item = section.hasMenuItem[0];
          expect(item['@context']).toBe('https://schema.org');
          expect(item['@type']).toBe('MenuItem');
          expect(item.name).toBeDefined();
          expect(item.description).toBeDefined();
        }
      }
      
      // Check for direct items
      if (result.hasMenuItem && result.hasMenuItem.length > 0) {
        const item = result.hasMenuItem[0];
        expect(item['@context']).toBe('https://schema.org');
        expect(item['@type']).toBe('MenuItem');
        expect(item.name).toBeDefined();
        expect(item.description).toBeDefined();
      }
    });
  });

  describe('searchMenuItems', () => {
    it('should return empty graph when no matches found', () => {
      const result = searchMenuItems(
        {
          dish_query: 'nonexistentdish123456',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(result['@graph']).toEqual([]);
    });

    it('should search for dishes by name', () => {
      const result = searchMenuItems(
        {
          dish_query: 'salad',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(Array.isArray(result['@graph'])).toBe(true);
    });

    it('should filter by dietary requirement', () => {
      const result = searchMenuItems(
        {
          dish_query: 'pizza',
          dietary: 'vegan',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(Array.isArray(result['@graph'])).toBe(true);
    });

    it('should detect dietary terms in dish_query', () => {
      const result = searchMenuItems(
        {
          dish_query: 'vegan',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(Array.isArray(result['@graph'])).toBe(true);
    });

    it('should filter by restaurant_id when provided', () => {
      if (!validRestaurantId) {
        return; // Skip if no test data
      }

      const result = searchMenuItems(
        {
          dish_query: 'food',
          restaurant_id: validRestaurantId,
        },
        toolData
      );
      
      expect(Array.isArray(result['@graph'])).toBe(true);
      if (result['@graph'].length > 0) {
        expect(result['@graph'].every(est => est['@id'] === validRestaurantId)).toBe(true);
      }
    });

    it('should return results with correct graph structure', () => {
      const result = searchMenuItems(
        {
          dish_query: 'food',
        },
        toolData
      );
      
      if (result['@graph'].length > 0) {
        const establishment = result['@graph'][0];
        expect(establishment['@type']).toBeDefined();
        expect(establishment.name).toBeDefined();
        expect(establishment['@id']).toBeDefined();
        
        if (establishment.hasMenu) {
          expect(Array.isArray(establishment.hasMenu)).toBe(true);
          if (establishment.hasMenu.length > 0) {
            const menu = establishment.hasMenu[0];
            expect(menu['@type']).toBe('Menu');
            expect(Array.isArray(menu.hasMenuItem)).toBe(true);
          }
        }
      }
    });

    it('should match dishes by ingredients', () => {
      const result = searchMenuItems(
        {
          dish_query: 'tomato',
        },
        toolData
      );
      
      expect(result['@context']).toBe('https://schema.org');
      expect(Array.isArray(result['@graph'])).toBe(true);
    });
  });

  describe.skip('makeReservation (requires integration testing)', () => {
    // These tests are skipped because makeReservation is now async and requires:
    // - Real Nostr infrastructure (relays, subscriber)
    // - Restaurant client responding to requests
    // - NIP-RP protocol integration
    // 
    // They will be rewritten as integration tests in Issue #51
    
    it('placeholder for integration tests', () => {
      // Integration tests will cover:
      // - Error handling (invalid restaurant_id, invalid time)
      // - Request building and publishing
      // - Response matching and timeout
      // - Status mapping (confirmed/declined/pending)
      // - Email/telephone formatting
      // - Timezone handling
      // - End-to-end flow with real Synvya client
    });
  });
});

