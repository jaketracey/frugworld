# Replan Service Refactor Plan

## Goal
Refactor `replan.ts` to use the provider registry instead of direct OpenAI client.

## File to Modify
`/Users/jake/Projects/frugworld/ai-service/src/replan.ts`

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
  options?: ReplanServiceOptions
): ReplanService
```

### 5. Add Initialize Method
```typescript
async initialize(): Promise<void> {
  if (this.useProviderRegistry && this.registry && !this.llmProvider) {
    const { ProviderRegistry } = await import('./providers/registry.js');
    this.llmProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getLLMProvider('replan');
  }
}
```

### 6. Update replan/evaluateReplan Methods
Replace OpenAI calls with provider abstraction.

## Validation
- Backwards compatibility maintained
- Rate limiting (cooldown) still works
- Run `npx tsc --noEmit` to verify
