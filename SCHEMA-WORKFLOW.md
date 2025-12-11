# Schema Management Workflow

## Quick Reference: How to Make Schema Changes

### ✅ Current Architecture (Fully Automated)

```
src/schemas.ts (SINGLE SOURCE OF TRUTH)
    ↓
    ├──→ src/register-tools.ts (MCP Server)
    └──→ src/generate-openapi.ts (OpenAPI Generator)
                ↓
            /v1/schema endpoint
```

## Workflow for Common Tasks

### 1. Add a New Property to an Existing Schema

**Example: Add `priceRange` to `FoodEstablishment`**

```typescript
// 1. Edit src/schemas.ts
export const FoodEstablishmentSchema = z.object({
  // ... existing properties ...
  "priceRange": z.string().optional().describe("Price range ($, $$, $$$, $$$$)"),
});

// 2. Build and test
npm run build
npm test

// 3. Deploy (automatic via Vercel)
```

✅ Both MCP and OpenAPI automatically include the new property!

---

### 2. Create a New Tool

**Example: Add a `get_reviews` tool**

#### Step 1: Define Schemas in `src/schemas.ts`

```typescript
export const GetReviewsInputSchema = z.object({
  restaurant_id: z.string().describe("Restaurant identifier"),
  limit: z.number().optional().describe("Max reviews to return"),
});

export const ReviewSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string(),
  date: z.string(),
  reviewer: z.string(),
});

export const GetReviewsOutputSchema = z.object({
  "@context": z.string(),
  "@type": z.string(),
  reviews: z.array(ReviewSchema),
});
```

#### Step 2: Register in MCP (`src/register-tools.ts`)

```typescript
import { GetReviewsInputSchema, GetReviewsOutputSchema } from './schemas.js';

server.registerTool(
  "get_reviews",
  {
    description: "Get customer reviews for a restaurant",
    inputSchema: GetReviewsInputSchema,
    outputSchema: GetReviewsOutputSchema,
  },
  async (args) => {
    const result = getReviews(args, data);
    return {
      structuredContent: result,
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }
);
```

#### Step 3: Add to OpenAPI (`src/generate-openapi.ts`)

```typescript
import { GetReviewsOutputSchema } from './schemas.js';

// In generateOpenAPISchema() function, add to paths:
"/api/get_reviews": {
  get: {
    operationId: "get_reviews",
    summary: "Get customer reviews",
    description: "Get customer reviews for a restaurant",
    parameters: [
      {
        name: "restaurant_id",
        in: "query",
        required: true,
        schema: { type: "string" },
        description: "Restaurant identifier"
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "number" },
        description: "Max reviews to return"
      }
    ],
    responses: {
      "200": {
        description: "Successfully retrieved reviews",
        content: {
          "application/json": {
            schema: zodToJsonSchema(GetReviewsOutputSchema as any, { $refStrategy: "none" })
          }
        }
      }
    }
  }
}
```

#### Step 4: Implement Handler (`src/tool-handlers.ts`)

```typescript
export function getReviews(
  args: { restaurant_id: string; limit?: number },
  data: ToolData
): Record<string, any> {
  // Implementation...
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    reviews: [/* ... */]
  };
}
```

#### Step 5: Create API Endpoint (`api/get_reviews.ts`)

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getReviews } from '../dist/tool-handlers.js';
import { loadToolData } from '../dist/data-loader.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const data = await loadToolData();
  const result = getReviews(req.query, data);
  return res.status(200).json(result);
}
```

#### Step 6: Add Tests

```typescript
describe('getReviews', () => {
  it('should return reviews for a valid restaurant', () => {
    const result = getReviews({ restaurant_id: 'nostr:npub1...' }, data);
    expect(result.reviews).toBeDefined();
  });
});
```

---

### 3. Modify an Existing Tool's Schema

**Example: Add optional `sort_by` parameter to `search_food_establishments`**

```typescript
// 1. Edit src/schemas.ts
export const SearchFoodEstablishmentsInputSchema = z.object({
  foodEstablishmentType: FoodEstablishmentTypeEnum.optional(),
  cuisine: z.string().optional(),
  query: z.string().optional(),
  dietary: z.string().optional(),
  sort_by: z.enum(['distance', 'rating', 'name']).optional(), // ← ADD THIS
});

// 2. Update handler in src/tool-handlers.ts to use the new parameter

// 3. Update OpenAPI path in src/generate-openapi.ts to document the new parameter

// 4. Build and test
npm run build
npm test
```

---

## File Structure

```
src/
  ├── schemas.ts              ← SINGLE SOURCE OF TRUTH
  ├── register-tools.ts       ← MCP tool registration (imports from schemas.ts)
  ├── generate-openapi.ts     ← OpenAPI generator (imports from schemas.ts)
  ├── tool-handlers.ts        ← Business logic implementation
  └── data-loader.ts          ← Data loading utilities

api/
  ├── schema-v1.ts            ← Serves the OpenAPI schema at /v1/schema
  ├── search_food_establishments.ts
  ├── get_menu_items.ts
  ├── search_menu_items.ts
  └── make_reservation.ts
```

---

## Benefits of This Architecture

1. **✅ Define Once, Use Everywhere**
   - Schemas defined once in `schemas.ts`
   - Imported by both MCP and OpenAPI
   - No duplication

2. **✅ Type Safety**
   - TypeScript ensures consistency
   - Build fails if schemas are invalid

3. **✅ Automatic Synchronization**
   - MCP and OpenAPI always match
   - No manual JSON editing

4. **✅ Easy to Maintain**
   - Single file to update
   - Clear separation of concerns

5. **✅ Self-Documenting**
   - Zod `.describe()` becomes OpenAPI descriptions
   - Schema validation rules = OpenAPI constraints

---

## Testing Your Changes

```bash
# Build TypeScript
npm run build

# Run all tests
npm test

# Test locally
npm run dev

# Test the OpenAPI schema endpoint
curl http://localhost:3000/v1/schema | jq

# Test with MCP Inspector
# (Use MCP Inspector tool to test tools)
```

---

## Deployment

Changes automatically deploy to Vercel when pushed to `main`:

1. Push to feature branch
2. Create PR
3. Tests run automatically
4. Merge to `main`
5. Vercel deploys automatically

Both `/mcp` (MCP endpoint) and `/v1/schema` (OpenAPI endpoint) update together.
