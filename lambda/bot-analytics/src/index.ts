import type { Handler } from 'aws-lambda';
import { listHtmlFiles, getFileContent, listLogFiles, getLogContent } from './s3-reader.js';
import { buildHandleNpubMap } from './html-parser.js';
import { parseLogFile } from './log-parser.js';
import { aggregateBotVisits, writeSummaries } from './dynamo-writer.js';
import type { BotAnalyticsEvent, BotAnalyticsResponse, BotVisit, ExecutionStats } from './types.js';

const ANALYTICS_TABLE_NAME = process.env.ANALYTICS_TABLE_NAME || 'synvya-bot-analytics';
const WEBSITE_BUCKET = process.env.WEBSITE_BUCKET || 'synvya.com';
const LOGS_BUCKET = process.env.LOGS_BUCKET || 'synvya-cloudfront-logs';

function getYesterdayDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

export const handler: Handler = async (
  event: BotAnalyticsEvent
): Promise<BotAnalyticsResponse> => {
  const startTime = Date.now();
  const stats: ExecutionStats = {
    htmlFilesScanned: 0,
    handlesResolved: 0,
    logFilesProcessed: 0,
    logLinesProcessed: 0,
    botVisitsFound: 0,
    summariesWritten: 0,
    errors: [],
    duration: 0,
  };

  try {
    const targetDate = event.date || getYesterdayDate();
    const dryRun = event.dryRun || false;
    console.log(`Analyzing bot traffic for date: ${targetDate}${dryRun ? ' (DRY RUN)' : ''}`);

    // Step 1: Build handle → npub mapping from website S3 bucket
    console.log('\n=== STEP 1: Building handle→npub mapping ===');
    const htmlKeys = await listHtmlFiles(WEBSITE_BUCKET);
    stats.htmlFilesScanned = htmlKeys.length;
    console.log(`Found ${htmlKeys.length} HTML files`);

    const htmlFiles: Array<{ key: string; html: string }> = [];
    for (const key of htmlKeys) {
      try {
        const html = await getFileContent(WEBSITE_BUCKET, key);
        htmlFiles.push({ key, html });
      } catch (err) {
        const msg = `Failed to read ${key}: ${err}`;
        console.warn(msg);
        stats.errors.push(msg);
      }
    }

    const handleNpubMap = buildHandleNpubMap(htmlFiles);
    stats.handlesResolved = Object.keys(handleNpubMap).length;
    console.log(`Resolved ${stats.handlesResolved} handles to npubs`);

    // Step 2: Read and parse CloudFront logs
    console.log('\n=== STEP 2: Processing CloudFront logs ===');
    const logKeys = await listLogFiles(LOGS_BUCKET, targetDate);
    stats.logFilesProcessed = logKeys.length;
    console.log(`Found ${logKeys.length} log files for ${targetDate}`);

    if (logKeys.length === 0) {
      console.log(`No log files found for ${targetDate}`);
    }

    const allBotVisits: BotVisit[] = [];
    for (const logKey of logKeys) {
      try {
        const logContent = await getLogContent(LOGS_BUCKET, logKey);
        const visits = parseLogFile(logContent, targetDate);
        allBotVisits.push(...visits);
        stats.logLinesProcessed += logContent.split('\n').length;
      } catch (err) {
        const msg = `Failed to process log ${logKey}: ${err}`;
        console.warn(msg);
        stats.errors.push(msg);
      }
    }

    stats.botVisitsFound = allBotVisits.length;
    console.log(`Found ${allBotVisits.length} bot visits`);

    // Step 3: Aggregate and write summaries
    console.log('\n=== STEP 3: Aggregating and writing summaries ===');
    const summaries = aggregateBotVisits(allBotVisits, handleNpubMap, targetDate);
    const written = await writeSummaries(summaries, ANALYTICS_TABLE_NAME, dryRun);
    stats.summariesWritten = written;

    // Execution summary
    stats.duration = Date.now() - startTime;
    console.log('\n=== EXECUTION SUMMARY ===');
    console.log(`  HTML files scanned: ${stats.htmlFilesScanned}`);
    console.log(`  Handles resolved: ${stats.handlesResolved}`);
    console.log(`  Log files processed: ${stats.logFilesProcessed}`);
    console.log(`  Log lines processed: ${stats.logLinesProcessed}`);
    console.log(`  Bot visits found: ${stats.botVisitsFound}`);
    console.log(`  Summaries written: ${stats.summariesWritten}`);
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  Duration: ${stats.duration}ms`);

    const isSuccess = stats.errors.length === 0;
    return {
      statusCode: isSuccess ? 200 : 207,
      body: JSON.stringify({
        success: isSuccess,
        date: targetDate,
        stats,
        message: isSuccess
          ? `Successfully analyzed bot traffic for ${targetDate}`
          : `Completed with ${stats.errors.length} errors`,
      }),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Lambda execution failed:', errorMsg);
    stats.duration = Date.now() - startTime;
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMsg,
        stats,
        message: 'Lambda execution failed',
      }),
    };
  }
};
