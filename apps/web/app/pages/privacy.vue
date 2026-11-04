<template>
  <LegalPage
    title="Privacy Policy"
    subtitle="What WebBites collects, why, who else ever sees it, and how to make us delete it."
  >
    <section class="well">
      <h3 class="!mt-0">The short version</h3>
      <ul>
        <li>The native apps can be used with <strong>no account at all</strong>. In that mode your bookmarks live on your device and are never sent to us.</li>
        <li>With an account, we store what you save — links, notes, tags, boards, files — so it syncs between your devices. It is yours; we do not sell it and we do not use it for advertising.</li>
        <li>We use a handful of processors to run the service (hosting, payments, email, AI enrichment). They are all named below.</li>
        <li>No model is trained on your content.</li>
        <li>You can export everything and delete your account from inside the app, at any time, without asking us.</li>
      </ul>
    </section>

    <section>
      <h2>1. Who is responsible for your data</h2>
      <p>
        {{ LEGAL.product }} is operated by {{ LEGAL.operator }} ({{ LEGAL.taxId }}),
        {{ LEGAL.address }}. We are the data controller for the processing
        described here. You can reach us at
        <a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a> — a person reads it,
        and it is also the address for any request about your data.
      </p>
      <p>
        We are a small operation based in {{ LEGAL.country }}, so the GDPR
        (Regulation (EU) 2016/679) and the Spanish LOPDGDD apply to everything
        below. We are not required to appoint a Data Protection Officer and have
        not appointed one; write to the address above instead.
      </p>
      <p>
        This policy covers the website and web app at {{ LEGAL.site }}, the
        WebBites apps for iPhone, iPad, Mac, Apple Vision Pro, Apple TV and
        Apple Watch, the share and Safari extensions, the browser extension, and
        the public API.
      </p>
    </section>

    <section>
      <h2>2. Using WebBites without giving us anything</h2>
      <p>
        The native apps work signed out. In that mode there is a local library on
        your device: bites, collections, tags and your view preferences are kept
        in the app's own storage, and <strong>none of it reaches our servers</strong>.
        There is no account, so there is nothing for us to hold.
      </p>
      <p>Two things are worth being precise about, because "offline" is a word people stretch:</p>
      <ul>
        <li>
          <strong>Saving a link fetches that link.</strong> When you save a page,
          your device asks <em>that website</em> for its title, description and
          image, exactly as your browser would. That request goes to the site
          you chose to save, not to us, and it carries whatever a normal web
          request carries (your IP address, for instance). If you want none of
          that either, save while offline or turn on Airplane Mode: the bite is
          stored with what you typed.
        </li>
        <li>
          <strong>Where the thinking happens is a setting.</strong> Search and
          the read-it-for-me step at save time can run on-device (Apple's own
          models, nothing leaves the device) or in the cloud (see §5). Pick
          on-device in Settings → Intelligence and your content is not sent
          anywhere for that either.
        </li>
      </ul>
      <p>
        <strong>The exception, stated plainly:</strong> the apps send crash and
        performance reports (a stack trace, the OS version, the device model — no
        bookmark contents) to our own error-tracking server, which we run
        ourselves on our own infrastructure. It is not a third-party analytics
        product and there is no advertising identifier involved. We do not run
        any usage analytics inside the native apps.
      </p>
      <p>
        The web app is the other case: it is an account product and needs our
        servers to do anything at all.
      </p>
    </section>

    <section>
      <h2>3. What we collect when you do have an account</h2>

      <h3>Account data</h3>
      <p>
        Your email address, your username or display name, a password hash (never
        the password itself), your language and app preferences, and the dates
        your account was created and last used. If you sign in with Apple and
        choose to hide your email, we get Apple's private relay address and that
        is all we ever have.
      </p>

      <h3>Your content</h3>
      <p>
        Everything you save and everything the service derives from it so it can
        be found again: URLs, titles, descriptions, notes, annotations, tags,
        boards and collections, highlights, drawings, uploaded files and PDFs,
        screenshots and images, extracted article text, RSS feeds you follow, and
        AI-generated summaries, tags and search embeddings.
      </p>

      <h3>Technical and usage data</h3>
      <p>
        IP address, browser or device type and OS version, and server logs of the
        requests your client makes (endpoint, timestamp, response status). We use
        these to keep the service up, debug it and stop abuse — not to build a
        profile of you.
      </p>

      <h3>Billing data</h3>
      <p>
        If you subscribe, we store your plan, its status and renewal date, and the
        customer or transaction identifier from the payment provider. <strong>We
        never see or store your card number.</strong> Card details go straight to
        Stripe (on the web and Mac) or to Apple (for in-app purchases), who are
        the ones processing the payment.
      </p>

      <h3>Things you send us</h3>
      <p>
        Support emails, feedback and feature requests posted in the app, and
        anything you choose to include in them.
      </p>
    </section>

    <section>
      <h2>4. Why we process it, and on what legal basis</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Purpose</th><th>Legal basis (GDPR art. 6)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Running the service: your account, storing and syncing what you save, search, sharing, enrichment</td>
              <td>Performance of a contract — art. 6(1)(b)</td>
            </tr>
            <tr>
              <td>Taking payment, managing subscriptions, preventing payment fraud</td>
              <td>Contract — art. 6(1)(b); legal obligation for invoices and VAT — art. 6(1)(c)</td>
            </tr>
            <tr>
              <td>Security, rate limiting, abuse prevention, backups, crash and error reports</td>
              <td>Legitimate interests — art. 6(1)(f): keeping the service working and safe</td>
            </tr>
            <tr>
              <td>Aggregate, cookieless website statistics on our own analytics server</td>
              <td>Legitimate interests — art. 6(1)(f): knowing whether the site works, without tracking anyone</td>
            </tr>
            <tr>
              <td>Session recording and heatmaps on the marketing site (Microsoft Clarity)</td>
              <td>Consent — art. 6(1)(a). Nothing is recorded unless you accept the banner, and you can change your mind</td>
            </tr>
            <tr>
              <td>Product emails you asked for, and answering your support messages</td>
              <td>Contract — art. 6(1)(b); consent for anything promotional — art. 6(1)(a)</td>
            </tr>
            <tr>
              <td>Complying with tax, accounting and law-enforcement obligations</td>
              <td>Legal obligation — art. 6(1)(c)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We do not deliberately collect special-category data (health, beliefs,
        biometrics and the rest). You can of course save a page about anything you
        like; we treat the contents of your library as private either way and do
        not analyse it beyond what is needed to show, enrich and search it for you.
      </p>
    </section>

    <section>
      <h2>5. AI features</h2>
      <p>
        With an account, WebBites can summarise a page, suggest tags, answer
        questions about your library and build the embeddings that make semantic
        search work. To do that, the relevant text — the page content, your query,
        and the metadata around it — is sent to our AI providers,
        <strong>OpenAI</strong> and <strong>Anthropic</strong>, over their business
        APIs.
      </p>
      <ul>
        <li>They act as our processors, under their API terms: content sent through those APIs is not used to train their models.</li>
        <li>We send what the feature needs, not your whole library.</li>
        <li>In the native apps you can switch search and save-time enrichment to Apple's on-device models instead, and then nothing is sent for those features at all.</li>
      </ul>
      <p>
        There is no automated decision-making that produces legal effects for you,
        and no profiling in the art. 22 sense.
      </p>
    </section>

    <section>
      <h2>6. Cookies and analytics on the website</h2>
      <ul>
        <li>
          <strong>Strictly necessary.</strong> A session cookie that keeps you
          signed in, and local storage entries holding your preferences and your
          cookie choice. These cannot be switched off without breaking sign-in,
          and they need no consent.
        </li>
        <li>
          <strong>Our own website statistics.</strong> We run a self-hosted
          Plausible instance on our own infrastructure. It sets no cookies, does
          not fingerprint you, stores no personal data and never leaves our
          servers: it counts page views and referrers in aggregate.
        </li>
        <li>
          <strong>Microsoft Clarity.</strong> Only with your consent. Until you
          accept the banner it runs in Microsoft's no-consent mode, storing
          nothing on your device; if you accept, it records how the pages are used
          (clicks, scrolls, a replay of the session) so we can find what is broken.
          Decline, or clear the choice, and it records nothing. Microsoft is a
          controller for the data it holds under its own privacy statement.
        </li>
      </ul>
      <p>
        To change your answer, visit the site with <code>?resetConset</code>
        appended to the URL and the banner comes back.
      </p>
    </section>

    <section>
      <h2>7. Who else sees your data</h2>
      <p>
        We do not sell your data and we do not share it for advertising. We use
        these processors and providers to run the service:
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Who</th><th>What for</th><th>Where</th></tr>
          </thead>
          <tbody>
            <tr><td>Our own servers</td><td>Accounts and authentication, your library's database, realtime sync, the application backend, the search index, image and file storage, website statistics and error tracking — all of it on hardware we rent and administer ourselves</td><td>EU</td></tr>
            <tr><td>Upstash</td><td>Job queue and cache for the save pipeline</td><td>EU / USA</td></tr>
            <tr><td>Algolia</td><td>Legacy search index, still written to while it is retired</td><td>EU / USA</td></tr>
            <tr><td>Stripe</td><td>Payments and subscriptions on the web and Mac</td><td>USA / EU</td></tr>
            <tr><td>Apple</td><td>Sign in with Apple, App Store in-app purchases, push notifications, iCloud sync of app settings</td><td>EU / USA</td></tr>
            <tr><td>OpenAI</td><td>Summaries, tagging, embeddings, semantic search</td><td>USA</td></tr>
            <tr><td>Anthropic</td><td>Summaries, tagging, answering questions about your library</td><td>USA</td></tr>
            <tr><td>Mailgun</td><td>Transactional email: sign-up, password reset, receipts</td><td>EU / USA</td></tr>
            <tr><td>Microsoft (Clarity)</td><td>Website session analytics — only with your consent</td><td>USA</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>AI assistants you connect.</strong> If you connect an assistant
        such as Claude, ChatGPT or Cursor to your library (through Settings → AI
        assistants, or with one of your API keys), it receives the library data it
        reads — search results, notes, saved page text — and, if you allowed
        changes, can save and edit bookmarks for you. That data then sits with the
        assistant's provider, under its own terms and privacy policy: it is not
        our processor, and we do not control what it keeps. We keep a record of
        each connection (the app's name, what it may do and when it was last
        used) until you disconnect it, which you can do at any time in Settings →
        AI assistants.
      </p>
      <p>
        When you save a link, our servers fetch that page to build the preview,
        and may ask the relevant public service (for example a film, music or
        game database) for metadata about it. Those requests contain the URL you
        saved, never your identity.
      </p>
      <p>
        We will also disclose data where the law requires it — a valid order from
        a competent authority — and, if WebBites were ever sold or merged, to the
        acquirer, who would be bound by this policy until it told you otherwise.
      </p>
    </section>

    <section>
      <h2>8. Transfers outside the EEA</h2>
      <p>
        Your library itself stays in the EU: the database, your files and images,
        and the search index all live on servers we rent and administer ourselves
        in Europe. The transfers below are limited to the specific features named
        above.
      </p>
      <p>
        Some of the providers above are in the United States. Those transfers rely
        on the European Commission's Standard Contractual Clauses, or on the
        provider's certification under the EU–US Data Privacy Framework where it
        has one, together with the supplementary measures (encryption in transit,
        access controls, data minimisation) that we apply on our side. You can ask
        us for the details of the mechanism used for any given provider.
      </p>
    </section>

    <section>
      <h2>9. How long we keep it</h2>
      <ul>
        <li><strong>Your library and account:</strong> for as long as your account exists.</li>
        <li><strong>After you delete your account:</strong> your content is deleted from our live systems immediately, and disappears from encrypted backups as those roll over, within 30 days.</li>
        <li><strong>Server and security logs:</strong> up to 90 days.</li>
        <li><strong>Crash and error reports:</strong> up to 90 days.</li>
        <li><strong>Invoices and payment records:</strong> six years, because Spanish commercial and tax law requires it (art. 30 Código de Comercio; Ley General Tributaria).</li>
        <li><strong>Support emails:</strong> up to two years, so we have the thread if you write again.</li>
      </ul>
    </section>

    <section>
      <h2>10. How we protect it</h2>
      <p>
        Everything travels over TLS. Passwords are hashed, never stored in a
        readable form. Access to production systems is limited to the people who
        operate the service and protected by strong authentication. Backups are
        encrypted. Your session token lives in your device's Keychain on Apple
        platforms.
      </p>
      <p>
        No system is perfectly secure, and we will not pretend otherwise. If a
        breach ever affects your personal data and poses a risk to you, we will
        notify the Spanish supervisory authority within 72 hours and tell you
        directly where the law requires it.
      </p>
    </section>

    <section>
      <h2>11. Your rights</h2>
      <p>You can, at any time:</p>
      <ul>
        <li><strong>Access</strong> your data, and get a copy of it.</li>
        <li><strong>Correct</strong> anything inaccurate — most of it you can edit yourself in the app.</li>
        <li><strong>Delete</strong> your account and everything in it: Settings → Delete account, no email to us required.</li>
        <li><strong>Export</strong> your library in a portable format, from Settings → Export, whenever you like.</li>
        <li><strong>Restrict or object</strong> to processing based on our legitimate interests.</li>
        <li><strong>Withdraw consent</strong> (for analytics or marketing email) without affecting what was done before you withdrew it.</li>
      </ul>
      <p>
        Write to <a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a> and we
        will answer within one month. We may ask you to confirm the email address
        on the account before acting, to be sure we are not handing your library
        to someone else.
      </p>
      <p>
        If you think we have got this wrong, you can complain to the Spanish Data
        Protection Agency — Agencia Española de Protección de Datos, C/ Jorge Juan
        6, 28001 Madrid, <a href="https://www.aepd.es" target="_blank" rel="noopener">www.aepd.es</a> —
        or to the supervisory authority where you live. We would rather you told
        us first, but it is your right either way.
      </p>
    </section>

    <section>
      <h2>12. Children</h2>
      <p>
        WebBites is not directed at children. You need to be at least 14 to use it
        with an account, which is the age of digital consent in Spain (art. 7
        LOPDGDD); where you live sets a higher age, that age applies. If we learn
        we are holding an account belonging to a child below that age, we delete
        it.
      </p>
    </section>

    <section>
      <h2>13. Changes to this policy</h2>
      <p>
        When we change something material we will update the date at the top and,
        if it affects how your data is handled, tell you in the app or by email
        before it takes effect. The current version is always at
        <a href="/privacy">{{ LEGAL.site }}/privacy</a>.
      </p>
    </section>
  </LegalPage>
</template>

<script setup>
// `LEGAL` is imported rather than auto-imported: the template compiles
// against setup bindings, and an auto-import never becomes one.
import { LEGAL } from '~/utils/legal'
// Content only — the shell, the styles and the <head> live in LegalPage.
</script>
