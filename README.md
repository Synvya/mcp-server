# Synvya MCP Server

Discover and book restaurants and other food establishments directly from your AI assistant.

## Available Tools

### search_food_establishments

Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following the schema.org FoodEstablishment specification. The output may contain mixed types (Restaurant, Bakery, etc.).

**Parameters:**
- `foodEstablishmentType` (optional): Filter by schema.org FoodEstablishment type
  - Valid values: `Bakery`, `BarOrPub`, `Brewery`, `CafeOrCoffeeShop`, `Distillery`, `FastFoodRestaurant`, `IceCreamShop`, `Restaurant`, `Winery`
  - If not provided, returns all FoodEstablishment types
- `cuisine` (optional): Cuisine type (e.g., "Spanish", "Italian", "Mexican")
  - Searches `schema.org:servesCuisine` property first, then falls back to description text matching
- `query` (optional): Free-text search for establishment name, location, or description
  - Matches establishment name, description text, or location data from `schema.org:PostalAddress` property
  - Example: "Snoqualmie" to find establishments in that location
- `dietary` (optional): Dietary requirement (e.g., "vegan", "gluten free")
  - Matches against lowercase dietary keywords in food establishment profiles
  - Keywords are normalized for flexible matching (handles "gluten free" vs "gluten-free")

**Returns:**
- `food_establishments`: Array of JSON-LD formatted food establishment objects, each containing:
  - `@context` (string): JSON-LD context ("https://schema.org")
  - `@type` (string): Schema.org FoodEstablishment type (Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, or Winery)
  - `name` (string): Restaurant display name
  - `description` (string): Full restaurant description 
  - `@id` (string): Food establishment identifier - **use this as `restaurant_id` for `get_menu_items`**
  - `address` (object, optional): PostalAddress with streetAddress, addressLocality, addressRegion, postalCode, addressCountry
  - `telephone` (string, optional): Phone number
  - `email` (string, optional): Email in `mailto:` format
  - `openingHours` (array, optional): Opening hours in format `["Tu-Th 11:00-21:00", "Fr-Sa 11:00-00:00", "Su 11:00-21:00"]`
  - `image` (string, optional): Banner image URL
  - `servesCuisine` (array, optional): Array of cuisine types
  - `geo` (object, optional): GeoCoordinates with latitude and longitude
  - `url` (string, optional): Website URL
  - `acceptsReservations` (string, optional): "True", "False", or URL
  - `keywords` (string, optional): Comma-separated keywords 
  - `hasMenu` (array, optional): Array of menu objects, each containing:
    - `@type` (string): "Menu"
    - `name` (string): Menu name 
    - `description` (string, optional): Menu description 
    - `identifier` (string): Menu identifier - **use this as `menu_identifier` for `get_menu_items`**

**Example:**
```json
{"foodEstablishmentType": "Restaurant", "cuisine": "Spanish", "dietary": "vegan"}
{"foodEstablishmentType": "Bakery", "dietary": "gluten free"}
{"query": "Snoqualmie"}
{"cuisine": "Italian", "query": "pizza"}
```

**Behavior Notes:**
- All filters use AND logic (must match all specified criteria)
- If `foodEstablishmentType` parameter is provided, only establishments of that type are returned
- If `foodEstablishmentType` is not provided, all valid FoodEstablishment types are returned (mixed types in array)
- Cuisine matching prioritizes schema.org tags for SEO compatibility
- Dietary tags are case-insensitive and handle variations
- Returns full description text (not truncated)
- Output format is JSON-LD (JSON for Linked Data) following schema.org FoodEstablishment specification
- All establishment objects include `@context`, `@id`, and `@type` for proper JSON-LD interpretation

---

### get_menu_items

Get all dishes from a specific food establishment menu. Returns a complete Menu object with all menu items.

**Parameters:**
- `restaurant_id` (required): Food establishment identifier 
  - **MUST** be the exact `@id` value from `search_food_establishments` results
- `menu_identifier` (required): Menu identifier
  - **MUST** be the exact `identifier` value from the `hasMenu` array in `search_food_establishments` results

**Returns:**
A JSON-LD Menu object following schema.org Menu specification:
- `@context`: "https://schema.org"
- `@type`: "Menu"
- `name` (string): Menu name from 
- `description` (string, optional): Menu description 
- `identifier` (string): Menu identifier 
- `hasMenuItem` (array): Array of MenuItem objects, each containing:
  - `@context`: "https://schema.org"
  - `@type`: "MenuItem"
  - `name` (string): name of the menu item
  - `description` (string): Description of the menu item
  - `identifier` (string, optional): Menu item identifier 
  - `image` (string, optional): Image URL for the menu item
  - `suitableForDiet` (array, optional): Array of schema.org suitableForDiet values (e.g., "VeganDiet", "GlutenFreeDiet")
  - `offers` (object, optional): Price information with `@type: "Offer"`, `price` (number), `priceCurrency` (string)
  - `geo` (object, optional): Geographic coordinates with `@type: "GeoCoordinates"`, `latitude`, and `longitude`

**Example:**
```json
{
  "restaurant_id": "nostr:npub1...",
  "menu_identifier": "Dinner"
}
```

**Behavior Notes:**
- Output format is JSON-LD (JSON for Linked Data) following schema.org Menu and MenuItem specifications
- All objects include `@context` and `@type` for proper JSON-LD interpretation
- Dietary tags are mapped to schema.org suitableForDiet values
- Unmapped dietary tags are appended to the description as text (e.g., "Nut free. Sulphites")
- If menu not found, returns an error message
- If food establishment not found, returns an error message

---

### search_menu_items

Find specific dishes across all food establishments by name, ingredient, or dietary preference. Returns a JSON-LD graph structure with food establishments grouped by their matching menu items.

**Parameters:**
- `dish_query` (required): Dish name, ingredient, or dietary term to search for
  - Searches dish names and descriptions
  - **Auto-detects dietary terms**: If query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name
  - Example: "pizza" searches for pizza dishes, "vegan" finds all vegan dishes (by tag)
- `dietary` (optional): Additional dietary filter
  - Combined with `dish_query` using AND logic
  - If `dish_query` is already a dietary term, this adds an additional constraint
- `restaurant_id` (optional): Filter results to a specific food establishment
  - Use the `@id` from `search_food_establishments` results 

**Returns:**
A JSON-LD graph structure following schema.org specifications:
- `@context`: "https://schema.org"
- `@graph`: Array of FoodEstablishment objects, each containing:
  - `@type` (string): Schema.org FoodEstablishment type (Restaurant, Bakery, etc.)
  - `name` (string): Food establishment name
  - `geo` (object, optional): GeoCoordinates with latitude and longitude
  - `@id` (string): Food establishment identifier in bech32 format (nostr:npub1...)
  - `hasMenu` (array): Array of Menu objects, each containing:
    - `@type` (string): "Menu"
    - `name` (string): Menu name
    - `description` (string, optional): Menu description
    - `identifier` (string): Menu identifier
    - `hasMenuItem` (array): Array of MenuItem objects, each containing:
      - `@context`: "https://schema.org"
      - `@type`: "MenuItem"
      - `name` (string): Name of the menu item
      - `description` (string): Description of the menu item
      - `identifier` (string, optional): Menu item identifier
      - `image` (string, optional): Image URL for the menu item
      - `suitableForDiet` (array, optional): Array of schema.org suitableForDiet values (e.g., "VeganDiet", "GlutenFreeDiet")
      - `offers` (object, optional): Price information with `@type: "Offer"`, `price` (number), and `priceCurrency` (string)
      - `geo` (object, optional): Geographic coordinates with `@type: "GeoCoordinates"`, `latitude`, and `longitude`

**Example:**
```json
{"dish_query": "pizza"}
{"dish_query": "vegan"}  // Auto-detects as dietary term
{"dish_query": "pizza", "dietary": "vegan"}
{"dish_query": "tomato", "restaurant_id": "nostr:npub1..."}
```

**Behavior Notes:**
- Automatically detects common dietary terms: vegan, vegetarian, gluten-free, gluten free, dairy-free, dairy free, nut-free, nut free
- When a dietary term is detected, matches both text search AND dietary tags
- Products use uppercase dietary tags with underscores (e.g., "VEGAN", "GLUTEN_FREE") - normalized for matching
- Results are grouped by food establishment and menu - each establishment appears once with all matching menu items organized by menu
- Output format is JSON-LD (JSON for Linked Data) following schema.org specifications
- All objects include `@context` and `@type` for proper JSON-LD interpretation
- Dietary tags are mapped to schema.org suitableForDiet values
- Unmapped dietary tags are appended to the description as text (e.g., "Nut free. Sulphites")

## Testing

### Local Testing

The server supports both HTTP (for testing) and stdio (for Claude Desktop) transports.

#### HTTP Mode (for MCP Inspector testing)

1. **Start the server in HTTP mode:**
   ```bash
   MCP_TRANSPORT=http npm run dev
   # or
   npm run dev -- --http
   ```
   
   The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

2. **Test with MCP Inspector** (in another terminal):
   ```bash
   npm install -g @modelcontextprotocol/inspector
   mcp-inspector --transport http --server-url http://localhost:3000
   ```
   
   The inspector will open in your browser. You can then:
   - Click "List Tools" to see available tools
   - Test each tool with sample parameters
   - View structured responses

#### Stdio Mode (for Claude Desktop)

1. **Build the server:**
   ```bash
   npm run build
   ```

2. **Configure Claude Desktop** - Add to `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "synvya": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-server/dist/server.js"]
       }
     }
   }
   ```

3. **Restart Claude Desktop** - The server will automatically start when Claude connects.

#### Example test queries:
   - Search food establishments: `{"foodEstablishmentType": "Restaurant", "cuisine": "Spanish", "dietary": "vegan"}` or `{"query": "Snoqualmie"}` or `{"foodEstablishmentType": "Bakery", "dietary": "gluten free"}`
   - Get menu items: `{"restaurant_id": "nostr:npub1...", "menu_identifier": "Dinner"}`
   - Search dishes: `{"dish_query": "pizza"}` or `{"dish_query": "vegan"}` (auto-detects dietary term)

## Data Files

The server reads from JSON files in the `data/` directory:
- `profiles.json` - Restaurant profiles (kind:0 events)
- `collections.json` - Menu collections (kind:30405 events)
- `products.json` - Individual dishes (kind:30402 events)
