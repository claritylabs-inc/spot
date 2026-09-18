export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain");
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) {
    return new Response(null, { status: 400 });
  }

  const upstream = new URL("https://t2.gstatic.com/faviconV2");
  upstream.search = new URLSearchParams({
    client: "SOCIAL",
    type: "FAVICON",
    fallback_opts: "TYPE,SIZE,URL",
    url: `https://${domain}`,
    size: "128",
  }).toString();

  try {
    const response = await fetch(upstream, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    // Google returns a decodable generic globe even with a 404 status.
    if (!response.ok || response.headers.get("content-type") !== "image/png") {
      await response.body?.cancel();
      return new Response(null, { status: 404 });
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
