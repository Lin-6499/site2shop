import type { Page, Response } from "playwright";

export type RenderedEvidenceIdentity = {
  status?: number | null;
  url?: string;
  title?: string;
  visibleText?: string;
  html?: string;
  cfMitigated?:string|null;
  challengeUiVisible?:boolean;
};

function normalizedPath(url: URL) {
  const path = url.pathname.replace(/\/+$/, "");
  return path || "/";
}

export function routeIdentityRejection(expectedUrl: string, finalUrl: string, canonicalUrl?: string | null) {
  const expected = new URL(expectedUrl);
  const final = new URL(finalUrl);
  if (expected.origin !== final.origin || normalizedPath(expected) !== normalizedPath(final))
    return `unexpected final route ${final.origin}${normalizedPath(final)}; expected ${expected.origin}${normalizedPath(expected)}`;
  if (canonicalUrl) {
    const canonical = new URL(canonicalUrl, final);
    if (expected.origin !== canonical.origin || normalizedPath(expected) !== normalizedPath(canonical))
      return `unexpected canonical route ${canonical.origin}${normalizedPath(canonical)}; expected ${expected.origin}${normalizedPath(expected)}`;
  }
  return null;
}

export function renderedEvidenceRejection(input: RenderedEvidenceIdentity) {
  if (input.status != null && (input.status < 200 || input.status >= 400))
    return `HTTP ${input.status}`;
  const title = input.title || "";
  const text = input.visibleText || "";
  const html = input.html || "";
  const url = input.url || "";
  if (
    /just a moment|verifying(?: you are human)?|attention required|access denied/i.test(title) ||
    input.cfMitigated?.toLowerCase()==='challenge' || input.challengeUiVisible===true ||
    /enable javascript and cookies to continue|performing security verification|checking (?:your browser|if the site connection is secure)|verify you are human|you are being rate limited|error\s*1015/i.test(text)
  ) return "anti-bot challenge page";
  if(/^404\s*[-–:]?\s*(?:(?:Spanish|Portuguese)\s+)?page\s*not\s*found(?:\s*\||$)/i.test(title.trim()))return 'soft 404 page';
  if (
    /\/password(?:[/?#]|$)/i.test(url) ||
    /^please log in$/i.test(title.trim()) ||
    /will be opening soon|enter store using password/i.test(text) ||
    /<form[^>]+(?:action=["'][^"']*\/password|id=["']storefront-password)/i.test(html)
  ) return "storefront password page";
  return null;
}

export async function assertRenderedEvidencePage(
  page: Page,
  response: Response | null,
  role: "source" | "target",
) {
  if (!response)
    throw new Error(`${role.toUpperCase()}_EVIDENCE_INVALID: no navigation response (${page.url()})`);
  const identity: RenderedEvidenceIdentity = {
    status: response?.status() ?? null,
    cfMitigated:response.headers()['cf-mitigated']||null,
    // Cloudflare JS Detections scripts can occur on a successfully rendered store.
    // Only an actually visible challenge control is evidence of an interstitial.
    challengeUiVisible:await page.locator('#challenge-running,#challenge-stage,#challenge-form,[id^="cf-chl-widget"],iframe[src*="/cdn-cgi/challenge-platform/"]').evaluateAll(nodes=>nodes.some(node=>{const r=node.getBoundingClientRect();if(!r.width||!r.height)return false;for(let p:Element|null=node;p;p=p.parentElement){const css=getComputedStyle(p);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}return true;})),
    url: page.url(),
    title: await page.title(),
    visibleText: await page.locator("body").innerText().catch(() => ""),
    html: await page.content().catch(() => ""),
  };
  const rejection = renderedEvidenceRejection(identity);
  if (rejection)
    throw new Error(`${role.toUpperCase()}_EVIDENCE_INVALID: ${rejection} (${identity.status ?? "no response"} ${identity.title || identity.url})`);
  return identity;
}

export async function assertRenderedEvidenceRoute(
  page: Page,
  expectedUrl: string,
  role: "source" | "target",
) {
  const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href").catch(() => null);
  const rejection = routeIdentityRejection(expectedUrl, page.url(), canonical);
  if (rejection)
    throw new Error(`${role.toUpperCase()}_EVIDENCE_INVALID: ${rejection}`);
}
