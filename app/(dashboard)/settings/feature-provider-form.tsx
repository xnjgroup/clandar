"use client";

import { useState } from "react";

type Provider = { id: string; name: string; availableModels: string[] };

/** Picks which provider (and, optionally, which of its models) a feature uses — shared shape for the Email and Chat sections on /settings. */
export function FeatureProviderForm({
  action,
  providers,
  initialProviderId,
  initialModel,
}: {
  action: (form: FormData) => void;
  providers: Provider[];
  initialProviderId: string;
  initialModel: string;
}) {
  const [providerId, setProviderId] = useState(initialProviderId);
  const [model, setModel] = useState(initialModel);

  // Both fields are fully controlled and re-synced here (rather than via
  // `defaultValue`) so a save reliably reflects the newly persisted values —
  // an uncontrolled <select>'s `defaultValue` only applies once, at mount,
  // so if this component isn't remounted after saving (its position/key in
  // the tree doesn't change) it would otherwise keep showing whatever was
  // selected right before submitting instead of snapping to what was saved.
  // Re-deriving during render (rather than in an effect) is the pattern
  // React recommends for resetting state from a changed prop:
  // https://react.dev/learn/you-might-not-need-an-effect
  const [trackedInitial, setTrackedInitial] = useState({ providerId: initialProviderId, model: initialModel });
  if (trackedInitial.providerId !== initialProviderId || trackedInitial.model !== initialModel) {
    setTrackedInitial({ providerId: initialProviderId, model: initialModel });
    setProviderId(initialProviderId);
    setModel(initialModel);
  }

  const models = providers.find((p) => p.id === providerId)?.availableModels ?? [];

  const selectClass =
    "w-full rounded-[10px] border border-line bg-surface px-3 py-[9px] text-[12.5px] text-ink outline-none focus:border-[#9aa78a]";

  return (
    <form action={action} className="flex flex-col gap-[8px]">
      <select
        name="id"
        value={providerId}
        onChange={(e) => {
          setProviderId(e.target.value);
          setModel(""); // a different provider's model list is unrelated — don't carry over a stale pick
        }}
        className={selectClass}
      >
        <option value="">Built-in (Clandar AI)</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {providerId ? (
        models.length > 0 ? (
          <select name="model" value={model} onChange={(e) => setModel(e.target.value)} className={selectClass}>
            <option value="">Provider&rsquo;s default model</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <p className="m-0 text-[11px] text-faint">
            No models discovered yet for this provider — Test it below to list what it offers.
          </p>
        )
      ) : null}

      <button
        type="submit"
        className="w-fit cursor-pointer rounded-full border border-line px-3 py-[7px] text-[11.5px] font-medium"
      >
        Save
      </button>
    </form>
  );
}
