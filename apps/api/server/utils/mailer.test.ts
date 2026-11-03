/**
 * Run: npm run test:mailer
 *
 * Provider selection, the default sender, and real sends: SMTP against a tiny in-process SMTP
 * server, Mailgun against an in-process HTTP server. Nothing leaves this machine.
 */
import net from 'node:net';
import http from 'node:http';
import { mailProvider, isMailEnabled, defaultFrom, sendMail, verifyMail } from './mailer';
import { siteUrl, appName, siteHost } from './site';
import { emailBrand, applyBrand } from './emailBrand';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? `\n        ${detail}` : ''}`); }
};

// Never inherit this machine's real mail, site or brand settings.
const MANAGED = ['MAIL_PROVIDER', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
    'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_API_URL', 'SITE_URL', 'VITE_WEBSITE_URL', 'APP_URL', 'APP_NAME',
    'SUPPORT_EMAIL', 'LOGO_URL'];
const reset = () => { for (const k of MANAGED) delete process.env[k]; };

/** A minimal SMTP server: accepts one message per connection and records it. */
function smtpSink() {
    const received: Array<{ from: string; to: string[]; data: string }> = [];
    const server = net.createServer((socket) => {
        let mailFrom = '', rcpt: string[] = [], inData = false, data = '';
        socket.write('220 sink ESMTP\r\n');
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            while (true) {
                if (inData) {
                    const end = buffer.indexOf('\r\n.\r\n');
                    if (end === -1) return;
                    data = buffer.slice(0, end);
                    buffer = buffer.slice(end + 5);
                    inData = false;
                    received.push({ from: mailFrom, to: rcpt, data });
                    socket.write('250 queued\r\n');
                    continue;
                }
                const nl = buffer.indexOf('\r\n');
                if (nl === -1) return;
                const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 2);
                const cmd = line.toUpperCase();
                if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250-sink\r\n250 8BITMIME\r\n');
                else if (cmd.startsWith('MAIL FROM')) { mailFrom = /<([^>]*)>/.exec(line)?.[1] ?? ''; rcpt = []; socket.write('250 ok\r\n'); }
                else if (cmd.startsWith('RCPT TO')) { rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? ''); socket.write('250 ok\r\n'); }
                else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); }
                else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
                else socket.write('250 ok\r\n');
            }
        });
    });
    return new Promise<{ port: number; received: typeof received; close: () => Promise<void> }>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve({
            port: (server.address() as net.AddressInfo).port,
            received,
            close: () => new Promise((done) => server.close(() => done())),
        })));
}

async function main() {
    console.log('provider selection');
    reset();
    check('nothing configured means no mail', mailProvider() === 'none' && !isMailEnabled());
    process.env.SMTP_HOST = 'smtp.example.com';
    check('SMTP_HOST selects smtp', mailProvider() === 'smtp' && isMailEnabled());
    process.env.MAILGUN_API_KEY = 'key'; process.env.MAILGUN_DOMAIN = 'mg.example.com';
    check('smtp wins over mailgun when both are set', mailProvider() === 'smtp');
    delete process.env.SMTP_HOST;
    check('mailgun needs both a key and a domain, and is selected with them', mailProvider() === 'mailgun');
    delete process.env.MAILGUN_DOMAIN;
    check('a mailgun key without a domain is not enough', mailProvider() === 'none');
    process.env.MAILGUN_DOMAIN = 'mg.example.com'; process.env.MAIL_PROVIDER = 'none';
    check('MAIL_PROVIDER=none switches mail off', mailProvider() === 'none');
    process.env.MAIL_PROVIDER = 'smtp';
    check('MAIL_PROVIDER overrides auto-detection', mailProvider() === 'smtp');
    process.env.MAIL_PROVIDER = 'carrier-pigeon';
    check('an unknown provider means no mail, not a guess', mailProvider() === 'none');

    console.log('\nsender and site');
    reset();
    check('with no settings the site is localhost, never a hosted domain', siteUrl() === 'http://localhost:3000' && siteHost() === 'localhost');
    check('the default sender is on the site host', defaultFrom() === 'WebBites <noreply@localhost>');
    process.env.SITE_URL = 'https://bookmarks.example.org/'; process.env.APP_NAME = 'Our Bookmarks';
    check('SITE_URL loses its trailing slash', siteUrl() === 'https://bookmarks.example.org');
    check('APP_NAME names the product', appName() === 'Our Bookmarks');
    check('the default sender follows both', defaultFrom() === 'Our Bookmarks <noreply@bookmarks.example.org>');
    process.env.MAIL_FROM = 'Support <help@example.org>';
    check('MAIL_FROM wins', defaultFrom() === 'Support <help@example.org>');
    reset(); process.env.VITE_WEBSITE_URL = 'https://old-name.example.org';
    check('the older VITE_WEBSITE_URL is still read', siteUrl() === 'https://old-name.example.org');

    console.log('\nbranding');
    reset();
    process.env.SITE_URL = 'https://bookmarks.example.org'; process.env.APP_NAME = 'Our Bookmarks'; process.env.SUPPORT_EMAIL = 'help@example.org';
    const brand = emailBrand();
    check('the logo is served from the site by default', brand.logoUrl === 'https://bookmarks.example.org/webbites-logo-medium.png');
    const filled = applyBrand('<a href="{{siteUrl}}"><img src="{{logoUrl}}" alt="{{appName}}">{{appName}} {{appName}} &copy; {{year}} {{supportEmail}}</a>');
    check('every placeholder is replaced, every time', !filled.includes('{{') && filled.split('Our Bookmarks').length === 4);
    const { default: importComplete } = await import('../../emailTemplates/importCompleteTemplate');
    const rendered = applyBrand(String(importComplete));
    check('the shipped template carries the install\'s name and link', rendered.includes('Our Bookmarks') && rendered.includes('https://bookmarks.example.org'));
    check('and nothing of the hosted service or its owner', !/webbites\.io|twitter\.com|Elías|elrumo/i.test(rendered));

    console.log('\nnothing configured');
    reset();
    const none = await sendMail({ to: 'a@b.c', subject: 's', text: 't' });
    check('sending without a provider reports why and does not throw', none.success === false && /not configured/.test(none.reason ?? ''));
    check('verifying without a provider says so', (await verifyMail()).success === false);

    console.log('\nsmtp, against a local server');
    reset();
    const sink = await smtpSink();
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), SITE_URL: 'https://bookmarks.example.org', APP_NAME: 'Our Bookmarks' });
    const verified = await verifyMail();
    check('the connection check passes', verified.success === true, verified.reason);
    const sent = await sendMail({ to: 'reader@example.com', subject: 'Hello there', text: 'plain body', html: '<p>html body</p>' });
    check('a message is accepted', sent.success === true && Boolean(sent.id), sent.reason);
    const mail = sink.received[0];
    check('the envelope sender is the default one', mail?.from === 'noreply@bookmarks.example.org', mail?.from);
    check('the recipient arrives', mail?.to.join() === 'reader@example.com');
    check('subject, text and html are all in the message', !!mail && /Subject: Hello there/.test(mail.data) && /plain body/.test(mail.data) && /html body/.test(mail.data));
    check('the From header names the install', !!mail && /From: "?Our Bookmarks"? <noreply@bookmarks.example.org>/.test(mail.data));
    await sink.close();
    const down = await sendMail({ to: 'reader@example.com', subject: 'x', text: 'y' });
    check('an unreachable server is a failed result, not an exception', down.success === false && Boolean(down.reason), JSON.stringify(down));

    console.log('\nmailgun, against a local server');
    reset();
    let seen: { url?: string; auth?: string; body?: URLSearchParams } = {};
    let status = 200;
    const api = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            seen = { url: req.url, auth: req.headers.authorization, body: new URLSearchParams(Buffer.concat(chunks).toString()) };
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(status === 200 ? JSON.stringify({ id: '<abc@mg>', message: 'Queued' }) : '{"message":"Forbidden"}');
        });
    });
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
    const apiPort = (api.address() as net.AddressInfo).port;
    Object.assign(process.env, { MAILGUN_API_KEY: 'key-123', MAILGUN_DOMAIN: 'mg.example.com', MAILGUN_API_URL: `http://127.0.0.1:${apiPort}/`, MAIL_FROM: 'Me <me@example.com>' });
    const viaMg = await sendMail({ to: ['a@example.com', 'b@example.com'], subject: 'Via Mailgun', text: 'hello', html: '<b>hello</b>', replyTo: 'r@example.com' });
    check('mailgun accepts and returns the id', viaMg.success === true && viaMg.id === '<abc@mg>', viaMg.reason);
    check('it posts to /v3/<domain>/messages', seen.url === '/v3/mg.example.com/messages', seen.url);
    check('with basic auth api:<key>', seen.auth === `Basic ${Buffer.from('api:key-123').toString('base64')}`);
    check('and the fields Mailgun expects', seen.body?.get('from') === 'Me <me@example.com>' && seen.body?.get('to') === 'a@example.com,b@example.com'
        && seen.body?.get('subject') === 'Via Mailgun' && seen.body?.get('h:Reply-To') === 'r@example.com');
    status = 401;
    const refused = await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
    check('a refusal is a failed result that says why', refused.success === false && /401/.test(refused.reason ?? ''), refused.reason);
    await new Promise((r) => api.close(r));

    console.log(`\nmailer: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
