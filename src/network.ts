import { ProxyAgent, setGlobalDispatcher } from "undici";
import { config } from "./config.js";

export function configureNetwork() {
  if (!config.proxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(config.proxyUrl));
}
