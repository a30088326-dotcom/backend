import type { Tool } from '../types';
import type { OllamaTool } from './types';
import { tools } from '../tools';
import { allowed } from '../policy';
import { Context } from '../types';

export function getPermittedTools(c: Context, config: any): Tool[] {
  return tools.filter(t => allowed(c, t, config));
}

function mapZodToJSONSchema(schema: any): any {
  // A simplistic mapping, enough for Ollama schema structure
  if (!schema) return { type: 'object', properties: {} };
  
  const properties: Record<string, any> = {};
  const required: string[] = [];

  const def = schema._def;
  if (def.typeName === 'ZodObject' && def.shape()) {
    const shape = def.shape();
    for (const [key, value] of Object.entries(shape)) {
      const v = value as any;
      let typeName = v._def.typeName;
      let isOptional = false;
      
      if (typeName === 'ZodOptional') {
        isOptional = true;
        typeName = v._def.innerType._def.typeName;
      }
      
      if (!isOptional) {
        required.push(key);
      }
      
      if (typeName === 'ZodString') {
        properties[key] = { type: 'string' };
      } else if (typeName === 'ZodNumber') {
        properties[key] = { type: 'number' };
      } else if (typeName === 'ZodBoolean') {
        properties[key] = { type: 'boolean' };
      } else {
        properties[key] = { type: 'string' }; // fallback
      }
    }
  }

  return { type: 'object', properties, required };
}

export function convertToOllamaTool(tool: Tool): OllamaTool {
  const schema = mapZodToJSONSchema(tool.schema);
  return {
    type: 'function',
    function: {
      name: tool.id.replace(/\./g, '_'),
      description: tool.label || `Perform action ${tool.id}`,
      parameters: schema,
    },
  };
}

export function convertOllamaToolCallToIntent(name: string, args: Record<string, unknown>) {
  const toolId = name.replace(/_/g, '.');
  return { tool: toolId, args };
}
