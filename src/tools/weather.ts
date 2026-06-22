import { tool } from "@langchain/core/tools";
import { z } from "zod";

type GeocodingResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
    timezone?: string;
  }>;
};

type ForecastResponse = {
  timezone?: string;
  current?: Record<string, number | string>;
  current_units?: Record<string, string>;
  daily?: Record<string, Array<number | string | null>>;
  daily_units?: Record<string, string>;
};

const weatherCodeText: Record<number, string> = {
  0: "晴朗",
  1: "大部晴朗",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "中等毛毛雨",
  55: "大毛毛雨",
  56: "冻毛毛雨",
  57: "强冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "小阵雨",
  81: "中等阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴强冰雹",
};

function codeToText(code: unknown) {
  return typeof code === "number" ? weatherCodeText[code] ?? `天气代码 ${code}` : "未知";
}

function compactLocation(inputText: string) {
  return inputText
    .replace(/^\/weather\s*/i, "")
    .replace(/^(请|帮我|麻烦)?(搜索一下|搜索|搜一下|查一下|查询|看一下)?/i, "")
    .replace(/(今天|明天|后天|现在|实时|未来三天|未来3天|最近|当地)/g, "")
    .replace(/(天气预报|天气|气温|温度|降雨|下雨|会不会下雨|会下雨吗|多少度|几度|怎么样|如何|weather|tianqi)/gi, "")
    .replace(/[，,。?？!！\s]+/g, "")
    .trim();
}

/**
 * 从自然语言里识别天气意图并提取城市；返回 undefined 表示不是天气问题。
 */
export function extractWeatherLocation(inputText: string): string | undefined {
  if (/^\/weather(?:\s+.*)?$/i.test(inputText)) {
    return compactLocation(inputText);
  }

  if (!/天气|气温|温度|降雨|下雨|weather|tianqi/i.test(inputText)) {
    return undefined;
  }

  return compactLocation(inputText);
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`);
  }

  return await response.json() as T;
}

export async function getWeather(locationName: string) {
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", locationName);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "zh");
  geocodingUrl.searchParams.set("format", "json");

  const geocoding = await fetchJson<GeocodingResponse>(geocodingUrl);
  const location = geocoding.results?.[0];

  if (!location) {
    return `没有找到地点“${locationName}”。请换一个更明确的城市名，例如“杭州”或“上海浦东”。`;
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(location.latitude));
  forecastUrl.searchParams.set("longitude", String(location.longitude));
  forecastUrl.searchParams.set("current", [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "rain",
    "weather_code",
    "wind_speed_10m",
  ].join(","));
  forecastUrl.searchParams.set("daily", [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
  ].join(","));
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "3");

  const forecast = await fetchJson<ForecastResponse>(forecastUrl);
  const current = forecast.current ?? {};
  const currentUnits = forecast.current_units ?? {};
  const daily = forecast.daily ?? {};
  const dailyUnits = forecast.daily_units ?? {};

  return JSON.stringify({
    source: "Open-Meteo",
    location: {
      name: location.name,
      admin1: location.admin1,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: forecast.timezone ?? location.timezone,
    },
    current: {
      time: current.time,
      weather: codeToText(current.weather_code),
      temperature: `${current.temperature_2m}${currentUnits.temperature_2m ?? ""}`,
      apparentTemperature: `${current.apparent_temperature}${currentUnits.apparent_temperature ?? ""}`,
      humidity: `${current.relative_humidity_2m}${currentUnits.relative_humidity_2m ?? ""}`,
      precipitation: `${current.precipitation}${currentUnits.precipitation ?? ""}`,
      rain: `${current.rain}${currentUnits.rain ?? ""}`,
      windSpeed: `${current.wind_speed_10m}${currentUnits.wind_speed_10m ?? ""}`,
    },
    daily: (daily.time ?? []).map((time, index) => ({
      date: time,
      weather: codeToText(daily.weather_code?.[index]),
      temperatureMax: `${daily.temperature_2m_max?.[index]}${dailyUnits.temperature_2m_max ?? ""}`,
      temperatureMin: `${daily.temperature_2m_min?.[index]}${dailyUnits.temperature_2m_min ?? ""}`,
      precipitationProbabilityMax: `${daily.precipitation_probability_max?.[index]}${dailyUnits.precipitation_probability_max ?? ""}`,
    })),
  }, null, 2);
}

export const weatherSearch = tool(
  async ({ location }) => {
    return await getWeather(location);
  },
  {
    name: "weather_search",
    description: "查询城市当前天气和未来 3 天预报，适合回答天气、气温、降雨、是否下雨等问题。",
    schema: z.object({
      location: z.string().describe("要查询的城市或地点，例如：杭州、上海浦东、北京"),
    }),
  },
);
