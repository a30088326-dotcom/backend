import { Context } from './types';
import { understand } from './intent';
import { invoke } from './runtime';
import { getOllamaConfig } from './ollama/config';
import { ollamaClient } from './ollama/client';
import { planAndRespond } from './ollama/agent-loop';
import { tools } from './tools';

export async function routeMessage(c: Context, conversationId: string, message: string, requestId: string, selectedEmployeeId?: string) {
  const config = getOllamaConfig();
  const deterministicIntent = understand(message, selectedEmployeeId);

  // Prefer the optional local planner and retain deterministic routing as fallback.
  let useOllama = config.enabled;
  if (useOllama) {
    useOllama = await ollamaClient.isAvailable();
  }

  if (useOllama) {
    try {
      return await planAndRespond(c, conversationId, requestId);
    } catch (e: any) {
      console.error('Ollama Planner Error:', e);
    }
  }

  if (!deterministicIntent) {
    return { 
      kind: 'result', 
      conversationId, 
      result: { message: 'I need a little more detail. Do you want to apply for leave, mark attendance, check a balance, or another HR task? Type "What can you do?" for commands available to your account. Nothing has been changed.' } 
    };
  }

  const reply = await invoke(c, deterministicIntent.tool, deterministicIntent.args, requestId, conversationId);
  const matched = tools.find(tool => tool.id === deterministicIntent.tool);
  return { ...reply, interpretedAs: deterministicIntent.interpretedAs || matched?.label, spellingAdjusted: Boolean(deterministicIntent.corrected) };
}
