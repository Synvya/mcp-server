# Synvya MCP Server

MCP server for AI assistants to discover restaurants via Nostr data.

## Available Tools

### search_food_establishments

Find food establishments (restaurants, bakeries, cafes, etc.) by type, cuisine, dietary needs, or free-text search. All filters are combined with AND logic. Returns an array of JSON-LD formatted food establishment objects following the schema.org FoodEstablishment specification. The output may contain mixed types (Restaurant, Bakery, etc.).

**Parameters:**
- `foodEstablishmentType` (optional): Filter by schema.org FoodEstablishment type
  - Valid values: `Bakery`, `BarOrPub`, `Brewery`, `CafeOrCoffeeShop`, `Distillery`, `FastFoodRestaurant`, `IceCreamShop`, `Restaurant`, `Winery`
  - If not provided, returns all FoodEstablishment types
  - Type is determined from the `l` tag in Nostr profiles: `["l", "https://schema.org:<type>"]`
- `cuisine` (optional): Cuisine type (e.g., "Spanish", "Italian", "Mexican")
  - Searches `schema.org:servesCuisine` tags first (SEO-compatible), then falls back to description text matching
- `query` (optional): Free-text search for establishment name, location, or description
  - Matches establishment name, description text, or location data from `schema.org:PostalAddress` tags
  - Example: "Snoqualmie" to find establishments in that location
- `dietary` (optional): Dietary requirement (e.g., "vegan", "gluten free")
  - Matches against lowercase dietary tags in profiles
  - Tags are normalized for flexible matching (handles "gluten free" vs "gluten-free")

**Returns:**
- `food_establishments`: Array of JSON-LD formatted food establishment objects, each containing:
  - `@context` (string): JSON-LD context ("https://schema.org")
  - `@type` (string): Schema.org FoodEstablishment type (Bakery, BarOrPub, Brewery, CafeOrCoffeeShop, Distillery, FastFoodRestaurant, IceCreamShop, Restaurant, or Winery)
  - `name` (string): Restaurant display name
  - `description` (string): Full restaurant description (from `about` field)
  - `identifier` (string): Restaurant pubkey (Nostr identifier) - **use this for `get_menu_items`**
  - `address` (object, optional): PostalAddress with streetAddress, addressLocality, addressRegion, postalCode, addressCountry
  - `telephone` (string, optional): Phone number
  - `email` (string, optional): Email in mailto: format
  - `openingHours` (array, optional): Opening hours in format `["Tu-Th 11:00-21:00", "Fr-Sa 11:00-00:00", "Su 11:00-21:00"]`
  - `image` (string, optional): Banner image URL
  - `servesCuisine` (array, optional): Array of cuisine types
  - `geo` (object, optional): GeoCoordinates with latitude and longitude
  - `url` (string, optional): Website URL
  - `acceptsReservations` (string, optional): "True", "False", or URL
  - `keywords` (string, optional): Comma-separated keywords from tags

**Example:**
```json
{"foodEstablishmentType": "Restaurant", "cuisine": "Spanish", "dietary": "vegan"}
{"foodEstablishmentType": "Bakery", "dietary": "gluten free"}
{"query": "Snoqualmie"}
{"cuisine": "Italian", "query": "pizza"}
```

**Behavior Notes:**
- All filters use AND logic (must match all specified criteria)
- **STRICT**: Only profiles with valid `l` tag containing a FoodEstablishment type are included. Profiles without valid `l` tag are ignored.
- FoodEstablishment type is extracted from the `l` tag: `["l", "https://schema.org:<type>"]`
- If `foodEstablishmentType` parameter is provided, only establishments of that type are returned
- If `foodEstablishmentType` is not provided, all valid FoodEstablishment types are returned (mixed types in array)
- Cuisine matching prioritizes schema.org tags for SEO compatibility
- Dietary tags are case-insensitive and handle variations
- Returns full description text (not truncated)
- Output format is JSON-LD (JSON for Linked Data) following schema.org FoodEstablishment specification
- All establishment objects include `@context` and `@type` for proper JSON-LD interpretation

---

### get_menu_items

Get all dishes from a specific food establishment menu.

**Parameters:**
- `food_establishment_identifier` (required): Food establishment pubkey (ID)
  - **MUST** be the exact `identifier` value from `search_food_establishments` results
  - The pubkey is reported as `identifier` in the JSON-LD output
  - Using establishment names will fail - always use the pubkey identifier
- `menu_id` (required): Menu identifier
  - Common values: "Lunch", "Dinner", "Brunch", "Breakfast"
  - The `menu_id` comes from the `d` tag in Nostr kind:30405 collection events

**Returns:**
- `items`: Array of menu item objects, each containing:
  - `name` (string): Dish name (extracted from markdown or content)
  - `description` (string, optional): Dish description from summary tag
  - `price` (string, optional): Price in USD format (e.g., "$10.99")

**Example:**
```json
{
  "food_establishment_identifier": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f",
  "menu_id": "Lunch"
}
```

**Behavior Notes:**
- Products are linked to collections via Nostr `["a", "30405", pubkey, collection_id]` tags
- Dish names are extracted from markdown content (e.g., `**Dish Name**`)
- If menu not found, returns available menus for that food establishment
- If food establishment not found, returns list of available establishments with their identifiers

---

### search_menu_items

Find specific dishes across all food establishments by name, ingredient, or dietary preference.

**Parameters:**
- `dish_query` (required): Dish name, ingredient, or dietary term to search for
  - Searches dish names and descriptions
  - **Auto-detects dietary terms**: If query looks like a dietary term (vegan, vegetarian, gluten-free, etc.), it will also match dishes with matching dietary tags even if the word isn't in the dish name
  - Example: "pizza" searches for pizza dishes, "vegan" finds all vegan dishes (by tag)
- `dietary` (optional): Additional dietary filter
  - Combined with `dish_query` using AND logic
  - If `dish_query` is already a dietary term, this adds an additional constraint
- `food_establishment_identifier` (optional): Filter results to a specific food establishment
  - Use the `identifier` from `search_food_establishments` results
  - The pubkey is reported as `identifier` in the JSON-LD output

**Returns:**
- `results`: Array of dish objects, each containing:
  - `dish` (string): Dish name
  - `description` (string, optional): Dish description
  - `price` (string, optional): Price in USD
  - `restaurant` (string): Food establishment name
  - `food_establishment_identifier` (string): Food establishment pubkey (identifier)
  - `menu` (string, optional): Menu name where dish appears (dishes can appear in multiple menus)

**Example:**
```json
{"dish_query": "pizza"}
{"dish_query": "vegan"}  // Auto-detects as dietary term
{"dish_query": "pizza", "dietary": "vegan"}
{"dish_query": "tomato", "food_establishment_identifier": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f"}
```

**Behavior Notes:**
- Automatically detects common dietary terms: vegan, vegetarian, gluten-free, gluten free, dairy-free, dairy free, nut-free, nut free
- When a dietary term is detected, matches both text search AND dietary tags
- Products use uppercase dietary tags with underscores (e.g., "VEGAN", "GLUTEN_FREE") - normalized for matching
- Dishes can appear in multiple menus - all matches are returned
- Dietary tag matching is case-insensitive and handles variations

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
       "synvya-restaurant": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-server/dist/server.js"]
       }
     }
   }
   ```

3. **Restart Claude Desktop** - The server will automatically start when Claude connects.

#### Example test queries:
   - Search food establishments: `{"foodEstablishmentType": "Restaurant", "cuisine": "Spanish", "dietary": "vegan"}` or `{"query": "Snoqualmie"}` or `{"foodEstablishmentType": "Bakery", "dietary": "gluten free"}`
   - Get menu items: `{"food_establishment_identifier": "e01e4b0b3677204161b8d13d0a7b88e5d2e7dac2f7d2cc5530a3bc1dca3fbd2f", "menu_id": "Lunch"}`
   - Search dishes: `{"dish_query": "pizza"}` or `{"dish_query": "vegan"}` (auto-detects dietary term)

## Data Files

The server reads from JSON files in the `data/` directory:
- `profiles.json` - Restaurant profiles (kind:0 events)
- `collections.json` - Menu collections (kind:30405 events)
- `products.json` - Individual dishes (kind:30402 events)

## ChatGPT Integration

Once deployed, add the MCP server URL to ChatGPT:
1. Settings → Advanced → Enable developer mode
2. Tools → Add → MCP Server → Enter your HTTPS URL
