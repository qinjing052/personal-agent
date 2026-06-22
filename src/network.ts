import { ProxyAgent, setGlobalDispatcher } from "undici";
import { config } from "./config.js";

/**
 * 配置 Node 全局网络代理。
 *
 * 浏览器能访问 OpenAI 不代表终端也能访问；这里让 fetch/OpenAI SDK/Tavily
 * 都可以走 `.env` 中的 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`。
 */
export function configureNetwork() {
  if (!config.proxyUrl) {
    return;
  }

  setGlobalDispatcher(new ProxyAgent(config.proxyUrl));
}
