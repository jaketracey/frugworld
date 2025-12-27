# Memory Service Refactor Plan

## Goal
Refactor `memory.ts` to use the provider registry instead of direct OpenAI client.

## File to Modify
`/Users/jake/Projects/frugworld/ai-service/src/memory.ts`

## Reference Implementation
See `dialogue.ts` for the pattern.

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
- Add `useProviderRegistry` option
- Only initialize OpenAI client if not using provider registry

### 4. Add Static Factory Method
```typescript
static withRegistry(
  registry: ProviderRegistry,
  costController: CostController,
  options?: MemorySummarizerOptions
): MemorySummarizer
```

### 5. Add Initialize Method
```typescript
async initialize(): Promise<void> {
  if (this.useProviderRegistry && this.registry && !this.llmProvider) {
    const { ProviderRegistry } = await import('./providers/registry.js');
    this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('summary');
  }
}
```

### 6. Update summarizeMemory Method
Replace OpenAI call with provider abstraction, similar to dialogue.ts pattern.

## Validation
- Backwards compatibility maintained
- Run `npx tsc --noEmit` to verify
