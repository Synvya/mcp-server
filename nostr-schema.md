# Nostr Event Schema Documentation

> **Quick Reference**: This document describes the required format for Nostr events used by the Synvya MCP Server. Events must follow these schemas to be properly discovered and processed.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Minimum Required Tags](#minimum-required-tags)
- [Event Types Overview](#event-types-overview)
- [Food Establishment Profile](#food-establishment-profile)
- [Menu Item](#menu-item)
- [Menu](#menu)
- [Relationships & Cross-References](#relationships--cross-references)

---

## Quick Reference

| Event Type | Kind | Purpose | Critical Tag | Discoverable By |
|------------|------|---------|--------------|-----------------|
| **Profile** | `0` | Food establishment type (restaurant, bakery, etc.) | `schema.org:FoodEstablishment` | `search_food_establishments` |
| **Menu Item** | `30402` | Individual dish/product identifier | `d`  + `a` (menu link) | `get_menu_items`, `search_menu_items` |
| **Menu Collection** | `30405` | Menu identifier (Lunch, Dinner, etc.) | `d` | `get_menu_items` |

## Minimum Required Tags

**kind:0 (Profile)**:
```json
["schema.org:FoodEstablishment", "<FoodEstablishmentType>", "https://schema.org/FoodEstablishment"]  // CRITICAL - without this, event is ignored
```

**kind:30402 (Menu Item)**:
```json
["d", "0001"],  // Unique identifier
["a", "30405", "<pubkey>", "Dinner"]  // Link to menu collection
```

**kind:30405 (Menu Collection)**:
```json
["d", "Dinner"]  // Menu identifier (must match product a tags)
```

---

## Event Types Overview

The server processes three types of Nostr events:

| Kind | Name | Description | Example |
|------|------|-------------|---------|
| `0` | Profile | Food establishment profile | Restaurant, Bakery, Cafe |
| `30402` | Menu Item | Individual dish/product | "Bacalao al Pil Pil", "Pizza Margherita" |
| `30405` | Menu Collection | Menu grouping | "Lunch Menu", "Dinner Menu" |


---

## Food Establishment Profile

Represents a food establishment that can be discovered via `search_food_establishments`. Based on Nostr `kind:0` events. 

### Required Tags

#### Food Establishment type

Format: `["schema.org:FoodEstablishment", "<FoodEstablishmentType>", "https://schema.org/FoodEstablishment"]` 

**Events without a valid `schema.org:FoodEstablishment` tag will be IGNORED by `search_food_establishments`.**

Valid `FoodEstablishmentType` values, as defined by https://schema.org/FoodEstablishment:
- `Restaurant`
- `Bakery`
- `BarOrPub`
- `Brewery`
- `CafeOrCoffeeShop`
- `Distillery`
- `FastFoodRestaurant`
- `IceCreamShop`
- `Winery`

Example:
```json
["schema.org:FoodEstablishment", "Restaurant", "https://schema.org/FoodEstablishment"] 
```

### Recommended Tags

#### Cuisine
```json
["schema.org:FoodEstablishment:servesCuisine", "Spanish", "https://schema.org/servesCuisine"]
```

#### Address (PostalAddress)
```json
["schema.org:PostalAddress:streetAddress", "123 Main Street", "https://schema.org/streetAddress"],
["schema.org:PostalAddress:addressLocality", "Snoqualmie", "https://schema.org/addressLocality"],
["schema.org:PostalAddress:addressRegion", "WA", "https://schema.org/addressRegion"],
["schema.org:PostalAddress:postalCode", "98065", "https://schema.org/postalCode"],
["schema.org:PostalAddress:addressCountry", "US", "https://schema.org/addressCountry"],
```

#### Geographic Coordinates
```json
["schema.org:GeoCoordinates:latitude", "47.5289527", "https://schema.org/latitude"],
["schema.org:GeoCoordinates:longitud", "-121.827093", "https://schema.org/longitude"],
```

or 

```json
["i", "geo:c23q7u2hn", "https://geohash.org"],
["k", "geo"]
```

#### Contact Information
```json
["schema.org:FoodEstablishment:telephone", "tel:+155512345678", "https://datatracker.ietf.org/doc/html/rfc3966"],
["schema.org:FoodEstablishment:email", "mailto:contact@example.com", "https://schema.org/email"],
```

#### Reservations & Hours
```json
["schema.org:FoodEstablishment:acceptsReservations", "https://synvya.com", "https://schema.org/acceptsReservations"],  // or "True" or "False"
["schema.org:FoodEstablishment:openingHours", "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 11:00-21:00", "https://schema.org/openingHours"]
```

#### Keywords (Dietary & General)
```json
["t", "vegan"],  // lowercase for profiles
["t", "gluten free"],
["t", "tapas"],
["t", "paella"]
```

Note: Dietary tags in profiles use **lowercase** format (e.g., `"vegan"`, `"gluten free"`).

### Complete Example

```json
{
  "id": "a6d84ecaf969fd6ed222e5e2a108b0bf36a2ef1682cc6ee5459d6a8627e887c4",
  "kind": 0,
  "pubkey": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
  "created_at": 1763510731,
  "content": "{\"name\":\"elcandado\",\"display_name\":\"Restaurante El Candado\",\"about\":\"Authentic Spanish restaurant...\",\"website\":\"https://www.synvya.com/demo/elcandado\",\"banner\":\"https://example.com/banner.png\"}",
  "tags": [
    ["schema.org:FoodEstablishment", "Restaurant", "https://schema.org/FoodEstablishment"],
    ["t", "vegan"],
    ["t", "gluten free"],
    ["schema.org:FoodEstablishment:servesCuisine", "Spanish", "https://schema.org/servesCuisine"],
    ["schema.org:PostalAddress:streetAddress", "123 Main Street", "https://schema.org/streetAddress"],
    ["schema.org:GeoCoordinates:latitude", "47.5289527", "https://schema.org/latitude"],
    ["schema.org:FoodEstablishment:acceptsReservations", "https://synvya.com", "https://schema.org/acceptsReservations"],
    ["schema.org:FoodEstablishment:openingHours", "Tu-Th 11:00-21:00, Fr-Sa 11:00-00:00, Su 11:00-21:00", "https://schema.org/openingHours"]
  ],
  "sig": "..."
}
```

---

## Menu Item

Purpose: Represents an individual menu item (dish/product) that can be linked to menus. Based on Nostr `kind:30402` events. 

### Required Tags

#### Identifier
```json
["d", "0001"]  // Unique identifier within establishment
```

#### Menu Link
```json
["a", "30405", "<establishment-pubkey>", "<menu-identifier>"]
```

Example:
```json
["a", "30405", "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f", "Dinner"]
```

Important: 
- The fourth element (`"Dinner"`) must match the `d` tag value of the target menu collection
- A menu item can belong to multiple menus (add multiple `a` tags)

### Recommended Tags

#### Title
```json
["title", "Bacalao al Pil Pil"]
```
Fallback: If missing, name is extracted from content markdown (`**Dish Name**`)

#### Summary
```json
["summary", "Salt cod in garlic-olive oil emulsion with guindilla peppers"]
```

#### Price
```json
["price", "26.99", "USD"]  // Currency defaults to "USD" if omitted
```

#### Image
```json
["image", "https://example.com/dish-image.png", ""]
```

#### Geohash 
```json
["g", "c23q7u2hn"]  // Decoded to latitude/longitude
```

#### Diet 

Diet tags use both schema.org notation and `t` tag notation
```json
["schema.org:MenuItem:suitableForDiet", "VEGAN", "https://schema.org/suitableForDiet"],
["schema.org:MenuItem:suitableForDiet", "GLUTEN_FREE", "https://schema.org/suitableForDiet"]
```

```json
["t", "VEGAN"],
["t", "GLUTEN_FREE"],
["t", "DAIRY_FREE"],
["t", "VEGETARIAN"]
```

Note: Both `t` and `schema.org:MenuItem:suitableForDiet` tags are checked and mapped to `schema.org:MenuItem:suitableForDiet` values (e.g., `VEGAN` → `VeganDiet`, `GLUTEN_FREE` → `GlutenFreeDiet`).

####  Allergens
```json
["schema.org:Recipe:recipeIngredient", "FISH", "https://schema.org/recipeIngredient"],
["schema.org:Recipe:recipeIngredient", "SULPHITES", "https://schema.org/recipeIngredient"],
["schema.org:Recipe:recipeIngredient", "GLUTEN", "https://schema.org/recipeIngredient"],
["schema.org:Recipe:recipeIngredient", "CRUSTACEANS", "https://schema.org/recipeIngredient"],
["schema.org:Recipe:recipeIngredient", "MOLLUSCS", "https://schema.org/recipeIngredient"]
```

These are automatically appended to the description as: "Contains FISH, SULPHITES"

### Complete Example

```json
{
  "id": "14be87de6161f6b536ecb2cad459dd922478218674be7c60b6fa2e552e1a3734",
  "kind": 30402,
  "pubkey": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
  "created_at": 1763511307,
  "content": "**Bacalao al Pil Pil**\n\nSalt cod in garlic-olive oil emulsion with guindilla peppers",
  "tags": [
    ["d", "0008"],
    ["title", "Bacalao al Pil Pil"],
    ["summary", "Salt cod in garlic-olive oil emulsion with guindilla peppers"],
    ["price", "26.99", "USD"],
    ["image", "https://example.com/bacalao.png", ""],
    ["g", "c23q7u2hn"],
    ["schema.org:Recipe:recipeIngredient", "FISH", "https://schema.org/recipeIngredient"],
    ["schema.org:Recipe:recipeIngredient", "SULPHITES", "https://schema.org/recipeIngredient"],
    ["t", "DAIRY_FREE"],
    ["t", "GLUTEN_FREE"],
    ["a", "30405", "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f", "Dinner"],
    ["schema.org:MenuItem:suitableForDiet", "DAIRY_FREE", "https://schema.org/suitableForDiet"],
    ["schema.org:MenuItem:suitableForDiet", "GLUTEN_FREE", "https://schema.org/suitableForDiet"]
  ],
  "sig": "..."
}
```

---

## Menu

Purpose: Represents a menu (collection of menu items) like "Lunch Menu" or "Dinner Menu". Based on Nostr `kind:30405` events. 

### Required Tags

#### Menu Identifier
```json
["d", "Dinner"]  // or "Lunch", "Breakfast", etc.
```

**Critical**: This identifier must match the fourth element of `a` tags in menu items that belong to this menu.

#### Product Links
```json
["a", "30402", "<establishment-pubkey>", "<product-identifier>"]
```

### Recommended Tags
#### Title
```json
["title", "Dinner Menu"]
```

#### Summary
```json
["summary", "Dinner Menu for Restaurant El Candado"]
```

Example:
```json
["a", "30402", "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f", "0005"],
["a", "30402", "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f", "0006"]
```

**Note**: The server primarily finds products via reverse links (product `a` tags pointing to this menu) but both `Menu` and `MenuItem` should point at each other.

#### Location
```json
["location", "123 Main Street, Snoqualmie, WA, 98065, USA"]
```
or 

```json
["g", "c23q7u2hn"]
```

### Content Field

Can be empty:
```json
"content": ""
```

### Complete Example

```json
{
  "id": "680413258e74b46dd309688b10221abf1fb46ab6c12e16bd4ca4168648c36800",
  "kind": 30405,
  "pubkey": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
  "created_at": 1763449048,
  "content": "",
  "tags": [
    ["d", "Dinner"],
    ["title", "Dinner Menu"],
    ["summary", "Dinner Menu for Restaurant El Candado"],
    ["location", "123 Main Street, Snoqualmie, WA, 98065, USA"],
    ["g", "c23q7u2hn"]
  ],
  "sig": "..."
}
```

---

## Relationships & Cross-References

### How Events Link Together

```
kind:0 (Profile)
  └─ pubkey: abc123
      │
      ├─> kind:30405 (Menu Collection)
      │     └─ pubkey: abc123, d: "Dinner"
      │           │
      │           └─> kind:30402 (Menu Item)
      │                 └─ pubkey: abc123, d: "0001"
      │                       └─ a: ["a", "30405", "abc123", "Dinner"]
      │
      └─> kind:30405 (Menu Collection)
            └─ pubkey: abc123, d: "Lunch"
                  └─> kind:30402 (Menu Item)
                        └─ pubkey: abc123, d: "0002"
                              └─ a: ["a", "30405", "abc123", "Lunch"]
```

### Linking Rules

1. **Profile → Menus**: Linked by matching `pubkey` values
2. **Menu → Menu Items**: 
   - **Primary**: Product `a` tags reference menu: `["a", "30405", pubkey, menu_d_tag]`
   - **Optional**: Menu `a` tags reference products: `["a", "30402", pubkey, product_d_tag]`
3. **Menu Item → Profile**: Linked by matching `pubkey` values

### Example: Creating a Complete Menu

**Step 1**: Create profile (kind:0)
```json
{
  "kind": 0,
  "pubkey": "abc123...",
  "tags": [
    ["schema.org:FoodEstablishment", "Restaurant", "https://schema.org/FoodEstablishment"]
    // more tags
  ],
  "content": "{\"display_name\":\"My Restaurant\"}"
}
```

**Step 2**: Create menu collection (kind:30405)
```json
{
  "kind": 30405,
  "pubkey": "abc123...",  // Same pubkey as profile
  "tags": [
    ["d", "Dinner"],  // Menu identifier
    ["title", "Dinner Menu"]
  ]
}
```

**Step 3**: Create menu items (kind:30402)
```json
{
  "kind": 30402,
  "pubkey": "abc123...",  // Same pubkey as profile
  "tags": [
    ["d", "0001"],  // Product identifier
    ["title", "Dish Name"],
    ["a", "30405", "abc123...", "Dinner"]  // Links to menu (matches menu's d tag)
  ]
}
```
