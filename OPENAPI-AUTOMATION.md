# OpenAPI Schema Automation

This document explains how the OpenAPI schema is automatically generated from Zod schemas, eliminating the need for manual synchronization.

## Overview

The DineDirect MCP Server uses two schema formats:
1. **MCP Schema** (`src/register-tools.ts`) - Used by MCP clients like MCP Explorer
2. **OpenAPI Schema** (`/v1/schema` endpoint) - Used by Custom GPTs and other OpenAPI clients

**SINGLE SOURCE OF TRUTH**: All schemas are now defined once in `src/schemas.ts` and imported by both MCP and OpenAPI modules.

## How It Works

### 1. Shared Schema Definitions

All Zod schemas are defined in **`src/schemas.ts`**:
- Input/output schemas for all tools
- Common schemas (Menu, MenuItem, FoodEstablishment, etc.)
- Enums (FoodEstablishmentType, DietEnum, etc.)

Both `register-tools.ts` (MCP) and `generate-openapi.ts` (OpenAPI) import from this single file.

### 2. MCP Server Registration

`src/register-tools.ts` imports and uses shared schemas:

```typescript
import {
  SearchFoodEstablishmentsInputSchema,
  SearchFoodEstablishmentsOutputSchema,
} from './schemas.js';

server.registerTool("search_food_establishments", {
  inputSchema: SearchFoodEstablishmentsInputSchema,
  outputSchema: SearchFoodEstablishmentsOutputSchema,
  // ...
});
```

### 3. OpenAPI Generation

`src/generate-openapi.ts` imports the same schemas and converts them:

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
import { SearchFoodEstablishmentsOutputSchema } from './schemas.js';

// Auto-convert to OpenAPI JSON Schema
schema: zodToJsonSchema(SearchFoodEstablishmentsOutputSchema as any, { 
  $refStrategy: "none" 
})
```

### 4. Endpoint Serves Generated Schema

The `/api/schema-v1` endpoint (accessible at `/v1/schema`) serves the auto-generated schema:

```typescript
import { generateOpenAPISchema } from '../dist/generate-openapi.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json(generateOpenAPISchema(BASE_URL));
}
```

## Key Features

### ✅ Includes Menu Sections

The generated schema now includes the `hasMenuSection` property:

```json
{
  "@type": "Menu",
  "name": "Dinner Menu",
  "identifier": "Dinner",
  "hasMenuSection": [
    {
      "@type": "MenuSection",
      "name": "Appetizers",
      "identifier": "Appetizers"
    }
  ]
}
```

### ✅ True Single Source of Truth

When you update schemas in `src/schemas.ts`, **both** MCP and OpenAPI automatically reflect those changes. You only define each schema once.

### ✅ Type Safety

TypeScript ensures the Zod schemas are valid at compile time, preventing schema errors.

## Making Changes

### To Update an Existing Schema:

1. **Edit the schema** in `src/schemas.ts`
2. **Build** the project: `npm run build`
3. **Test**: `npm test`
4. **Deploy**: Changes automatically deploy via Vercel

Example - Adding a new property to `MenuSchema`:

```typescript
// In src/schemas.ts
export const MenuSchema = z.object({
  "@type": z.string().describe("Menu"),
  "name": z.string().describe("Menu name"),
  "identifier": z.string().describe("Menu identifier"),
  "hasMenuSection": z.array(MenuSectionSchema).optional(),
  "priceRange": z.string().optional(), // ← Add here
});
```

Both MCP and OpenAPI schemas will automatically include `priceRange`.

### To Create a New Tool:

1. **Define schemas** in `src/schemas.ts`:
   ```typescript
   export const NewToolInputSchema = z.object({...});
   export const NewToolOutputSchema = z.object({...});
   ```

2. **Register in MCP** (`src/register-tools.ts`):
   ```typescript
   import { NewToolInputSchema, NewToolOutputSchema } from './schemas.js';
   
   server.registerTool("new_tool", {
     inputSchema: NewToolInputSchema,
     outputSchema: NewToolOutputSchema,
     // ...
   });
   ```

3. **Add to OpenAPI** (`src/generate-openapi.ts`):
   ```typescript
   import { NewToolOutputSchema } from './schemas.js';
   
   // Add to paths object in generateOpenAPISchema()
   "/api/new_tool": {
     get: {
       operationId: "new_tool",
       responses: {
         "200": {
           content: {
             "application/json": {
               schema: zodToJsonSchema(NewToolOutputSchema as any, { $refStrategy: "none" })
             }
           }
         }
       }
     }
   }
   ```

## Technical Details

### Zod Version

The project uses **Zod v4** with an npm override to ensure consistent versions:

```json
{
  "dependencies": {
    "zod": "^4.0.0",
    "zod-to-json-schema": "^3.25.0"
  },
  "overrides": {
    "zod": "^4.0.0"
  }
}
```

This override ensures the MCP SDK (which supports Zod v3 OR v4) uses v4, matching `zod-to-json-schema`'s requirement.

### Type Assertions

Due to TypeScript's strict typing, we use `as any` when calling `zodToJsonSchema`:

```typescript
zodToJsonSchema(MenuSchema as any, { $refStrategy: "none" })
```

This is safe because:
- Zod schemas are validated at compile time
- The runtime conversion works correctly
- It's only needed to satisfy TypeScript's type checker

## Benefits

1. **Consistency** - MCP and OpenAPI schemas stay in sync
2. **Maintainability** - Update once, not twice
3. **Fewer bugs** - No manual copying means no human error
4. **Documentation** - Zod descriptions become OpenAPI descriptions

## Testing

To verify the generated schema:

```bash
# View the generated OpenAPI schema
curl https://mcp.dinedirect.app/v1/schema | jq
```

Look for the `hasMenuSection` property in the `hasMenu` array items to confirm menu sections are properly documented.
