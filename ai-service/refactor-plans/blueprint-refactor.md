# Blueprint Service Refactor Plan

## Goal
Refactor `blueprint.ts` to use the provider registry instead of direct OpenAI client.

## File to Modify
`/Users/jake/Projects/frugworld/ai-service/src/blueprint.ts`

## Reference Implementation
See `dialogue.ts` for the pattern - it already supports both legacy and provider-based approaches.

## Changes Required

### 1. Add Imports
```typescript
import type { LLMProvider } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';
```

### 2. Update Class Properties
Replace:
```typescript
private client: OpenAI;
```
With:
```typescript
private client: OpenAI | null = null;
private llmProvider: LLMProvider | null = null;
private registry: ProviderRegistry | null = null;
private useProviderRegistry: boolean;
```

### 3. Update Constructor
- Add `useProviderRegistry` option to constructor options
- Only initialize OpenAI client if not using provider registry
- Store registry reference if provided

### 4. Add Static Factory Method
```typescript
static withRegistry(
  registry: ProviderRegistry,
  costController: CostController,
  options?: BlueprintGeneratorOptions
): BlueprintGenerator
```

### 5. Add Initialize Method
```typescript
async initialize(): Promise<void> {
  if (this.useProviderRegistry && this.registry && !this.llmProvider) {
    const { ProviderRegistry } = await import('./providers/registry.js');
    this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('blueprint');
  }
}
```

### 6. Update generateBlueprint Method
Replace the OpenAI call with provider-based approach:
```typescript
if (this.useProviderRegistry && this.llmProvider) {
  const response = await this.llmProvider.complete({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: this.maxTokensPerResponse,
    responseFormat: 'json',
  });
  textContent = response.content;
  inputTokens = response.usage.inputTokens;
  outputTokens = response.usage.outputTokens;
} else if (this.client) {
  // Legacy OpenAI approach
  const response = await this.client.chat.completions.create({...});
  // ... existing code
} else {
  throw new AIServiceError('No LLM provider available', 'PROVIDER_NOT_AVAILABLE');
}
```

## Validation
- Ensure backwards compatibility (existing code using AIServiceConfig still works)
- Ensure Zod validation continues to work
- Run `npx tsc --noEmit` to check for type errors
