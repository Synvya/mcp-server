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

Get all dishes from a specific food establishment menu. Returns a complete Menu object with menu items organized by sections.

**Parameters:**
- `restaurant_id` (required): Food establishment identifier 
  - **MUST** be the exact `@id` value from `search_food_establishments` results
- `menu_identifier` (required): Menu identifier
  - **MUST** be the exact `identifier` value from the `hasMenu` array in `search_food_establishments` results

**Returns:**
A JSON-LD Menu object following schema.org Menu specification:
- `@context`: "https://schema.org"
- `@type`: "Menu"
- `name` (string): Menu name 
- `description` (string, optional): Menu description 
- `identifier` (string): Menu identifier 
- `hasMenuSection` (array): Array of MenuSection objects, each containing:
  - `@type`: "MenuSection"
  - `name` (string): Section name (e.g., "Appetizers", "Entrees", "Sides")
  - `description` (string, optional): Section description
  - `identifier` (string): Section identifier
  - `hasMenuItem` (array): Array of MenuItem objects in this section, each containing:
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
- Output format is JSON-LD (JSON for Linked Data) following schema.org Menu, MenuSection, and MenuItem specifications
- Menu items are grouped by sections (e.g., Entrees, Sides, Appetizers)
- All objects include `@context` and/or `@type` for proper JSON-LD interpretation
- Dietary tags are mapped to schema.org suitableForDiet values
- Unmapped dietary tags are appended to the description as text (e.g., "Nut free. Sulphites")
- If menu not found, returns an error with empty hasMenuSection array
- If food establishment not found, returns an error with empty hasMenuSection array

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

## Deployment

### Deploy to Vercel

The MCP server can be deployed to Vercel as a serverless function, making it accessible to ChatGPT over HTTPS.

#### Prerequisites

1. A Vercel account (Hobby plan or higher)
2. The Vercel CLI installed (optional, for local testing):
   ```bash
   npm install -g vercel
   ```

#### Deployment Steps

1. **Push your code to GitHub** (if not already done):
   ```bash
   git push origin main
   ```

2. **Import project in Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New..." → "Project"
   - Import your GitHub repository (`synvya/mcp-server`)
   - Configure project settings:
     - **Framework Preset**: "Other"
     - **Root Directory**: `./`
     - **Build Command**: `npm run build` (or leave default)
     - **Output Directory**: Leave empty
     - **Install Command**: `npm install` (or leave default)

3. **Deploy**:
   - Click "Deploy"
   - Wait for the deployment to complete
   - Note your deployment URL (e.g., `https://mcp.synvya.com`)

4. **Test the deployment**:
   ```bash
   npx @modelcontextprotocol/inspector@latest https://your-app.vercel.app/mcp
   ```
   
   The MCP endpoint will be available at:
   - Primary: `https://your-app.vercel.app/api/mcp`
   - Alias: `https://your-app.vercel.app/mcp` (via rewrite rule)

#### Connect to ChatGPT

1. **Enable Developer Mode in ChatGPT**:
   - Go to ChatGPT settings
   - Enable "Developer Mode" or "Connectors"

2. **Add MCP Server**:
   - In ChatGPT, go to the Connectors/Integrations section
   - Add a new MCP server connector
   - Enter your server URL: `https://your-app.vercel.app/mcp`
   - Configure authentication if needed (currently not required)

3. **Test the connection**:
   - ChatGPT should now be able to use your MCP tools
   - Try asking: "Find me a vegan Spanish restaurant"

#### Connect to CustomGPT / OpenAI Actions

For CustomGPT or OpenAI Actions integration, use the auto-generated OpenAPI schema:

1. **In CustomGPT/GPT Builder**:
   - Go to "Configure" → "Actions"
   - Click "Import from URL"
   - Enter: `https://mcp.synvya.com/api/schema-v1`
   - Click "Import"

2. **Configure Authentication**:
   - Authentication: None (API is public)
   - Privacy Policy: Optional (add your privacy policy URL if needed)

3. **Test the Actions**:
   - Use the "Test" button in the Actions editor to verify each endpoint
   - Try asking your GPT: "Find me a vegan Spanish restaurant in Snoqualmie"

**Notes:**
- The schema is auto-generated from the same Zod schemas used by the MCP interface
- Schema updates automatically when you redeploy to Vercel
- All endpoints support CORS for browser-based testing

#### Environment Variables

Configure these in your Vercel project settings (Settings → Environment Variables):

**DynamoDB Integration** (optional - profiles and collections can be loaded from live Nostr data):
- `USE_DYNAMODB` - Enable DynamoDB integration (default: `false`)
  - Set to `true` to load profiles and collections from DynamoDB instead of static files
- `DYNAMODB_TABLE_NAME` - DynamoDB table name (default: `synvya-nostr-events`)
- `AWS_REGION` - AWS region (default: `us-east-1`)
- `AWS_ACCESS_KEY_ID` - IAM user access key (required if `USE_DYNAMODB=true`)
- `AWS_SECRET_ACCESS_KEY` - IAM user secret key (required if `USE_DYNAMODB=true`)
- `PROFILE_CACHE_TTL_SECONDS` - Profile cache duration in seconds (default: `300` = 5 minutes)
- `COLLECTION_CACHE_TTL_SECONDS` - Collection cache duration in seconds (default: `300` = 5 minutes)

**Notes:**
- When `USE_DYNAMODB=false` (default), profiles and collections are loaded from `data/*.json` files
- When `USE_DYNAMODB=true`, profiles (kind:0) and collections (kind:30405) are loaded from DynamoDB with automatic caching
- If DynamoDB query fails, the system automatically falls back to static files
- Cache reduces DynamoDB costs and improves response times

#### Troubleshooting

- **Data files not found**: Ensure `data/` directory is committed to git and not in `.vercelignore`
- **Build failures**: Check that `npm run build` completes successfully locally
- **Cold starts**: First request may be slower due to serverless cold starts
- **CORS issues**: The server includes CORS headers for browser-based testing

## Data Sources

### Static Files (Default)

By default, the server reads from JSON files in the `data/` directory:
- `profiles.json` - Restaurant profiles (kind:0 events)
- `collections.json` - Menu collections (kind:30405 events)
- `products.json` - Individual dishes (kind:30402 events)

### DynamoDB Integration (Optional)

When `USE_DYNAMODB=true`, the server loads profiles from AWS DynamoDB:
- **Table**: `synvya-nostr-events` (configurable)
- **Source**: Live Nostr relay data (updated every 30 minutes via Lambda)
- **Caching**: 5-minute in-memory cache (configurable)
- **Fallback**: Automatically uses static files if DynamoDB fails

**Benefits of DynamoDB:**
- ✅ Real-time profile updates from Nostr relays
- ✅ Automatic synchronization every 30 minutes
- ✅ Scalable to thousands of restaurants
- ✅ No manual data file updates needed

**Setup:**
1. Complete Issues #30-32 (DynamoDB table, Lambda function, EventBridge schedule)
2. Configure Vercel environment variables (see above)
3. Set `USE_DYNAMODB=true` in production
