# GitHub Actions Workflows

## Deploy Lambda Function

Automatically builds and deploys the Nostr relay querier Lambda function when changes are detected in `lambda/nostr-querier/`.

### Workflow Triggers

- **Push to `main` branch**: Automatically deploys if Lambda code changes detected
- **Manual trigger**: Can be triggered manually via GitHub Actions UI

### How It Works

1. **Change Detection**: Checks if any files in `lambda/nostr-querier/` were modified
2. **Build**: Compiles TypeScript to JavaScript
3. **Package**: Creates deployment zip with compiled code and production dependencies
4. **Deploy**: Updates Lambda function code in AWS
5. **Environment Variables** (optional): Updates Lambda configuration if enabled

### Required GitHub Secrets

Configure these secrets in your GitHub repository settings:

#### AWS Authentication (OIDC)

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `AWS_ROLE_ARN` | IAM role ARN for GitHub Actions | `arn:aws:iam::123456789012:role/GitHubActionsRole` |
| `AWS_REGION` | AWS region where Lambda is deployed | `us-east-1` |

#### Lambda Configuration

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `LAMBDA_FUNCTION_NAME` | Lambda function name | `synvya-nostr-querier` |
| `DYNAMODB_TABLE_NAME` | DynamoDB table name | `synvya-nostr-events` |

#### Nostr Configuration (Optional - for environment updates)

| Secret Name | Required | Description | Example Value |
|-------------|----------|-------------|---------------|
| `NOSTR_RELAYS` | No | Comma-separated relay URLs | `wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol` |
| `MAX_EVENTS_PER_RELAY` | No | Max events per relay | `1000` |
| `QUERY_TIMEOUT_MS` | No | Query timeout in milliseconds | `25000` |
| `UPDATE_LAMBDA_ENVIRONMENT` | No | Set to `true` to update env vars on deploy | `false` |

---

## Setting Up GitHub Secrets

### Step 1: Create IAM Role for GitHub Actions (OIDC)

This allows GitHub Actions to assume an AWS role without storing long-lived credentials.

1. **Create IAM OIDC Identity Provider** (if not already created):
   - Go to IAM → Identity providers → Add provider
   - **Provider type**: OpenID Connect
   - **Provider URL**: `https://token.actions.githubusercontent.com`
   - **Audience**: `sts.amazonaws.com`
   - Click **Add provider**

2. **Create IAM Role**:
   - Go to IAM → Roles → Create role
   - **Trusted entity type**: Web identity
   - **Identity provider**: `token.actions.githubusercontent.com`
   - **Audience**: `sts.amazonaws.com`
   - Click **Next**

3. **Add Permissions**:
   - Create or attach policy with Lambda update permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction"
      ],
      "Resource": "arn:aws:lambda:REGION:ACCOUNT_ID:function/synvya-nostr-querier"
    }
  ]
}
```

4. **Configure Trust Relationship**:
   - Edit the trust relationship to restrict to your repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Synvya/mcp-server:*"
        }
      }
    }
  ]
}
```

5. **Name the role**: `GitHubActionsLambdaDeployRole`
6. **Copy the Role ARN**: You'll need this for the `AWS_ROLE_ARN` secret

---

### Step 2: Configure GitHub Repository Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each secret below:

#### Required Secrets

**AWS_ROLE_ARN**:
```
arn:aws:iam::YOUR_ACCOUNT_ID:role/GitHubActionsLambdaDeployRole
```

**AWS_REGION**:
```
us-east-1
```
(or your preferred AWS region)

**LAMBDA_FUNCTION_NAME**:
```
synvya-nostr-querier
```

**DYNAMODB_TABLE_NAME**:
```
synvya-nostr-events
```

#### Optional Secrets (for environment variable updates)

Only needed if you set `UPDATE_LAMBDA_ENVIRONMENT=true`:

**NOSTR_RELAYS**:
```
wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol
```

**MAX_EVENTS_PER_RELAY**:
```
1000
```

**QUERY_TIMEOUT_MS**:
```
25000
```

**UPDATE_LAMBDA_ENVIRONMENT**:
```
false
```
(set to `true` only if you want to update environment variables on every deployment)

---

## Testing the Workflow

### Manual Trigger

1. Go to **Actions** tab in your GitHub repository
2. Select **Deploy Lambda Function** workflow
3. Click **Run workflow**
4. Select branch: `main`
5. Click **Run workflow**

### Automatic Trigger

Push changes to the `lambda/nostr-querier/` directory:

```bash
git add lambda/nostr-querier/
git commit -m "Update Lambda function"
git push origin main
```

The workflow will automatically detect changes and deploy.

---

## Monitoring Deployments

### View Workflow Runs

- Go to **Actions** tab in GitHub
- Click on a workflow run to see details
- View logs for each step
- Check deployment summary at the bottom

### Verify Deployment in AWS

```bash
# Get Lambda function info
aws lambda get-function --function-name synvya-nostr-querier

# Check last modified time
aws lambda get-function-configuration \
  --function-name synvya-nostr-querier \
  --query 'LastModified'
```

---

## Troubleshooting

### Workflow fails with "Could not assume role"

**Problem**: GitHub Actions can't assume the AWS IAM role.

**Solutions**:
1. Verify `AWS_ROLE_ARN` secret is correct
2. Check IAM role trust relationship includes your repository
3. Ensure OIDC identity provider is configured correctly

### Workflow skips deployment every time

**Problem**: Change detection not working.

**Solutions**:
1. Ensure changes are in `lambda/nostr-querier/` directory
2. Check workflow logs to see what was detected
3. Try manual trigger with `workflow_dispatch`

### Lambda update fails with "ResourceNotFoundException"

**Problem**: Lambda function doesn't exist.

**Solutions**:
1. Verify `LAMBDA_FUNCTION_NAME` secret matches actual function name
2. Check function exists in the correct region
3. Create the Lambda function first (see Issue #31 README)

### Build fails with TypeScript errors

**Problem**: Code doesn't compile.

**Solutions**:
1. Test build locally first: `npm run build`
2. Fix TypeScript errors before pushing
3. Check Node.js version matches (20.x)

---

## Security Best Practices

✅ **Use OIDC instead of long-lived credentials**: GitHub OIDC tokens expire automatically

✅ **Least privilege IAM policy**: Role only has permissions for Lambda updates

✅ **Restrict trust relationship**: Only your repository can assume the role

✅ **Don't commit secrets**: All sensitive values are in GitHub Secrets

✅ **Review workflow logs**: Check for any exposed sensitive data

---

## Cost Considerations

- **GitHub Actions**: Free for public repositories, 2000 minutes/month for private
- **This workflow**: ~2-3 minutes per run
- **Estimated usage**: ~100 minutes/month (with frequent deployments)

---

## Next Steps

After setting up this workflow:

1. Configure all required GitHub secrets
2. Test with a manual workflow run
3. Make a small change to Lambda code and push to `main`
4. Verify automatic deployment works
5. Monitor CloudWatch logs to confirm Lambda is working

