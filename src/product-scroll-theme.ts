export type ProductScrollMode = "document-flow" | "bounded-gallery";

export type ProductScrollOverrides = Record<string, ProductScrollMode>;

export function applyProductScrollOverrides(section: string, overrides: ProductScrollOverrides = {}) {
  const entries = Object.entries(overrides);
  if (!entries.length) return section;
  const defaultMode = section.match(/data-s2s-scroll-mode="(document-flow|bounded-gallery)"/)?.[1];
  if (!defaultMode) throw new Error("A product scroll default is required before applying route overrides");
  for (const [handle, mode] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(handle) || !["document-flow", "bounded-gallery"].includes(mode))
      throw new Error(`Invalid product scroll override: ${handle}`);
  }
  const cases = entries.sort(([a], [b]) => a.localeCompare(b)).map(([handle, mode]) =>
    `when '${handle}'\nassign s2s_scroll_mode = '${mode}'`).join("\n");
  return `{% liquid\nassign s2s_scroll_mode = '${defaultMode}'\ncase product.handle\n${cases}\nendcase\n%}\n` + section
    .replace(`data-s2s-scroll-mode="${defaultMode}"`, 'data-s2s-scroll-mode="{{ s2s_scroll_mode }}"')
    .replace(' data-s2s-sticky-gallery', '');
}

export function productScrollStyles(namespace: "family" | "portrait") {
  const root = `.s2s-${namespace}-pdp`;
  const gallery = `.s2s-${namespace}-gallery`;
  const details = `.s2s-${namespace}-details`;
  return `${root}>${gallery},${root}>${details}{position:static;top:auto;align-self:start;min-width:0;max-width:100%}
@media(min-width:992px){${root}[data-s2s-scroll-mode="bounded-gallery"]>${gallery}{position:sticky;top:20px}}
@media(max-width:991px){${root}{grid-template-columns:minmax(0,1fr)}${root}>${gallery},${root}>${details}{width:100%}}`;
}
