# Quote provider branding

The intake header accepts `?provider=<site-slug>`, for example
`/signup?provider=montgomery-risk`. The shared `IntakeProviderBrand` resolves the
slug against `config/quote-providers.json`, shows the provider's published artwork
and name, and places a smaller Powered by Spot mark beneath it. Missing, unknown,
and inherited-object keys retain normal Spot branding. Query parameters cannot
supply a logo URL, redirect destination or markup.

The provider is presentation metadata only. It grants no access, changes no tenant
or application ownership, and is not a broker assignment. Existing intake ownership,
authentication, contact capture and submission logic are unchanged. Signup-to-intake,
review edits, verification URL cleanup and tracking edits carry the recognized slug
in their query parameters. Direct visits without the parameter retain Spot branding.

Brand facts are exported from the broker network's ledger and published-image
manifest, rather than independently chosen in Spot. To refresh the public registry:

```sh
# In the broker-network checkout, substituting the local Spot checkout path:
node scripts/export-quote-providers.mjs > /path/to/spot/config/quote-providers.json
```

Montgomery's ledger quote destination is
`https://app.spot.insure/signup?provider=montgomery-risk`. Deploy the Spot change
before expecting that production URL to render the new header. Deploying the broker
site alone does not change the Spot app.
