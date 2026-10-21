import type { WebsiteTechSignal } from "./websiteTech";

export type WebsiteTechScanInput = {
  html: string;
  headers: Record<string, string>;
  // Hostnames a real browser contacted while the agent explored the site.
  requestHosts: string[];
  cnames: string[];
  ptr: string[];
  mx: string[];
  txt: string[];
  ns: string[];
};

type Signature = {
  name: string;
  category: string;
  html?: RegExp;
  headers?: Array<[name: string, value?: RegExp]>;
  cname?: RegExp;
  ptr?: RegExp;
  mx?: RegExp;
  txt?: RegExp;
  ns?: RegExp;
};

// Public, deterministic fingerprints. A match is evidence of use on the website or domain,
// not proof of where application data lives; disclosures cover that separately.
const SIGNATURES: Signature[] = [
  // Payments
  { name: "Stripe", category: "payments", html: /js\.stripe\.com|(?:checkout|buy|billing|api)\.stripe\.com|m\.stripe\.network/i, txt: /^stripe-verification=/i },
  { name: "PayPal", category: "payments", html: /paypal\.com\/sdk\/js|paypalobjects\.com/i },
  { name: "Braintree", category: "payments", html: /js\.braintreegateway\.com|braintree-api\.com/i },
  { name: "Adyen", category: "payments", html: /checkoutshopper-[a-z]+\.adyen\.com/i },
  { name: "Square", category: "payments", html: /(?:js\.squareup|web\.squarecdn)\.com/i },
  { name: "Paddle", category: "payments", html: /cdn\.paddle\.com/i },
  { name: "Chargebee", category: "payments", html: /js\.chargebee\.com/i },
  { name: "Recurly", category: "payments", html: /js\.recurly\.com/i },
  { name: "Lemon Squeezy", category: "payments", html: /(?:assets|app)\.lemonsqueezy\.com/i },
  { name: "Authorize.net", category: "payments", html: /(?:js|accept)\.authorize\.net/i },
  { name: "Checkout.com", category: "payments", html: /cdn\.checkout\.com/i },

  // Hosting, CDN and cloud
  { name: "Cloudflare", category: "cdn", headers: [["cf-ray"], ["server", /cloudflare/i]], ns: /\.ns\.cloudflare\.com$/i },
  { name: "Vercel", category: "hosting", headers: [["x-vercel-id"], ["server", /^vercel$/i]], cname: /vercel-dns\.com$/i },
  { name: "Netlify", category: "hosting", headers: [["x-nf-request-id"], ["server", /netlify/i]], cname: /netlify\.app$/i },
  { name: "Amazon CloudFront", category: "cdn", headers: [["x-amz-cf-id"], ["via", /cloudfront/i]], cname: /cloudfront\.net$/i, ptr: /\.cloudfront\.net$/i },
  { name: "Amazon Web Services", category: "cloud", headers: [["server", /^(?:AmazonS3|awselb)/i], ["x-amz-request-id"]], cname: /\.amazonaws\.com$/i, ptr: /\.amazonaws\.com$/i, ns: /awsdns/i },
  { name: "Google Cloud", category: "cloud", headers: [["server", /^Google Frontend$/i], ["via", /1\.1 google/i]], cname: /ghs\.googlehosted\.com$|\.run\.app$|\.appspot\.com$/i, ptr: /googleusercontent\.com$/i },
  { name: "Microsoft Azure", category: "cloud", headers: [["x-azure-ref"], ["x-ms-request-id"]], cname: /azurewebsites\.net$|azureedge\.net$|azurefd\.net$|trafficmanager\.net$|cloudapp\.azure\.com$/i, ns: /azure-dns/i },
  { name: "Fastly", category: "cdn", headers: [["x-fastly-request-id"], ["x-served-by", /^cache-/i]], cname: /fastly\.net$|fastlylb\.net$/i },
  { name: "Akamai", category: "cdn", headers: [["server", /AkamaiGHost|AkamaiNetStorage/i], ["x-akamai-transformed"]], cname: /edgekey\.net$|edgesuite\.net$|akamaiedge\.net$/i },
  { name: "Heroku", category: "hosting", headers: [["via", /vegur/i]], cname: /herokudns\.com$|herokuapp\.com$/i },
  { name: "Fly.io", category: "hosting", headers: [["fly-request-id"], ["server", /^Fly\//i]] },
  { name: "Render", category: "hosting", headers: [["x-render-origin-server"], ["rndr-id"]], cname: /onrender\.com$/i },
  { name: "Railway", category: "hosting", headers: [["server", /railway/i]], cname: /up\.railway\.app$/i },
  { name: "GitHub Pages", category: "hosting", headers: [["server", /^GitHub\.com$/i]], cname: /github\.io$/i },
  { name: "WP Engine", category: "hosting", headers: [["x-powered-by", /WP Engine/i]], cname: /wpengine\.com$/i },
  { name: "Kinsta", category: "hosting", headers: [["x-kinsta-cache"]] },
  { name: "DigitalOcean", category: "cloud", ns: /digitalocean\.com$/i, cname: /ondigitalocean\.app$/i },

  // Website platforms and frameworks
  { name: "Webflow", category: "website", html: /data-wf-site=|assets\.website-files\.com|cdn\.prod\.website-files\.com/i },
  { name: "Framer", category: "website", html: /framerusercontent\.com/i, headers: [["server", /^Framer/i]] },
  { name: "WordPress", category: "website", html: /\/wp-content\/|\/wp-includes\//i },
  { name: "Squarespace", category: "website", html: /static1\.squarespace\.com/i },
  { name: "Wix", category: "website", html: /static\.wixstatic\.com/i, headers: [["x-wix-request-id"]] },
  { name: "HubSpot CMS", category: "website", headers: [["x-hs-cache-config"], ["x-hs-hub-id"]] },
  { name: "Shopify", category: "ecommerce", html: /cdn\.shopify\.com/i, headers: [["x-shopid"]] },
  { name: "Next.js", category: "framework", html: /\/_next\/static\//i, headers: [["x-powered-by", /Next\.js/i]] },
  { name: "Nuxt", category: "framework", html: /\/_nuxt\//i },
  { name: "Gatsby", category: "framework", html: /id="___gatsby"/i },

  // Email and workspace
  { name: "Google Workspace", category: "email", mx: /(?:aspmx\.l\.google|googlemail)\.com$/i, txt: /include:_spf\.google\.com/i },
  { name: "Microsoft 365", category: "email", mx: /mail\.protection\.outlook\.com$/i, txt: /include:spf\.protection\.outlook\.com|^MS=ms\d+/i },
  { name: "Proofpoint", category: "email", mx: /pphosted\.com$/i },
  { name: "Mimecast", category: "email", mx: /mimecast\.com$/i },
  { name: "Zoho Mail", category: "email", mx: /zoho\.(?:com|eu)$/i },
  { name: "SendGrid", category: "email", txt: /include:sendgrid\.net/i },
  { name: "Mailgun", category: "email", txt: /include:mailgun\.org/i },
  { name: "Amazon SES", category: "email", txt: /include:amazonses\.com/i },
  { name: "Postmark", category: "email", txt: /include:spf\.mtasv\.net/i },
  { name: "Mailchimp", category: "marketing", txt: /include:servers\.mcsv\.net/i },

  // Business SaaS evidenced by DNS verification records or embedded scripts
  { name: "Salesforce", category: "crm", txt: /include:_spf\.salesforce\.com/i, html: /pi\.pardot\.com/i },
  { name: "HubSpot", category: "crm", html: /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net/i, txt: /hubspotemail\.net/i },
  { name: "Marketo", category: "marketing", html: /munchkin\.marketo\.net/i },
  { name: "Atlassian", category: "saas", txt: /^atlassian-domain-verification=/i },
  { name: "DocuSign", category: "saas", txt: /^docusign=/i },
  { name: "Zoom", category: "saas", txt: /^ZOOM_verify_/i },
  { name: "Slack", category: "saas", txt: /^slack-domain-verification=/i },
  { name: "OpenAI", category: "saas", txt: /^openai-domain-verification=/i },
  { name: "Zendesk", category: "support", html: /static\.zdassets\.com/i, txt: /include:mail\.zendesk\.com/i },
  { name: "Intercom", category: "support", html: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { name: "Drift", category: "support", html: /js\.driftt\.com/i },

  // Analytics, monitoring and identity
  { name: "Google Analytics", category: "analytics", html: /googletagmanager\.com\/gtag|google-analytics\.com/i },
  { name: "Google Tag Manager", category: "analytics", html: /googletagmanager\.com\/gtm\.js/i },
  { name: "Segment", category: "analytics", html: /cdn\.segment\.com/i },
  { name: "PostHog", category: "analytics", html: /posthog\.com|posthog-js/i },
  { name: "Mixpanel", category: "analytics", html: /cdn\.mxpnl\.com|mixpanel\.com\/libs/i },
  { name: "Amplitude", category: "analytics", html: /cdn\.amplitude\.com/i },
  { name: "Hotjar", category: "analytics", html: /static\.hotjar\.com/i },
  { name: "Sentry", category: "monitoring", html: /browser\.sentry-cdn\.com|ingest\.sentry\.io/i },
  { name: "Datadog", category: "monitoring", html: /datadoghq-browser-agent|browser-intake-datadoghq/i },
  { name: "Auth0", category: "identity", html: /cdn\.auth0\.com|\.auth0\.com\/authorize/i },
  { name: "Okta", category: "identity", html: /\.okta\.com\/(?:oauth2|api)/i },
  { name: "Clerk", category: "identity", html: /clerk\.[a-z.]+\/npm\/@clerk|clerk\.accounts\.dev/i },
  { name: "Firebase", category: "cloud", html: /firebaseapp\.com|gstatic\.com\/firebasejs/i },
  { name: "Supabase", category: "cloud", html: /\.supabase\.co\b/i },
];

const VERCEL_REGIONS: Record<string, string> = {
  iad1: "us-east-1", cle1: "us-east-2", sfo1: "us-west-1", pdx1: "us-west-2",
  yul1: "ca-central-1", gru1: "sa-east-1", dub1: "eu-west-1", lhr1: "eu-west-2",
  cdg1: "eu-west-3", fra1: "eu-central-1", arn1: "eu-north-1", hnd1: "ap-northeast-1",
  icn1: "ap-northeast-2", kix1: "ap-northeast-3", sin1: "ap-southeast-1",
  syd1: "ap-southeast-2", bom1: "ap-south-1", hkg1: "ap-east-1", cpt1: "af-south-1",
  dxb1: "me-central-1",
};

function clip(value: string) {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

/** Origin region where infrastructure names reveal one; edge PoPs are deliberately ignored. */
function infrastructureRegions(input: WebsiteTechScanInput): WebsiteTechSignal[] {
  const regions: WebsiteTechSignal[] = [];
  for (const host of [...input.ptr, ...input.cnames]) {
    const aws =
      /\.compute-1\.amazonaws\.com$/i.test(host)
        ? "us-east-1"
        : host.match(
            /\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.(?:compute|elb|s3-website|s3|elasticbeanstalk)\.amazonaws\.com$/i,
          )?.[1] ??
          host.match(/s3-website[.-]([a-z]{2}-[a-z]+-\d)\.amazonaws\.com$/i)?.[1];
    if (aws)
      regions.push({ category: "cloud", name: "Amazon Web Services", evidence: host, source: "dns", region: aws.toLowerCase() });
    const azure = host.match(/\.([a-z0-9]+)\.cloudapp\.azure\.com$/i)?.[1];
    if (azure)
      regions.push({ category: "cloud", name: "Microsoft Azure", evidence: host, source: "dns", region: azure.toLowerCase() });
  }
  // x-vercel-id is "<edge>::<function region>::<id>" when a function served the page.
  const vercel = input.headers["x-vercel-id"]?.split("::");
  const functionRegion = vercel && vercel.length >= 3 ? vercel[vercel.length - 2] : undefined;
  if (functionRegion && VERCEL_REGIONS[functionRegion])
    regions.push({
      category: "hosting",
      name: "Vercel",
      evidence: `x-vercel-id: ${input.headers["x-vercel-id"]}`,
      source: "headers",
      region: `${functionRegion} (AWS ${VERCEL_REGIONS[functionRegion]})`,
    });
  return regions;
}

export function detectWebsiteTech(input: WebsiteTechScanInput): WebsiteTechSignal[] {
  const signals: WebsiteTechSignal[] = [];
  const dnsRecords = (records: string[], pattern: RegExp | undefined, label: string) => {
    const record = pattern && records.find((value) => pattern.test(value));
    // TXT values can hold long tokens or full SPF records; keep only the matched part.
    return record
      ? `${label} ${label === "TXT" ? record.match(pattern)![0] : record}`
      : undefined;
  };
  for (const signature of SIGNATURES) {
    const htmlMatch = signature.html && input.html.match(signature.html)?.[0];
    const header = signature.headers?.find(([name, value]) => {
      const actual = input.headers[name];
      return actual !== undefined && (!value || value.test(actual));
    });
    const host = signature.html && input.requestHosts.find((value) => signature.html!.test(value));
    const evidence =
      (htmlMatch && { source: "html" as const, evidence: `page references ${htmlMatch}` }) ||
      (header && { source: "headers" as const, evidence: `${header[0]}: ${input.headers[header[0]]}` }) ||
      (host && { source: "browser" as const, evidence: `browser loaded ${host}` });
    const dnsEvidence =
      dnsRecords(input.cnames, signature.cname, "CNAME") ??
      dnsRecords(input.ptr, signature.ptr, "reverse DNS") ??
      dnsRecords(input.mx, signature.mx, "MX") ??
      dnsRecords(input.txt, signature.txt, "TXT") ??
      dnsRecords(input.ns, signature.ns, "NS");
    const match = evidence || (dnsEvidence && { source: "dns" as const, evidence: dnsEvidence });
    if (match)
      signals.push({ category: signature.category, name: signature.name, source: match.source, evidence: clip(match.evidence) });
  }
  for (const region of infrastructureRegions(input)) {
    const existing = signals.find((signal) => signal.name === region.name && !signal.region);
    if (existing) Object.assign(existing, { region: region.region, evidence: clip(region.evidence), source: region.source });
    else signals.push({ ...region, evidence: clip(region.evidence) });
  }
  return signals;
}
