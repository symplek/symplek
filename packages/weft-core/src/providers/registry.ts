/**
 * @fileoverview Provider Registry for weft-core
 * @description Manages registration and retrieval of AI providers.
 */

import type { Provider, ProviderId } from "./interface";

/**
 * Registry for managing AI providers.
 *
 * @example
 * ```typescript
 * const registry = new ProviderRegistry();
 * registry.register(new OpenAIProvider());
 *
 * const provider = registry.get('openai');
 * ```
 */
export class ProviderRegistry {
  private providers = new Map<ProviderId, Provider>();
  private defaultProviderId: ProviderId | null = null;

  /**
   * Register a new provider.
   *
   * @param provider - The provider instance to register
   * @param isDefault - Whether this should be the default provider
   */
  register(provider: Provider, isDefault = false): void {
    this.providers.set(provider.id, provider);
    if (isDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  /**
   * Make a provider reachable by id without making it the default.
   *
   * Used when an adapter is loaded on demand from an environment key. Which
   * provider a call with no `provider` option uses stays decided by
   * `configure()` or, failing that, by the documented key order. It must not
   * depend on which provider happened to be reached for first.
   *
   * @param provider - The provider instance to make available
   */
  makeAvailable(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Get a provider by its ID.
   *
   * @param id - The provider identifier
   * @returns The provider instance or undefined if not found
   */
  get(id: ProviderId): Provider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get the default provider.
   *
   * @returns The default provider instance or undefined if none registered
   */
  getDefault(): Provider | undefined {
    if (!this.defaultProviderId) return undefined;
    return this.get(this.defaultProviderId);
  }

  /**
   * Get all registered providers.
   *
   * @returns An array of all registered provider instances
   */
  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Unregister a provider.
   *
   * @param id - The provider identifier to remove
   * @returns True if the provider was removed, false otherwise
   */
  unregister(id: ProviderId): boolean {
    const removed = this.providers.delete(id);
    if (this.defaultProviderId === id) {
      this.defaultProviderId = this.providers.keys().next().value || null;
    }
    return removed;
  }

  /**
   * Clear all registered providers.
   */
  clear(): void {
    this.providers.clear();
    this.defaultProviderId = null;
  }
}

/**
 * Global provider registry instance.
 */
export const providerRegistry = new ProviderRegistry();
