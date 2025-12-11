# OpenAPI Schema Automation

This document explains how the OpenAPI schema is automatically generated from Zod schemas, eliminating the need for manual synchronization.

## Overview

The DineDirect MCP Server maintains two schema definitions:
1. **MCP Schema** (`src/register-tools.ts`) - Used by MCP clients like MCP Explorer
2. **OpenAPI Schema** (`/v1/schema` endpoint) - Used by Custom GPTs and other OpenAPI clients

Previously, these were maintained separately, leading to sync issues. Now, the OpenAPI schema is **automatically generated** from Zod schemas.

## How It Works

### 1. Single Source of Truth

Zod schemas are defined in `src/generate-openapi.ts`. These schemas mirror the structure used in `src/register-tools.ts` for MCP tools.

### 2. Automatic Conversion

The `generateOpenAPISchema()` function uses `zod-to-json-schema` to convert Zod schemas into JSON Schema format compatible with OpenAPI 3.1.0.

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";

// Define schema once
const MenuSchema = z.object({
  "@type": z.string(),
  "name": z.string(),
  "hasMenuSection": z.array(MenuSectionSchema).optional(),
});

// Auto-convert to OpenAPI
schema: zodToJsonSchema(MenuSchema as any, { $refStrategy: "none" })
```

### 3. Endpoint Serves Generated Schema

The `/api/schema-v1` endpoint (rewritten to `/v1/schema`) calls `generateOpenAPISchema()` to serve the auto-generated schema:

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

### ✅ No Manual Sync Required

When you update the Zod schemas in `src/generate-openapi.ts`, the OpenAPI schema automatically reflects those changes. No need to manually update two separate files.

### ✅ Type Safety

TypeScript ensures the Zod schemas are valid at compile time, preventing schema errors.

## Making Changes

### To Update a Schema:

1. **Edit the Zod schema** in `src/generate-openapi.ts`
2. **Build** the project: `npm run build`
3. **Deploy**: Changes automatically deploy via Vercel

Example - Adding a new property to Menu:

```typescript
// In src/generate-openapi.ts
const MenuSchema = z.object({
  "@type": z.string(),
  "name": z.string(),
  "identifier": z.string(),
  "hasMenuSection": z.array(MenuSectionSchema).optional(),
  "newProperty": z.string().optional(), // ← Add here
});
```

That's it! The OpenAPI schema will automatically include `newProperty`.

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
