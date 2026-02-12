import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { gunzipSync } from 'node:zlib';

const REGION = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const s3Client = new S3Client({ region: REGION });

/**
 * List all index.html files in the website S3 bucket.
 * Returns S3 keys like "restaurant/india-belly/index.html".
 */
export async function listHtmlFiles(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    });
    const response = await s3Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && obj.Key.endsWith('/index.html')) {
          keys.push(obj.Key);
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Read the content of a file from S3 as a string.
 */
export async function getFileContent(
  bucket: string,
  key: string
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);
  return (await response.Body?.transformToString()) ?? '';
}

/**
 * List all CloudFront log files for a given date.
 * Expects Hive-compatible partitioning under:
 *   AWSLogs/aws-account-id=<ACCOUNT>/CloudFront/cloudfront-logs/DistributionId=<DIST>/year=YYYY/month=MM/day=DD/
 */
export async function listLogFiles(
  bucket: string,
  date: string
): Promise<string[]> {
  const accountId = process.env.AWS_ACCOUNT_ID;
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;

  if (!accountId || !distributionId) {
    throw new Error(
      'AWS_ACCOUNT_ID and CLOUDFRONT_DISTRIBUTION_ID environment variables are required'
    );
  }

  const [year, month, day] = date.split('-');
  const prefix = `AWSLogs/aws-account-id=${accountId}/CloudFront/cloudfront-logs/DistributionId=${distributionId}/year=${year}/month=${month}/day=${day}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await s3Client.send(command);

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key) {
          keys.push(obj.Key);
        }
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * Read a CloudFront log file from S3.
 * Automatically decompresses gzip files (detected by .gz extension).
 */
export async function getLogContent(
  bucket: string,
  key: string
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3Client.send(command);

  const bodyBytes = await response.Body?.transformToByteArray();
  if (!bodyBytes) return '';

  if (key.endsWith('.gz')) {
    const decompressed = gunzipSync(Buffer.from(bodyBytes));
    return decompressed.toString('utf-8');
  }

  return Buffer.from(bodyBytes).toString('utf-8');
}
