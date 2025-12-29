# DynamoDB Integration Testing Guide

## 🧪 Testing Status

**Code Status:** ✅ Pushed to main (commit: 19d3769)  
**Vercel Deployment:** ⏳ In progress  
**Environment Variables:** ✅ Configured

---

## 🎯 Test Objectives

1. ✅ Verify Preview environment uses DynamoDB
2. ✅ Verify Production environment uses DynamoDB
3. ✅ Verify Development environment uses static files
4. ✅ Confirm caching works correctly
5. ✅ Test MCP tools return correct data

---

## 📋 Test Plan

### Phase 1: Deployment Verification

**1. Check Vercel Dashboard**
- Go to: https://vercel.com/[your-team]/mcp-server
- Verify deployment is successful
- Note the deployment URLs

**2. Check Build Logs**
```bash
# From Vercel dashboard, check build logs for:
- "Building..."
- "TypeScript compilation successful"
- No errors in build output
```

---

### Phase 2: Preview Environment Testing

**Expected Configuration:**
- `USE_DYNAMODB=true`
- `PROFILE_CACHE_TTL_SECONDS=60`
- Uses AWS credentials

**Test 1: First Request (Cold Start)**
```bash
# Using curl or browser
curl https://[preview-url]/mcp -H "Content-Type: application/json"
```

**Expected Logs:**
```
Loading profiles from DynamoDB...
✅ Loaded N food establishment profiles from DynamoDB
```

**Test 2: Second Request (Cached)**
```bash
# Make another request within 60 seconds
curl https://[preview-url]/mcp -H "Content-Type: application/json"
```

**Expected Logs:**
```
✅ Using cached profiles
```

**Test 3: Cache Expiration**
```bash
# Wait 61+ seconds, then make another request
# Should reload from DynamoDB
```

**Expected Logs:**
```
Loading profiles from DynamoDB...
✅ Loaded N food establishment profiles from DynamoDB
```

**Test 4: MCP Tool - Search Food Establishments**

Test the actual MCP tool functionality:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_food_establishments",
    "arguments": {
      "foodEstablishmentType": "Restaurant"
    }
  }
}
```

**Expected Result:**
- Returns restaurant profile from DynamoDB
- Profile should match the one in DynamoDB (El Candado)
- Includes all proper schema.org fields

---

### Phase 3: Production Environment Testing

**Expected Configuration:**
- `USE_DYNAMODB=true`
- `PROFILE_CACHE_TTL_SECONDS=300`
- Uses AWS credentials

**Test 1: Production Deployment**
```bash
# Check production URL
curl https://[production-url]/mcp -H "Content-Type: application/json"
```

**Expected Logs:**
```
Loading profiles from DynamoDB...
✅ Loaded N food establishment profiles from DynamoDB
```

**Test 2: Verify 5-Minute Cache**
- First request: Loads from DynamoDB
- Requests within 5 minutes: Use cache
- After 5 minutes: Reload from DynamoDB

---

### Phase 4: Fallback Testing

**Test DynamoDB Failure Fallback:**

Option 1: Temporarily break credentials (in Preview)
- Change `AWS_ACCESS_KEY_ID` to invalid value
- Deploy
- Should see: "⚠️ DynamoDB load failed, falling back to file"
- Should see: "Loading profiles from static file..."
- MCP server should still work (using data/profiles.json)

Option 2: Test with AWS credentials removed
- Temporarily remove AWS env vars from Preview
- Should automatically fall back to static files

---

## 🔍 Log Monitoring

### View Real-Time Logs

**Vercel CLI:**
```bash
# Install Vercel CLI if needed
npm i -g vercel

# View production logs
vercel logs https://[production-url]

# View preview logs
vercel logs https://[preview-url]
```

**Vercel Dashboard:**
1. Go to project → Deployments
2. Click on deployment
3. View "Functions" logs
4. Filter for your MCP endpoint logs

---

## ✅ Success Criteria

### Preview Environment
- ✅ Deployment successful
- ✅ Connects to DynamoDB
- ✅ Loads profiles (should be 1 profile: El Candado)
- ✅ Cache works (60-second TTL)
- ✅ MCP tools return correct data
- ✅ No errors in logs

### Production Environment
- ✅ Deployment successful
- ✅ Connects to DynamoDB
- ✅ Loads profiles (should be 1 profile: El Candado)
- ✅ Cache works (300-second TTL)
- ✅ MCP tools return correct data
- ✅ No errors in logs

### Development Environment
- ✅ Uses static files (no DynamoDB)
- ✅ Works without AWS credentials

---

## 🐛 Troubleshooting

### Issue: "Error loading profiles from DynamoDB"

**Check:**
1. Environment variables are set correctly
2. AWS credentials are valid
3. IAM policy allows `dynamodb:Scan`
4. DynamoDB table exists and has data
5. AWS_REGION matches table location

**Solution:**
- System automatically falls back to static files
- Check Vercel logs for specific error message
- Verify with: `aws dynamodb scan --table-name synvya-nostr-events --limit 1`

### Issue: "Using cached profiles" but cache should be expired

**Check:**
- Verify `PROFILE_CACHE_TTL_SECONDS` is set correctly
- Check system time in logs
- Ensure you're testing in correct environment

### Issue: No profiles returned

**Check:**
1. DynamoDB has data: `aws lambda invoke --function-name synvya-nostr-querier response.json`
2. Lambda ran recently (check EventBridge)
3. Profiles have correct `foodEstablishment:*` tags

---

## 📊 Expected Results

### DynamoDB Table Contents
```bash
# Check what's in DynamoDB
aws dynamodb scan \
  --table-name synvya-nostr-events \
  --filter-expression "kind = :kind" \
  --expression-attribute-values '{":kind":{"N":"0"}}' \
  --region us-east-1
```

**Expected:**
- At least 1 profile (El Candado)
- Profile has `foodEstablishment:Restaurant` tag
- Profile content includes name, location, etc.

### MCP Server Response
```json
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "@id": "nostr:npub1...",
  "name": "Restaurante El Candado",
  // ... full profile data
}
```

---

## 🚀 Next Steps After Testing

Once all tests pass:

1. **Monitor Performance**
   - Check response times
   - Monitor DynamoDB read units
   - Track cache hit rate

2. **Cost Monitoring**
   - Check AWS billing for DynamoDB
   - Verify costs are as expected (~$0.35/month)

3. **Issue #34: Complete Testing Documentation**
   - Document any issues found
   - Update this testing guide
   - Mark Issue #34 as complete

4. **Production Rollout**
   - Verify Preview works for 24 hours
   - Enable in Production
   - Monitor for issues

---

## 📝 Test Results Log

**Date:** 2025-12-29

| Test | Environment | Status | Notes |
|------|-------------|--------|-------|
| Deployment | Preview | ⏳ Pending | Waiting for Vercel |
| DynamoDB Load | Preview | ⏳ Pending | |
| Cache (60s) | Preview | ⏳ Pending | |
| MCP Tools | Preview | ⏳ Pending | |
| Deployment | Production | ⏳ Pending | |
| DynamoDB Load | Production | ⏳ Pending | |
| Cache (300s) | Production | ⏳ Pending | |
| MCP Tools | Production | ⏳ Pending | |
| Fallback | Preview | ⏳ Pending | |

---

**Last Updated:** 2025-12-29  
**Issue:** #33 - DynamoDB Integration  
**Status:** Testing in Progress

