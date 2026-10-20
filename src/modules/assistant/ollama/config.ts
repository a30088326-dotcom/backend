export interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxIterations: number;
}

export function getOllamaConfig(): OllamaConfig {
  return {
    enabled: process.env.OLLAMA_ENABLED === 'true',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.1',
    timeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS || '30000', 10),
    maxIterations: parseInt(process.env.OLLAMA_MAX_ITERATIONS || '5', 10),
  };
}
