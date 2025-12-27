# Portrait Service Refactor Plan

## Goal
Refactor `portrait.ts` to use the provider registry for both LLM (backstory) and Image generation.

## File to Modify
`/Users/jake/Projects/frugworld/ai-service/src/portrait.ts`

## Current State
- Uses OpenAI `gpt-image-1` for portrait generation
- Uses FAL.ai `fal-ai/flux/schnell` for fast portrait generation
- Both are hardcoded

## Changes Required

### 1. Add Imports
```typescript
import type { ImageProvider } from './providers/types.js';
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
private imageProvider: ImageProvider | null = null;
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
  portraitConfig?: Partial<PortraitConfig>
): PortraitGenerator
```

### 5. Add Initialize Method
```typescript
async initialize(): Promise<void> {
  if (this.useProviderRegistry && this.registry && !this.imageProvider) {
    const { ProviderRegistry } = await import('./providers/registry.js');
    this.imageProvider = await (this.registry as InstanceType<typeof ProviderRegistry>).getImageProvider();
  }
}
```

### 6. Update generatePortrait Method
Replace OpenAI image generation with provider:
```typescript
if (this.useProviderRegistry && this.imageProvider) {
  const response = await this.imageProvider.generate({
    prompt,
    width: 1024,
    height: 1024,
  });
  buffer = response.imageData;
} else if (this.client) {
  // Legacy OpenAI approach
  const response = await this.client.images.generate({...});
  // ... existing code
}
```

### 7. Update generateFalPortrait Method
This method should also use the image provider when available, but can keep FAL-specific logic as fallback.

## Validation
- Backwards compatibility maintained
- Both OpenAI and FAL paths still work
- Run `npx tsc --noEmit` to verify
