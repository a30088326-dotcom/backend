import { OllamaChatRequest, OllamaChatResponse } from './types';
import { getOllamaConfig } from './config';

export class OllamaClient {
  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const config = getOllamaConfig();
    if (!config.enabled) {
      throw new Error('Ollama is not enabled');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, stream: false }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data as OllamaChatResponse;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async isAvailable(): Promise<boolean> {
    const config = getOllamaConfig();
    if (!config.enabled) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // short timeout for health check
      const response = await fetch(`${config.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const ollamaClient = new OllamaClient();
