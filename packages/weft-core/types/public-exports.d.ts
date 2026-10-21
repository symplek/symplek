export * from "../dist/index";

export * from "../src/change-kernel";

// Server-only runtime values live on the @symplek/core/server subpath.
// This legacy file must not claim ai(), ProviderRegistry, or providerRegistry
// as root exports.
