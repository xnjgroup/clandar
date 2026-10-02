import { listLlmProviders } from "@/lib/llm-providers";

/** The app's view of the org's AI providers: each provider, and which one each feature uses. */
export async function aiProvidersResponse(orgId: string) {
  const providers = await listLlmProviders(orgId);
  const pick = (flag: (p: (typeof providers)[number]) => boolean, model: (p: (typeof providers)[number]) => string | null) => {
    const p = providers.find(flag);
    return { providerId: p?.id ?? null, model: p ? model(p) : null };
  };
  return {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      hasApiKey: p.hasApiKey,
      isDefault: p.isDefault,
      enabled: p.enabled,
      status: p.status,
      statusDetail: p.statusDetail,
      availableModels: p.availableModels,
      lastCheckedAt: p.lastCheckedAt,
    })),
    // null providerId = Built-in (Clandar AI); null model = the provider's own default model.
    features: {
      chat: pick((p) => p.isChatProvider, (p) => p.chatModel),
      email: pick((p) => p.isEmailAnalyzer, (p) => p.emailModel),
      invoice: pick((p) => p.isInvoiceProvider, (p) => p.invoiceModel),
      quote: pick((p) => p.isQuoteProvider, (p) => p.quoteModel),
    },
  };
}
