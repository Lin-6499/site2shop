export function localPreviewUrlForTarget(
  localOrigin: string,
  targetUrl: string,
  previewUrls: Record<string, string> = {},
) {
  const target = new URL(targetUrl);
  const local = new URL(target.pathname, localOrigin);
  const match = target.pathname.match(/^\/products\/([^/]+)\/?$/);
  if (!match) return local.href;

  const handle = decodeURIComponent(match[1]);
  const storedPreview = previewUrls[handle];
  if (!storedPreview) return local.href;

  const previewKey = new URL(storedPreview).searchParams.get("preview_key");
  if (previewKey) local.searchParams.set("preview_key", previewKey);
  return local.href;
}
