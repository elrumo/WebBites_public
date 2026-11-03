<template>
  <LegalPage
    title="Terms and Conditions"
    subtitle="The agreement between you and us for using WebBites. Written to be read, not to be survived."
  >
    <section class="well">
      <h3 class="!mt-0">The short version</h3>
      <ul>
        <li>Your bookmarks are yours. We host them so the service can work; we claim nothing else.</li>
        <li>Paid plans renew until you cancel, and you can cancel any time from Settings.</li>
        <li>Don't use WebBites to break the law or to attack the service. That's most of the rules.</li>
        <li>We run this carefully but we are not insuring your data: keep your own export if it matters to you.</li>
        <li>Nothing here takes away the rights Spanish or EU consumer law gives you.</li>
      </ul>
    </section>

    <section>
      <h2>1. Who you are contracting with</h2>
      <p>
        {{ LEGAL.product }} is operated by {{ LEGAL.operator }} ({{ LEGAL.taxId }}),
        {{ LEGAL.address }}, contactable at
        <a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a> ("we", "us").
        These terms govern your use of the WebBites website and web app, the apps
        for iPhone, iPad, Mac, Apple Vision Pro, Apple TV and Apple Watch, the
        browser and share extensions, and the API (together, the "Service").
      </p>
      <p>
        By creating an account or using the Service you accept these terms. If you
        do not accept them, do not use the Service. Our
        <a href="/privacy">Privacy Policy</a> explains what happens to your data
        and forms part of this agreement.
      </p>
    </section>

    <section>
      <h2>2. Who may use it</h2>
      <p>
        You must be 18 or older to enter into this agreement. If you are between
        14 and 18 you may use the Service with the consent of a parent or guardian,
        who accepts these terms on your behalf. If you are using WebBites for an
        organisation, you confirm you are allowed to bind it.
      </p>
      <p>
        The native apps can be used signed out, against a library kept on your own
        device. These terms still cover that use — but with no account there is
        nothing for us to store, sync or restore.
      </p>
    </section>

    <section>
      <h2>3. Your account</h2>
      <p>
        Give us an accurate email address and keep your password to yourself. You
        are responsible for what happens under your account, so tell us promptly
        if you think someone else has got into it. One account is for one person;
        sharing credentials with a group is not a plan tier.
      </p>
    </section>

    <section>
      <h2>4. Your content</h2>
      <p>
        <strong>You own what you save.</strong> Bookmarks, notes, annotations,
        files, drawings, tags and boards remain yours. You grant us a worldwide,
        non-exclusive, royalty-free licence to store, copy, transmit, adapt and
        display that content <em>solely</em> in order to operate the Service for
        you: syncing it between your devices, generating previews and thumbnails,
        indexing it for search, backing it up, and passing the relevant part of it
        to the processors named in the Privacy Policy (including our AI providers,
        for the features that use them). The licence exists to run the product and
        ends when you delete the content or your account.
      </p>
      <p>
        We do not use your content to train AI models, we do not sell it, and we do
        not show it to anyone except you and the people you deliberately share it
        with.
      </p>
      <p>
        You are responsible for what you save. By saving it you confirm you have
        the right to keep a copy for your own use, and that it does not infringe
        anyone's rights or break any law. Saving a page for personal reading is
        ordinary; republishing someone else's work from your library is not, and
        that part is on you.
      </p>
    </section>

    <section>
      <h2>5. What you may not do</h2>
      <ul>
        <li>Break the law, or store or distribute content that is illegal — child sexual abuse material, content inciting violence or hatred, or material that infringes someone else's rights.</li>
        <li>Attack the Service: probing, overloading, circumventing rate limits or quotas, reverse-engineering it beyond what the law permits, or trying to reach data that is not yours.</li>
        <li>Resell, sublicense or white-label the Service or the API, or use it to build a competing product out of our infrastructure.</li>
        <li>Use automation to create accounts en masse, or to scrape third-party sites through us at a scale that would get us blocked.</li>
        <li>Upload malware, or use the Service to phish or spam.</li>
      </ul>
      <p>
        Free-plan quotas and API rate limits are published in the app and on the
        developer page. Deliberately working around them counts as a breach of
        these terms.
      </p>
    </section>

    <section>
      <h2>6. Third-party content and sites</h2>
      <p>
        WebBites fetches pages you choose to save and shows you previews, extracted
        text and metadata from them. That content belongs to whoever published it,
        it is subject to their terms, and we neither endorse nor take
        responsibility for it. If a site blocks us, changes its markup or
        disappears, a preview may be incomplete or stop working — that is the web,
        not a defect in the Service.
      </p>
    </section>

    <section>
      <h2>7. Plans, payment and renewals</h2>
      <p>
        There is a free tier with limits, and paid plans with higher ones. Current
        plans, quotas and prices are shown in the app and on the pricing page;
        prices are in the currency displayed at checkout and include Spanish VAT
        (IVA) or the VAT of your country where applicable.
      </p>
      <ul>
        <li><strong>Renewal.</strong> Paid plans renew automatically at the end of each period — monthly or yearly, whichever you chose — until you cancel.</li>
        <li><strong>Cancelling.</strong> Cancel any time from Settings (or, for App Store purchases, in your Apple subscription settings). You keep the paid features until the end of the period you have already paid for, and you are not charged again.</li>
        <li><strong>Where you bought it is where you cancel it.</strong> Purchases made through the App Store are billed by Apple under Apple's terms, and refunds for them are handled by Apple. Purchases made on the web or Mac are billed through Stripe, and handled by us.</li>
        <li><strong>Price changes.</strong> We will tell you at least 30 days before a price change affects you, and you can cancel before it takes effect.</li>
        <li><strong>Failed payments.</strong> If a payment fails we may retry it and, if it keeps failing, move the account back to the free plan. Your content is not deleted for non-payment, but features above the free limits stop until you are current.</li>
      </ul>

      <h3>Your right of withdrawal</h3>
      <p>
        As a consumer in the EU you normally have 14 days to withdraw from a
        distance contract without giving a reason. Because the Service is digital
        content supplied immediately, by subscribing and starting to use the paid
        features you ask us to begin performance during that period and acknowledge
        that you lose the right of withdrawal once it has been fully performed
        (art. 103(m) of the Spanish consumer act, TRLGDCU). In practice we are
        friendlier than that rule: if you subscribed by mistake or never used the
        plan, write to us within 14 days and we will refund it.
      </p>
    </section>

    <section>
      <h2>8. Availability, changes and beta features</h2>
      <p>
        We work to keep WebBites available and fast, but we do not promise
        uninterrupted service. Maintenance, provider outages and bugs happen. We
        may add, change or remove features; if we remove something you depend on,
        or discontinue the Service entirely, we will give you reasonable notice and
        a way to export your data first.
      </p>
      <p>
        Features marked beta or experimental are exactly that: they may change,
        misbehave or vanish, and are provided without any warranty at all.
      </p>
    </section>

    <section>
      <h2>9. Your data is your responsibility too</h2>
      <p>
        We keep encrypted backups and take care of your library. That is not the
        same as an archival guarantee. Export a copy of anything you cannot afford
        to lose — the app will do it in a couple of clicks, at any time, in a
        portable format.
      </p>
    </section>

    <section>
      <h2>10. Suspension and termination</h2>
      <p>
        You can stop at any time: cancel your plan, or delete your account from
        Settings, which deletes your content as described in the Privacy Policy.
      </p>
      <p>
        We may suspend or close an account that breaches section 5, that is being
        used to harm the Service or other people, or where the law requires it.
        Except where the breach is serious or unlawful, we will warn you first and
        give you a chance to put it right, and we will let you export your data
        before closing the account.
      </p>
    </section>

    <section>
      <h2>11. Warranties and liability</h2>
      <p>
        The Service is provided as it is. Beyond the guarantees that consumer law
        gives you and that cannot be excluded, we make no warranty that it will be
        error-free, uninterrupted, or fit for a particular purpose.
      </p>
      <p>
        To the extent the law permits, our total liability to you for any claim
        arising out of or related to the Service is limited to the greater of the
        amount you paid us in the 12 months before the claim, or €50. We are not
        liable for indirect or consequential loss, lost profits, or lost data where
        the loss results from you not keeping your own copy.
      </p>
      <p>
        <strong>Nothing in these terms limits liability for death or personal
        injury caused by negligence, for fraud or fraudulent misrepresentation, or
        for anything else that cannot be limited under Spanish law. If you are a
        consumer, your statutory rights are unaffected by anything written
        here.</strong>
      </p>
    </section>

    <section>
      <h2>12. Changes to these terms</h2>
      <p>
        We may update these terms. For material changes we will give you notice in
        the app or by email at least 30 days before they take effect, and the date
        at the top will change. If you keep using the Service after that, the new
        terms apply; if you would rather not accept them, cancel and, where you
        have paid for a period you will not now use, we will refund the unused
        part.
      </p>
    </section>

    <section>
      <h2>13. Law and disputes</h2>
      <p>
        These terms are governed by Spanish law. If you are a consumer resident in
        the EU, you keep the protection of the mandatory rules of your own
        country's law, and you may bring proceedings in the courts of your place of
        residence; we will bring any claim against you there too. If you are not a
        consumer, the courts of Spain have exclusive jurisdiction.
      </p>
      <p>
        If something has gone wrong, email us first at
        <a :href="`mailto:${LEGAL.email}`">{{ LEGAL.email }}</a> — most things are
        a misunderstanding and take one message to fix. Consumers in Spain may also
        turn to the consumer arbitration system (Juntas Arbitrales de Consumo) or
        their regional consumer office.
      </p>
      <p>
        If any part of these terms turns out to be unenforceable, the rest stays in
        force.
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
