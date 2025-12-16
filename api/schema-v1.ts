import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateOpenAPISchema } from '../dist/generate-openapi.js';

// Hardcoded base URL
const BASE_URL = 'https://mcp.synvya.com';

// Legacy hardcoded OpenAPI schema (kept for reference, not used)
function getOpenAPISchemaLegacy(baseUrl: string) {
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
              schema: {
                type: "string",
                enum: ['Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery']
              },
              description: "Filter by schema.org FoodEstablishment type. If not provided, returns all FoodEstablishment types."
            },
            {
              name: "cuisine",
              in: "query",
              required: false,
              schema: {
                type: "string"
              },
              description: "Cuisine type (e.g., 'Spanish', 'Italian', 'Mexican'). Searches schema.org:servesCuisine tags first, then falls back to description text matching."
            },
            {
              name: "query",
              in: "query",
              required: false,
              schema: {
                type: "string"
              },
              description: "Free-text search matching establishment name, location (schema.org:PostalAddress), or description. Example: 'Snoqualmie' to find establishments in that location."
            },
            {
              name: "dietary",
              in: "query",
              required: false,
              schema: {
                type: "string"
              },
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
                        items: { type: "object" }
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
              schema: {
                type: "string"
              },
              description: "Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results."
            },
            {
              name: "menu_identifier",
              in: "query",
              required: true,
              schema: {
                type: "string"
              },
              description: "Menu identifier - MUST be the exact 'identifier' value from the 'hasMenu' array in search_food_establishments results."
            }
          ],
          deprecated: false,
          responses: {
            "200": {
              description: "Successfully retrieved menu items",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      "@context": {
                        type: "string",
                        description: "JSON-LD context, always 'https://schema.org'"
                      },
                      "@type": {
                        type: "string",
                        description: "JSON-LD type, always 'Menu'"
                      },
                      "name": {
                        type: "string",
                        description: "Menu name"
                      },
                      "description": {
                        type: "string",
                        description: "Menu description"
                      },
                      "identifier": {
                        type: "string",
                        description: "Menu identifier"
                      },
                      "hasMenuItem": {
                        type: "array",
                        description: "Array of JSON-LD formatted menu item objects following schema.org MenuItem specification",
                        items: {
                          type: "object",
                          properties: {
                            "@context": {
                              type: "string",
                              description: "JSON-LD context, always 'https://schema.org'"
                            },
                            "@type": {
                              type: "string",
                              description: "JSON-LD type, always 'MenuItem'"
                            },
                            "name": {
                              type: "string",
                              description: "Name of the menu item"
                            },
                            "description": {
                              type: "string",
                              description: "Description of the menu item"
                            },
                            "identifier": {
                              type: "string",
                              description: "Menu item identifier"
                            },
                            "image": {
                              type: "string",
                              format: "uri",
                              description: "Image URL for the menu item"
                            },
                            "suitableForDiet": {
                              type: "array",
                              description: "Array of schema.org suitableForDiet values",
                              items: {
                                type: "string",
                                enum: [
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
                                  "VegetarianDiet"
                                ]
                              }
                            },
                            "offers": {
                              type: "object",
                              description: "Price information formatted as schema.org Offer",
                              properties: {
                                "@type": {
                                  type: "string",
                                  description: "Always 'Offer'"
                                },
                                "price": {
                                  type: "number",
                                  description: "Price as number"
                                },
                                "priceCurrency": {
                                  type: "string",
                                  description: "Currency code (e.g., 'USD')"
                                }
                              }
                            },
                            "geo": {
                              type: "object",
                              description: "Geographic coordinates",
                              properties: {
                                "@type": {
                                  type: "string",
                                  description: "Always 'GeoCoordinates'"
                                },
                                "latitude": {
                                  type: "number",
                                  description: "Latitude"
                                },
                                "longitude": {
                                  type: "number",
                                  description: "Longitude"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
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
              schema: {
                type: "string"
              },
              description: "Dish name, ingredient, or dietary term to search for. Searches dish names and descriptions."
            },
            {
              name: "dietary",
              in: "query",
              required: false,
              schema: {
                type: "string"
              },
              description: "Additional dietary filter (e.g., 'vegan', 'gluten free'). Combined with dish_query using AND logic."
            },
            {
              name: "restaurant_id",
              in: "query",
              required: false,
              schema: {
                type: "string"
              },
              description: "Optional: Filter results to a specific food establishment. Use the '@id' from search_food_establishments results."
            }
          ],
          deprecated: false,
          responses: {
            "200": {
              description: "Successfully found menu items",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      "@context": {
                        type: "string",
                        description: "JSON-LD context, always 'https://schema.org'"
                      },
                      "@graph": {
                        type: "array",
                        description: "Array of food establishments with matching menu items",
                        items: {
                          type: "object",
                          properties: {
                            "@type": {
                              type: "string",
                              description: "Schema.org FoodEstablishment type (Restaurant, Bakery, etc.)"
                            },
                            "name": {
                              type: "string",
                              description: "Food establishment name"
                            },
                            "geo": {
                              type: "object",
                              description: "Geographic coordinates",
                              properties: {
                                "@type": {
                                  type: "string",
                                  description: "Always 'GeoCoordinates'"
                                },
                                "latitude": {
                                  type: "number",
                                  description: "Latitude"
                                },
                                "longitude": {
                                  type: "number",
                                  description: "Longitude"
                                }
                              }
                            },
                            "@id": {
                              type: "string",
                              description: "Food establishment identifier in bech32 format (nostr:npub1...)"
                            },
                            "hasMenu": {
                              type: "array",
                              description: "Array of menus with matching items",
                              items: {
                                type: "object",
                                properties: {
                                  "@type": {
                                    type: "string",
                                    description: "Always 'Menu'"
                                  },
                                  "name": {
                                    type: "string",
                                    description: "Menu name"
                                  },
                                  "description": {
                                    type: "string",
                                    description: "Menu description"
                                  },
                                  "identifier": {
                                    type: "string",
                                    description: "Menu identifier"
                                  },
                                  "hasMenuItem": {
                                    type: "array",
                                    description: "Array of matching menu items",
                                    items: {
                                      type: "object",
                                      properties: {
                                        "@context": {
                                          type: "string",
                                          description: "JSON-LD context, always 'https://schema.org'"
                                        },
                                        "@type": {
                                          type: "string",
                                          description: "JSON-LD type, always 'MenuItem'"
                                        },
                                        "name": {
                                          type: "string",
                                          description: "Name of the menu item"
                                        },
                                        "description": {
                                          type: "string",
                                          description: "Description of the menu item"
                                        },
                                        "identifier": {
                                          type: "string",
                                          description: "Menu item identifier"
                                        },
                                        "image": {
                                          type: "string",
                                          format: "uri",
                                          description: "Image URL for the menu item"
                                        },
                                        "suitableForDiet": {
                                          type: "array",
                                          description: "Array of schema.org suitableForDiet values",
                                          items: {
                                            type: "string",
                                            enum: [
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
                                              "VegetarianDiet"
                                            ]
                                          }
                                        },
                                        "offers": {
                                          type: "object",
                                          description: "Price information formatted as schema.org Offer",
                                          properties: {
                                            "@type": {
                                              type: "string",
                                              description: "Always 'Offer'"
                                            },
                                            "price": {
                                              type: "number",
                                              description: "Price as number"
                                            },
                                            "priceCurrency": {
                                              type: "string",
                                              description: "Currency code (e.g., 'USD')"
                                            }
                                          }
                                        },
                                        "geo": {
                                          type: "object",
                                          description: "Geographic coordinates",
                                          properties: {
                                            "@type": {
                                              type: "string",
                                              description: "Always 'GeoCoordinates'"
                                            },
                                            "latitude": {
                                              type: "number",
                                              description: "Latitude"
                                            },
                                            "longitude": {
                                              type: "number",
                                              description: "Longitude"
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
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
                    restaurant_id: {
                      type: "string",
                      description: "Food establishment identifier in bech32 format (nostr:npub1...) - MUST be the exact '@id' value from search_food_establishments results."
                    },
                    time: {
                      type: "string",
                      description: "Reservation start time in ISO 8601 format (e.g., '2025-10-22T08:00:00-07:00')"
                    },
                    party_size: {
                      type: "number",
                      description: "Number of people in the party (must be a positive integer)",
                      minimum: 1
                    },
                    name: {
                      type: "string",
                      description: "Customer name",
                      minLength: 1
                    },
                    telephone: {
                      type: "string",
                      description: "Customer telephone number. OPTIONAL: Provide this OR email (at least one required, but not both required)."
                    },
                    email: {
                      type: "string",
                      format: "email",
                      description: "Customer email address. OPTIONAL: Provide this OR telephone (at least one required, but not both required)."
                    }
                  },
                  anyOf: [
                    { required: ["telephone"] },
                    { required: ["email"] }
                  ],
                  description: "At least one of telephone or email must be provided. Both fields are optional individually, but you must provide at least one of them."
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
                  schema: {
                    type: "object",
                    properties: {
                      "@context": {
                        type: "string",
                        description: "JSON-LD context, always 'https://schema.org'"
                      },
                      "@type": {
                        type: "string",
                        description: "Either 'FoodEstablishmentReservation' for success or 'ReserveAction' for errors"
                      },
                      "reservationId": {
                        type: "number",
                        description: "Reservation ID (present only on success)"
                      },
                      "reservationStatus": {
                        type: "string",
                        description: "Reservation status (present only on success)"
                      },
                      "actionStatus": {
                        type: "string",
                        description: "Action status (present only on errors)"
                      },
                      "underName": {
                        type: "object",
                        description: "Customer information (present only on success)",
                        properties: {
                          "@type": {
                            type: "string"
                          },
                          "name": {
                            type: "string"
                          },
                          "email": {
                            type: "string"
                          },
                          "telephone": {
                            type: "string"
                          }
                        }
                      },
                      "broker": {
                        type: "object",
                        description: "Broker information (present only on success)",
                        properties: {
                          "@type": {
                            type: "string"
                          },
                          "name": {
                            type: "string"
                          },
                          "legalName": {
                            type: "string"
                          }
                        }
                      },
                      "reservationFor": {
                        type: "object",
                        description: "Restaurant information (present only on success)",
                        properties: {
                          "@type": {
                            type: "string"
                          },
                          "name": {
                            type: "string"
                          },
                          "address": {
                            type: "object",
                            properties: {
                              "@type": {
                                type: "string"
                              },
                              "streetAddress": {
                                type: "string"
                              },
                              "addressLocality": {
                                type: "string"
                              },
                              "addressRegion": {
                                type: "string"
                              },
                              "postalCode": {
                                type: "string"
                              },
                              "addressCountry": {
                                type: "string"
                              }
                            }
                          }
                        }
                      },
                      "startTime": {
                        type: "string",
                        description: "Reservation start time in ISO 8601 format"
                      },
                      "endTime": {
                        type: "string",
                        description: "Reservation end time in ISO 8601 format"
                      },
                      "partySize": {
                        type: "number",
                        description: "Party size (present only on success)"
                      },
                      "error": {
                        type: "object",
                        description: "Error information (present only on errors)",
                        properties: {
                          "@type": {
                            type: "string"
                          },
                          "name": {
                            type: "string"
                          },
                          "description": {
                            type: "string"
                          }
                        }
                      }
                    }
                  }
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

  // Get format parameter (defaults to 'openapi')
  const format = (req.query.format as string | undefined) || 'openapi';

  if (format === 'openapi' || req.headers.accept?.includes('application/openapi+json')) {
    res.setHeader('Content-Type', 'application/openapi+json; charset=utf-8');
    // Use auto-generated OpenAPI schema from Zod definitions
    return res.status(200).json(generateOpenAPISchema(BASE_URL));
  }

  if (format === 'mcp') {
    // TODO: Implement MCP tools schema endpoint
    return res.status(501).json({ 
      error: 'Not Implemented', 
      message: 'MCP tools schema endpoint coming soon' 
    });
  }

  // Default: return auto-generated OpenAPI schema with proper Content-Type
  res.setHeader('Content-Type', 'application/openapi+json; charset=utf-8');
  return res.status(200).json(generateOpenAPISchema(BASE_URL));
}

