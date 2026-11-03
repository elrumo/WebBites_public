/**
 * Folding hourly Redis hashes into the admin API-metrics payload.
 *
 * Route patterns contain ':' (`/v1/api/bookmarks/:id`), which is what the
 * field parsing has to survive.
 *
 * Run with:  npm run test:apiMetrics
 */

import { aggregate, hourKey, statusClass } from './apiMetrics';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

check('hourKey is UTC YYYYMMDDHH', hourKey(new Date('2026-09-30T07:45:00Z')) === 'api_metrics:2026093007');
check('statusClass', statusClass(201) === '2xx' && statusClass(429) === '4xx' && statusClass(503) === '5xx');

const m = aggregate([
    { hour: 'h1', hash: {
        'req:GET /v1/api/bookmarks/:id:2xx': '3',
        'req:GET /v1/api/bookmarks/:id:4xx': '1',
        'ms:GET /v1/api/bookmarks/:id': '400',
        'user:u1': '4',
    } },
    { hour: 'h2', hash: {} },
    { hour: 'h3', hash: {
        'req:POST /v1/api/bookmarks:5xx': '2',
        'ms:POST /v1/api/bookmarks': '100',
        'user:u2': '2',
        'user:u1': '1',
    } },
]);

check('series keeps every hour, empty ones zeroed', m.series.length === 3 && m.series[1].requests === 0);
check('hour totals', m.series[0].requests === 4 && m.series[0].errors === 1 && m.series[0].avgMs === 100);
const byId = m.routes.find(r => r.route === 'GET /v1/api/bookmarks/:id');
check('route with :param parsed whole', !!byId && byId.requests === 4 && byId.errors === 1 && byId.avgMs === 100);
const post = m.routes.find(r => r.route === 'POST /v1/api/bookmarks');
check('5xx counted as errors', !!post && post.errors === 2 && post.avgMs === 50);
check('routes sorted by requests', m.routes[0].route === 'GET /v1/api/bookmarks/:id');
check('users summed across hours', m.users[0].userId === 'u1' && m.users[0].requests === 5);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
