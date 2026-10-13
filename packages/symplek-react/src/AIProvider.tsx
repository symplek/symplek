import React from "react";

/**
 * Configuration for the Symplek provider.
 */
export interface AIConfig {
  /**
   * API key for the AI provider.
   */
  apiKey?: string;
  /**
   * Default model to use for agent interactions.
   */
  defaultModel?: string;
  /**
   * Base URL for the AI provider's API.
   */
  baseUrl?: string;
}

const AIContext = React.createContext<AIConfig | null>(null);

/**
 * AIProvider component that provides the Symplek configuration to the application.
 */
export function AIProvider({
  children,
  config = {},
}: {
  children: React.ReactNode;
  config?: AIConfig;
}) {
  return <AIContext.Provider value={config}>{children}</AIContext.Provider>;
}

/**
 * Hook to access the Symplek configuration from the AIProvider.
 *
 * @throws {Error} If the hook is used outside of an AIProvider.
 */
export function useAIConfig(): AIConfig {
  const config = React.useContext(AIContext);
  if (config === null) {
    throw new Error("useAIConfig must be used within AIProvider");
  }
  return config;
}
