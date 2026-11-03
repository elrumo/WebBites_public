/**
 * The address guard for fetching user-supplied URLs.
 *
 * Every `false` case below reached an internal host through the old
 * hostname-text check (`isLocalUrl`): the Tailscale CGNAT range, cloud
 * metadata, most of 127/8, IPv4-mapped IPv6, and Docker service names.
 *
 * Run with:  npm run test:safeUrl
 */

import { assertPublicUrl, isBlockedAddress } from './safeUrl';

let pass = 0, fail = 0;
const check = (label: string, got: boolean, want: boolean) => {
    if (got === want) pass++; else { fail++; console.log(`FAIL: ${label} → ${got}, want ${want}`); }
};

// Addresses, no DNS involved
for (const ip of [
    '10.0.0.5', '127.0.0.1', '127.0.0.2', '0.0.0.0', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1',
    '100.113.112.19', '100.121.192.85', '224.0.0.1', '255.255.255.255',
    '192.0.0.1', '192.0.2.1',                 // 192.0.0.0/24 and TEST-NET-1, the only reserved parts of 192.0/16
    '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    'not-an-ip',
]) check(`blocked ${ip}`, isBlockedAddress(ip), true);

for (const ip of [
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946',
    '192.0.66.2', '192.0.78.24', '192.0.64.1', // Automattic (WordPress.com / VIP), e.g. pewresearch.org
]) {
    check(`allowed ${ip}`, isBlockedAddress(ip), false);
}

// Whole URLs. Hostnames that need DNS are left out so the test stays offline.
const run = async () => {
    for (const url of [
        'http://100.113.112.19:9000/webbites/',   // RustFS replica over Tailscale
        'http://169.254.169.254/latest/meta-data/', // cloud metadata
        'http://127.0.0.2/', 'http://0.0.0.0/', 'http://[::1]/',
        'http://[::ffff:127.0.0.1]/',
        'http://parse-server:1337/',              // Docker service name
        'http://redis/', 'https://something.local/', 'https://api.internal/',
        'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.1/',
        'file:///etc/passwd', 'gopher://x/', 'not a url',
    ]) check(`refuse ${url}`, 'error' in (await assertPublicUrl(url)), true);

    for (const url of ['http://8.8.8.8/', 'https://1.1.1.1/x?y=1']) {
        check(`allow ${url}`, 'error' in (await assertPublicUrl(url)), false);
    }

    console.log(`${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
};

run();
