export type PlatformId = "shopify" | "shopyy";

export type PlatformCapability = {
  id: string;
  status: "supported" | "requires-target-validation" | "unsupported";
  note?: string;
};

export type PlatformBuildRequest = {
  projectFile: string;
  outputDirectory?: string;
  prototype?: boolean;
};

export type PlatformBuildResult = {
  platform: PlatformId;
  buildId: string;
  outputDirectory: string;
  packageFile: string;
  manifestFile: string;
  files: string[];
  capabilities: PlatformCapability[];
};

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly version: string;
  build(request: PlatformBuildRequest): Promise<PlatformBuildResult>;
}

const adapters = new Map<PlatformId, PlatformAdapter>();

export function registerPlatformAdapter(adapter: PlatformAdapter) {
  if (adapters.has(adapter.id)) throw new Error(`Platform adapter already registered: ${adapter.id}`);
  adapters.set(adapter.id, adapter);
}

export function getPlatformAdapter(id: PlatformId) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Platform adapter is not registered: ${id}`);
  return adapter;
}

export function listPlatformAdapters() {
  return [...adapters.values()].map(({ id, version }) => ({ id, version }));
}

export async function buildPlatform(id: PlatformId, request: PlatformBuildRequest) {
  return getPlatformAdapter(id).build(request);
}
