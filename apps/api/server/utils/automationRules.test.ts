/**
 * Run: npm run test:automationRules
 *
 * Validation, condition matching and webhook templating for automations.
 */
import {
  normalizeAutomation, normalizeBoardRule, automationMatches, evaluateCondition, renderTemplate, assertPublicHttpsUrl, RuleError,
} from './automationRules';
import type { AutomationBookmark } from '../types/automation.types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function throwsRule(fn: () => unknown) {
  try { fn(); return false; } catch (e) { return e instanceof RuleError; }
}

const amazon: AutomationBookmark = {
  id: 'w1', url: 'https://smile.Amazon.com/dp/B0X', title: 'Desk "lamp"', description: '',
  type: 'product', tags: ['Home', 'lighting'], summary: '',
};

// The mockup rule
{
  const rule = normalizeAutomation({
    name: 'Save Amazon finds to my wishlist',
    conditions: [{ field: 'url', op: 'contains', value: 'amazon.com' }],
    actions: [{ type: 'add_tag', tag: 'Shopping' }, { type: 'add_to_board', boardId: 'b1' }],
  });
  check('mockup: defaults to enabled, all, bookmark.added', rule.enabled && rule.match === 'all' && rule.trigger === 'bookmark.added');
  check('mockup: matches, case-insensitively', automationMatches(rule, amazon));
  check('mockup: no match elsewhere', !automationMatches(rule, { ...amazon, url: 'https://ebay.com/x' }));
}

// Conditions
{
  const domainIs = { field: 'domain', op: 'is', value: 'www.amazon.com' } as const;
  check('domain is: subdomain matches', evaluateCondition(domainIs, amazon));
  check('domain is: lookalike does not', !evaluateCondition(domainIs, { ...amazon, url: 'https://notamazon.com' }));
  check('tag is: exact, case-insensitive', evaluateCondition({ field: 'tag', op: 'is', value: 'HOME' }, amazon));
  check('tag is_not', !evaluateCondition({ field: 'tag', op: 'is_not', value: 'home' }, amazon));
  check('title not_contains', evaluateCondition({ field: 'title', op: 'not_contains', value: 'chair' }, amazon));
  check('type is', evaluateCondition({ field: 'type', op: 'is', value: 'Product' }, amazon));
  check('bad url never throws', !evaluateCondition({ field: 'domain', op: 'contains', value: 'a' }, { ...amazon, url: 'nope' }));
}

// all / any, AI conditions, empty conditions
{
  const conditions = [
    { field: 'domain', op: 'is', value: 'ebay.com' },
    { field: 'ai_topic', op: 'is', topics: ['lighting'] },
  ] as any;
  check('any: AI hit alone is enough', automationMatches({ match: 'any', conditions }, amazon, (i) => i === 1));
  check('all: AI hit is not enough when the domain misses', !automationMatches({ match: 'all', conditions }, amazon, (i) => i === 1));
  check('no conditions = every bookmark', automationMatches({ match: 'all', conditions: [] }, amazon));
}

// Validation
{
  check('name required', throwsRule(() => normalizeAutomation({ actions: [{ type: 'read_later' }] })));
  check('an action required', throwsRule(() => normalizeAutomation({ name: 'x', actions: [] })));
  check('unknown field rejected', throwsRule(() => normalizeAutomation({ name: 'x', conditions: [{ field: 'body', op: 'is', value: 'a' }], actions: [{ type: 'read_later' }] })));
  check('unknown action rejected', throwsRule(() => normalizeAutomation({ name: 'x', actions: [{ type: 'delete' }] })));
  check('empty value rejected', throwsRule(() => normalizeAutomation({ name: 'x', conditions: [{ field: 'url', op: 'is', value: ' ' }], actions: [{ type: 'read_later' }] })));
  check('AI topic needs topics', throwsRule(() => normalizeAutomation({ name: 'x', conditions: [{ field: 'ai_topic', topics: [] }], actions: [{ type: 'read_later' }] })));
  const ai = normalizeAutomation({ name: 'x', conditions: [{ field: 'ai_topic', topics: ['design'], threshold: 7 }], actions: [{ type: 'read_later' }] });
  check('AI threshold clamped to 1', ai.conditions[0].threshold === 1);
  check('webhook body must be JSON', throwsRule(() => normalizeAutomation({ name: 'x', actions: [{ type: 'webhook', url: 'https://example.com/h', body: '{"t": {{title}}}' }] })));
  const hook = normalizeAutomation({ name: 'x', actions: [{ type: 'webhook', url: 'https://example.com/h', body: '{"t": "{{title}}", "tags": {{tags}}}' }] });
  check('valid webhook kept', hook.actions[0].url === 'https://example.com/h');
}

// Board rules (a smart board's own conditions)
{
  const rule = normalizeBoardRule({ match: 'any', conditions: [
    { field: 'domain', op: 'is', value: 'dribbble.com' },
    { field: 'ai_topic', topics: ['design'] },
  ] });
  check('board rule: AI topics dropped (they live in smartRules)', rule.conditions.length === 1 && rule.conditions[0].field === 'domain');
  check('board rule: match kept', rule.match === 'any');
  check('board rule: empty is fine', normalizeBoardRule({}).conditions.length === 0);
  check('board rule: bad condition rejected', throwsRule(() => normalizeBoardRule({ conditions: [{ field: 'url', op: 'is' }] })));
}

// Webhook urls
{
  check('http rejected', throwsRule(() => assertPublicHttpsUrl('http://example.com')));
  check('private ip rejected', throwsRule(() => assertPublicHttpsUrl('https://192.168.1.2/x')));
  check('metadata ip rejected', throwsRule(() => assertPublicHttpsUrl('https://169.254.169.254/latest')));
  check('loopback rejected', throwsRule(() => assertPublicHttpsUrl('https://127.0.0.1/')));
  check('ipv6 loopback rejected', throwsRule(() => assertPublicHttpsUrl('https://[::1]/')));
  check('localhost rejected outside dev', throwsRule(() => assertPublicHttpsUrl('http://localhost:3000/')));
  check('public https ok', assertPublicHttpsUrl('https://hooks.zapier.com/x').hostname === 'hooks.zapier.com');
}

// Templates
{
  const out = JSON.parse(renderTemplate('{"text": "Saved {{title}} → {{url}}", "tags": {{tags}}, "keep": "{{nope}}"}', amazon));
  check('template: quotes in values are escaped', out.text === `Saved Desk "lamp" → ${amazon.url}`);
  check('template: tags is an array', Array.isArray(out.tags) && out.tags.length === 2);
  check('template: unknown placeholders left alone', out.keep === '{{nope}}');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
