export type PageKind = "home" | "product";
export type Issue = { code: string; message: string; url?: string };
export type Asset = {
  url: string;
  file: string;
  sha256: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  status: "ready" | "failed";
  error?: string;
};
export type CapturePage = {
  kind: PageKind;
  url: string;
  title: string;
  html: string;
  rawHtml: string;
  screenshots: Record<string, string>;
  links: string[];
  animations: unknown[];
  styles: string[];
  scripts: string[];
  states: unknown[];
};
export type SiteIR = {
  schemaVersion: 1;
  sourceUrl: string;
  capturedAt: string;
  engine: string;
  viewports: number[];
  pages: CapturePage[];
  assets: Asset[];
  product: any | null;
  issues: Issue[];
  status: {
    generated: boolean;
    localVerified: boolean;
    shopifyVerified: boolean;
    commerceVerified: boolean;
  };
};
export const REQUIRED_VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

export type RequiredViewportName = (typeof REQUIRED_VIEWPORTS)[number]["name"];
export const WIDTHS = REQUIRED_VIEWPORTS.map(({ width }) => width);
