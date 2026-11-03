/**
 * Run: npm run test:enrichmentMessages
 *
 * Checks the QStash message set the save flow fans out for one bookmark:
 * what goes out immediately, what waits for getPageContent, and how the
 * device / import / cache flags change it.
 */
import { enrichmentContext, immediateMessages, aiMessages, automationMessage, queueBase, isEnrichmentContext } from './enrichmentMessages';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}`); }
}

const subTypes = (messages: { body: { subType: string } }[]) => messages.map(m => m.body.subType);

// Plain save from the web app (it sends fromCache:false; a regular save reuses cache anyway)
{
    const ctx = enrichmentContext('site1', { url: 'https://a.com', userId: 'u1', fromCache: false });
    const { screenshots, pageContent } = immediateMessages(ctx, false);
    check('plain: screenshots go immediately', screenshots.body.subType === 'getScreenshots');
    check('plain: page content goes immediately', pageContent?.body.subType === 'getPageContent');
    check('plain: regular save reuses cache regardless of client flag', ctx.fromCache === true);
    check('plain: page content message carries the context for the next hop', isEnrichmentContext(pageContent?.body.data));
    check('plain: AI hop = categorise, summary (automations follow categorise)', subTypes(aiMessages(ctx)).join() === 'categoriseSite,getAiSummary');
    check('plain: no adult-content no-op message', !subTypes(aiMessages(ctx)).includes('checkForAdultContent'));
    check('plain: regular queues', queueBase(ctx, 'getPageContent') === 'getPageContent' && queueBase(ctx, 'getBookmarkContent') === 'getBookmarkContent');
}

// Device sent the page body: no server extraction
{
    const ctx = enrichmentContext('site2', { url: 'https://a.com', userId: 'u1', deviceEnrichment: { siteBody: 'text' } });
    const { pageContent } = immediateMessages(ctx, true);
    check('device body: page content skipped', pageContent === null);
    check('device body: AI hop still summarises', subTypes(aiMessages(ctx)).includes('getAiSummary'));
}

// Device sent a summary: no server summary
{
    const ctx = enrichmentContext('site3', { url: 'https://a.com', userId: 'u1', deviceEnrichment: { aiSummary: { tldr: 'x' } } });
    check('device summary: getAiSummary dropped', subTypes(aiMessages(ctx)).join() === 'categoriseSite');
}

// Import: low-priority queues, client cache flag honoured
{
    const ctx = enrichmentContext('site4', { url: 'https://a.com', userId: 'u1', importing: true, fromCache: false });
    check('import: import queues', queueBase(ctx, 'getPageContent') === 'getPageContent-import' && queueBase(ctx, 'getBookmarkContent') === 'getBookmarkContent-import');
    check('import: fromCache:false honoured', ctx.fromCache === false);
    check('import: fromCache defaults to true', enrichmentContext('s', { url: 'u', userId: 'x', importing: true }).fromCache === true);
}

// Message shapes the existing handlers read
{
    const ctx = enrichmentContext('site5', { url: 'https://a.com', userId: 'u1' });
    const ai = aiMessages(ctx);
    const summary = ai.find(m => m.body.subType === 'getAiSummary')!.body.data as any;
    const categorise = ai.find(m => m.body.subType === 'categoriseSite')!.body.data as any;
    const automations = automationMessage(categorise.savedSiteId, categorise.websiteData.userId).body.data as any;
    check('getAiSummary reads websiteData.savedSiteId/userId', summary.websiteData.savedSiteId === 'site5' && summary.websiteData.userId === 'u1');
    check('categoriseSite reads savedSiteId', categorise.savedSiteId === 'site5');
    check('runAutomations is built from the categoriseSite message', automations.savedSiteId === 'site5' && automations.userId === 'u1');
    check('old messages without context are not treated as the new hop', !isEnrichmentContext({ savedSiteId: 'x', url: 'u' }));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
