import "dotenv/config";
import { config, usesCustomOpenAiBaseUrl } from "./config.js";
import { configureNetwork } from "./network.js";

configureNetwork();

const baseUrl = config.openAiBaseUrl ?? "https://api.openai.com/v1";
const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;

function mask(value: string | undefined) {
  if (!value) {
    return "(unset)";
  }

  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

function preview(text: string) {
  return text
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

async function main() {
  console.log("Personal Agent TS doctor\n");
  console.log(`OPENAI_API_KEY: ${mask(config.openAiApiKey)}`);
  console.log(`OPENAI_MODEL: ${config.model}`);
  console.log(`OPENAI_BASE_URL: ${config.openAiBaseUrl ?? "(default)"}`);
  console.log(`ALLOW_CUSTOM_OPENAI_BASE_URL: ${config.allowCustomOpenAiBaseUrl}`);
  console.log(`OPENAI_TIMEOUT_MS: ${config.openAiTimeoutMs}`);
  console.log(`PROXY: ${config.proxyUrl ?? "(unset)"}`);

  if (!config.openAiApiKey || config.openAiApiKey === "replace_me") {
    console.log("\n[FAIL] OPENAI_API_KEY is missing.");
    return;
  }

  if (usesCustomOpenAiBaseUrl() && !config.allowCustomOpenAiBaseUrl) {
    console.log("\n[FAIL] OPENAI_BASE_URL points to a non-OpenAI domain.");
    console.log("The doctor will not send your API key to a custom gateway unless you explicitly allow it.");
    console.log("Set ALLOW_CUSTOM_OPENAI_BASE_URL=true only if you trust that gateway with your API key.");
    if (!config.openAiBaseUrl?.replace(/\/$/, "").endsWith("/v1")) {
      console.log(`Also note: OpenAI-compatible base URLs usually end with /v1. Try ${config.openAiBaseUrl?.replace(/\/$/, "")}/v1`);
    }
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.openAiTimeoutMs);

  try {
    const response = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "(unknown)";
    let body: {
      data?: Array<{ id: string }>;
      error?: { message?: string };
    } | undefined;

    try {
      body = JSON.parse(text) as {
        data?: Array<{ id: string }>;
        error?: { message?: string };
      };
    } catch {
      console.log(`\n[FAIL] ${modelsUrl} did not return JSON.`);
      console.log(`HTTP ${response.status} ${response.statusText}`);
      console.log(`Content-Type: ${contentType}`);
      console.log(`Body preview: ${preview(text)}`);

      if (config.openAiBaseUrl && !config.openAiBaseUrl.replace(/\/$/, "").endsWith("/v1")) {
        console.log("\nHint: OpenAI-compatible base URLs usually end with /v1.");
        console.log(`Try: OPENAI_BASE_URL=${config.openAiBaseUrl.replace(/\/$/, "")}/v1`);
      }
      return;
    }

    if (!response.ok) {
      console.log(`\n[FAIL] OpenAI API returned HTTP ${response.status}.`);
      console.log(body?.error?.message ?? text.slice(0, 500));
      return;
    }

    const modelIds = body?.data?.map((item) => item.id) ?? [];
    const selectedModelExists = modelIds.includes(config.model);

    console.log(`\n[OK] Connected to ${modelsUrl}`);
    console.log(`[${selectedModelExists ? "OK" : "WARN"}] Selected model ${config.model} ${selectedModelExists ? "is available." : "was not found in /v1/models."}`);
    console.log("\nSample models:");
    console.log(modelIds.filter((id) => id.includes("gpt") || id.startsWith("o")).slice(0, 20).join("\n"));
  } catch (error) {
    const err = error as Error & {
      cause?: {
        code?: string;
        message?: string;
      };
    };

    console.log("\n[FAIL] Could not connect to OpenAI API.");
    console.log(`Error: ${err.message}`);
    if (err.cause?.code || err.cause?.message) {
      console.log(`Cause: ${err.cause.code ?? ""} ${err.cause.message ?? ""}`.trim());
    }
    console.log("\nTry setting HTTPS_PROXY/HTTP_PROXY in your shell, or set OPENAI_BASE_URL if you use an OpenAI-compatible gateway.");
  } finally {
    clearTimeout(timer);
  }
}

await main();
