/** Run: npm run test:renderService */
import { screenshotServiceBase, screenshotServiceUrl, screenshotServiceKey, siterelicKey } from './renderService';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const MANAGED = ['SCREENSHOT_SERVICE_URL', 'SCREENSHOT_API_KEY', 'VITE_SITERELIC_KEY', 'SITERELIC_KEY'];
const reset = () => { for (const k of MANAGED) delete process.env[k]; };

reset();
check('no service configured by default (nothing is sent anywhere)', screenshotServiceBase() === null);
check('no endpoint URL without a base', screenshotServiceUrl('screenshot') === null && screenshotServiceUrl('render') === null);
check('no Siterelic key by default', siterelicKey() === null);
check('key defaults to empty', screenshotServiceKey() === '');

process.env.SCREENSHOT_SERVICE_URL = 'http://screenshot:3000/';
check('trailing slash is dropped', screenshotServiceBase() === 'http://screenshot:3000');
check('endpoint URLs are built from the base', screenshotServiceUrl('screenshot') === 'http://screenshot:3000/screenshot'
    && screenshotServiceUrl('render') === 'http://screenshot:3000/render');

process.env.SCREENSHOT_SERVICE_URL = 'https://shots.example.com/screenshot';
check('a base that already names the endpoint still works', screenshotServiceUrl('render') === 'https://shots.example.com/render');

process.env.SCREENSHOT_SERVICE_URL = '   ';
check('blank counts as unset', screenshotServiceBase() === null);

process.env.SCREENSHOT_API_KEY = 'k';
process.env.VITE_SITERELIC_KEY = ' abc ';
check('key and Siterelic key are read', screenshotServiceKey() === 'k' && siterelicKey() === 'abc');

reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
