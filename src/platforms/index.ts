import { registerPlatformAdapter } from "../platform.js";
import { shopyyAdapter } from "./shopyy.js";

let registered = false;

export function registerBuiltInPlatforms() {
  if (registered) return;
  registerPlatformAdapter(shopyyAdapter);
  registered = true;
}
