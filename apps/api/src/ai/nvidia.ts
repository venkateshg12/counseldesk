import { NVIDIA_EMBEDDING_API_KEY } from "../constants/env.js";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const nvidiaFetch = async <T>(
  endpoint: string,
  body: unknown,
  apiKey: string = NVIDIA_EMBEDDING_API_KEY,
): Promise<T> => {
  const url = `${NVIDIA_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `NVIDIA API error (${response.status} ${response.statusText}): ${errorText}`,
    );
  }

  return (await response.json()) as T;
};
