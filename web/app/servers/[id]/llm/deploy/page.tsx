'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Notice, PageHeader } from '@/components/ui';
import { useServerId } from '@/lib/use-server-id';
import { api } from '@/lib/api';
import {
  VLLM_CUSTOM_PROVIDER,
  VLLM_GPU_OPTIONS,
  VLLM_PRESETS,
  VLLM_PROVIDERS,
  deriveServedName,
  type VllmPreset,
  type VllmVariant,
} from '@/lib/vllm-presets';
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, Rocket, Trash2 } from 'lucide-react';

type ImageMode = 'latest' | 'nightly' | 'custom';

const IMAGE_LATEST = 'vllm/vllm-openai:latest';
const IMAGE_NIGHTLY = 'vllm/vllm-openai:nightly';

export default function DeployLlmPage() {
  return <DeployForm />;
}

function DeployForm() {
  const serverId = useServerId();
  const router = useRouter();

  const [provider, setProvider] = useState<string>(VLLM_PROVIDERS[0] ?? '');
  const [presetId, setPresetId] = useState<string>('');
  const [variantIdx, setVariantIdx] = useState(0);

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [served, setServed] = useState('');
  const [imageMode, setImageMode] = useState<ImageMode>('latest');
  const [customImage, setCustomImage] = useState('');
  const [port, setPort] = useState('8000');
  const [tensorParallel, setTensorParallel] = useState('1');
  const [maxModelLen, setMaxModelLen] = useState('');
  const [gpuUtil, setGpuUtil] = useState('0.9');
  const [extraArgs, setExtraArgs] = useState('');
  const [extraPip, setExtraPip] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [hfCacheDir, setHfCacheDir] = useState('/opt/hf-cache');
  const [revealToken, setRevealToken] = useState(false);
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presetsForProvider = useMemo(
    () => VLLM_PRESETS.filter((p) => p.provider === provider),
    [provider],
  );
  const preset = useMemo(
    () => VLLM_PRESETS.find((p) => p.id === presetId) ?? null,
    [presetId],
  );
  const variant: VllmVariant | null = preset ? preset.variants[variantIdx] ?? null : null;

  // Probe the host for a free port on first load so the form lands pre-filled.
  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    api
      .templateDefaults(serverId, 'vllm')
      .then((d) => {
        if (!cancelled && d.ports?.vllm) setPort(String(d.ports.vllm));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  const applyVariant = useCallback((p: VllmPreset, v: VllmVariant) => {
    const resolvedModel = v.modelId ?? p.modelId;
    const resolvedServed = v.served ?? deriveServedName(resolvedModel);
    setModel(resolvedModel);
    setServed(resolvedServed);
    setName(resolvedServed);
    setTensorParallel(v.tensorParallelSize ?? '1');
    setMaxModelLen(v.maxModelLen ?? '');
    setGpuUtil(v.gpuMemoryUtilization ?? '0.9');
    setExtraArgs(v.args.join('\n'));
    setEnvRows(v.env ? v.env.map((e) => ({ ...e })) : []);
    setImageMode(v.nightly ? 'nightly' : 'latest');
  }, []);

  // Land the form fully pre-filled on the first catalog model rather than the
  // empty "Custom model" state.
  useEffect(() => {
    const first = VLLM_PRESETS[0];
    if (first) {
      setPresetId(first.id);
      setVariantIdx(0);
      applyVariant(first, first.variants[0]);
    }
  }, [applyVariant]);

  const selectPreset = (id: string) => {
    setPresetId(id);
    setVariantIdx(0);
    if (id === '') {
      // "Custom model" — leave fields for manual entry but keep sane defaults.
      setModel('');
      setServed('');
      setName('');
      setTensorParallel('1');
      setMaxModelLen('');
      setGpuUtil('0.9');
      setExtraArgs('');
      setEnvRows([]);
      return;
    }
    const p = VLLM_PRESETS.find((x) => x.id === id);
    if (p) applyVariant(p, p.variants[0]);
  };

  const selectVariant = (idx: number) => {
    setVariantIdx(idx);
    if (preset) applyVariant(preset, preset.variants[idx]);
  };

  const selectProvider = (prov: string) => {
    setProvider(prov);
    const first = VLLM_PRESETS.find((p) => p.provider === prov);
    if (first) {
      setPresetId(first.id);
      setVariantIdx(0);
      applyVariant(first, first.variants[0]);
    } else {
      // "Custom" provider — blank manual form, no catalog model.
      selectPreset('');
    }
  };

  const providerOptions = [...VLLM_PROVIDERS, VLLM_CUSTOM_PROVIDER];

  const resolvedImage =
    imageMode === 'custom'
      ? customImage.trim()
      : imageMode === 'nightly'
        ? IMAGE_NIGHTLY
        : IMAGE_LATEST;

  const commandPreview = useMemo(() => {
    const parts = ['vllm serve', model || '<model>'];
    parts.push(`--tensor-parallel-size ${tensorParallel || '1'}`);
    if (maxModelLen.trim()) parts.push(`--max-model-len ${maxModelLen.trim()}`);
    parts.push(`--gpu-memory-utilization ${gpuUtil || '0.9'}`);
    if (served.trim()) parts.push(`--served-model-name ${served.trim()}`);
    const extra = extraArgs
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (extra.length) parts.push(extra.join(' '));
    return parts.join(' \\\n  ');
  }, [model, tensorParallel, maxModelLen, gpuUtil, served, extraArgs]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!name.trim()) return setErr('Deployment name is required.');
    if (!model.trim()) return setErr('Model ID is required.');
    if (!served.trim()) return setErr('Served model name is required.');
    if (imageMode === 'custom' && !customImage.trim())
      return setErr('Enter a custom image, or pick stable / nightly.');
    const portNum = parseInt(port, 10);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535)
      return setErr('API port must be between 1 and 65535.');

    setSubmitting(true);
    try {
      const env: Record<string, string> = {};
      for (const row of envRows) {
        if (row.key.trim()) env[row.key.trim()] = row.value;
      }
      const result = await api.templateDeploy(serverId, 'vllm', {
        name: name.trim(),
        config: {
          model: model.trim(),
          served_model_name: served.trim(),
          hf_token: hfToken,
          hf_cache_dir: hfCacheDir.trim(),
          vllm_image: resolvedImage,
          extra_pip_packages: extraPip,
          tensor_parallel_size: tensorParallel.trim() || '1',
          max_model_len: maxModelLen.trim(),
          gpu_memory_utilization: gpuUtil.trim() || '0.9',
          extra_cli_args: extraArgs,
        },
        ports: { vllm: portNum },
        env,
      });
      router.push(
        `/servers/${encodeURIComponent(serverId)}/templates/deployment?id=${encodeURIComponent(result.id)}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Deploy failed');
      setSubmitting(false);
    }
  };

  const llmHref = `/servers/${encodeURIComponent(serverId)}/llm`;

  return (
    <div className="space-y-6">
      <Link href={llmHref} className="btn-ghost inline-flex w-fit items-center gap-2">
        <ArrowLeft className="size-4" />
        Back to LLM models
      </Link>

      <PageHeader
        eyebrow="Deploy a model"
        title="vLLM model deployment"
        description="Pick a model from the recipe catalog — GPU, context length and launch flags pre-fill from the recipe. Tweak anything before deploying."
      />

      {err && <Notice tone="danger">{err}</Notice>}

      <form onSubmit={submit} className="space-y-5">
        {/* ---- Preset picker ---- */}
        <section className="card card-pad space-y-4">
          <SectionTitle
            title="Choose a model"
            description="Catalog sourced from the community recipes at recipes.vllm.ai."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Provider">
              <select
                className="input"
                value={provider}
                onChange={(e) => selectProvider(e.target.value)}
              >
                {providerOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model">
              <select
                className="input"
                value={presetId}
                onChange={(e) => selectPreset(e.target.value)}
              >
                <option value="">— Custom model —</option>
                {presetsForProvider.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="GPUs" description="Sets --tensor-parallel-size for your hardware.">
              <select
                className="input font-mono text-xs"
                value={tensorParallel}
                onChange={(e) => setTensorParallel(e.target.value)}
              >
                {VLLM_GPU_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === '1' ? 'GPU' : 'GPUs'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Configuration" description="Feature / precision set — pre-fills launch flags.">
              <select
                className="input"
                value={variantIdx}
                onChange={(e) => selectVariant(Number(e.target.value))}
                disabled={!preset}
              >
                {preset ? (
                  preset.variants.map((v, i) => (
                    <option key={i} value={i}>
                      {v.label}
                    </option>
                  ))
                ) : (
                  <option value={0}>Manual configuration</option>
                )}
              </select>
            </Field>
          </div>

          {preset && (
            <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs text-fg-muted">
              <div>{preset.description}</div>
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-fg-subtle">
                <span>Context: {preset.context.toLocaleString()} tokens</span>
                <span>Min vLLM: {preset.minVllm}</span>
                <span>Recommended: {variant?.tensorParallelSize ?? '1'} GPU(s)</span>
                <span className="font-mono">{variant?.modelId ?? preset.modelId}</span>
              </div>
            </div>
          )}
        </section>

        {/* ---- Deployment basics ---- */}
        <section className="card card-pad space-y-4">
          <SectionTitle title="Deployment" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Deployment name" required description="Used for the project slug and container names.">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-llm"
                maxLength={64}
                required
              />
            </Field>
            <Field label="API port" required description="Host port for the OpenAI-compatible API.">
              <input
                type="number"
                min={1}
                max={65535}
                className="input font-mono text-xs"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </Field>
            <Field
              label="vLLM image"
              description="Stable for production, nightly for newest model support."
            >
              <select
                className="input"
                value={imageMode}
                onChange={(e) => setImageMode(e.target.value as ImageMode)}
              >
                <option value="latest">Stable — {IMAGE_LATEST}</option>
                <option value="nightly">Nightly — {IMAGE_NIGHTLY}</option>
                <option value="custom">Custom image / pinned version…</option>
              </select>
            </Field>
            {imageMode === 'custom' && (
              <Field label="Custom image" required description="e.g. vllm/vllm-openai:v0.12.0">
                <input
                  className="input font-mono text-xs"
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  placeholder="vllm/vllm-openai:v0.12.0"
                />
              </Field>
            )}
          </div>
        </section>

        {/* ---- Model + resources ---- */}
        <section className="card card-pad space-y-4">
          <SectionTitle
            title="Model & resources"
            description="GPU count is set above with the GPUs picker."
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Model ID" required description="HuggingFace repo passed to vLLM as --model.">
              <input
                className="input font-mono text-xs"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="google/gemma-4-31B-it"
                required
              />
            </Field>
            <Field label="Served model name" required description="Alias clients send in the OpenAI 'model' field.">
              <input
                className="input font-mono text-xs"
                value={served}
                onChange={(e) => setServed(e.target.value)}
                placeholder="gemma-4-31B"
                required
              />
            </Field>
            <Field label="GPU memory utilization" required description="Fraction of GPU memory vLLM may reserve (0–1).">
              <input
                className="input font-mono text-xs"
                value={gpuUtil}
                onChange={(e) => setGpuUtil(e.target.value)}
                placeholder="0.9"
                required
              />
            </Field>
            <Field
              label="Max model length"
              description="Context window (--max-model-len). Leave blank to use the model's full context."
            >
              <input
                type="number"
                className="input font-mono text-xs"
                value={maxModelLen}
                onChange={(e) => setMaxModelLen(e.target.value)}
                placeholder="32768"
              />
            </Field>
          </div>
        </section>

        {/* ---- Advanced ---- */}
        <section className="card card-pad space-y-4">
          <SectionTitle
            title="Launch flags & dependencies"
            description="Pre-filled from the recipe. Each line of extra args is one argv entry."
          />
          <Field
            label="Extra vLLM CLI args"
            description="One argv per line — put a --flag on one line and its value on the next."
          >
            <textarea
              className="input min-h-40 resize-y font-mono text-xs leading-relaxed"
              spellCheck={false}
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              placeholder={'--reasoning-parser\nqwen3\n--enable-auto-tool-choice'}
            />
          </Field>
          <Field
            label="Extra pip packages"
            description="One per line. If set, a Dockerfile is built on top of the vLLM image (e.g. fresh transformers)."
          >
            <textarea
              className="input min-h-24 resize-y font-mono text-xs leading-relaxed"
              spellCheck={false}
              value={extraPip}
              onChange={(e) => setExtraPip(e.target.value)}
              placeholder={'git+https://github.com/huggingface/transformers.git'}
            />
          </Field>
        </section>

        {/* ---- HF + env ---- */}
        <section className="card card-pad space-y-4">
          <SectionTitle title="HuggingFace & environment" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="HuggingFace token" description="Required for gated models. Stored in the deployment .env.">
              <div className="relative">
                <input
                  type={revealToken ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="input pr-10 font-mono text-xs"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_..."
                />
                <button
                  type="button"
                  onClick={() => setRevealToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:bg-white/[0.06] hover:text-fg"
                  tabIndex={-1}
                >
                  {revealToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
            </Field>
            <Field label="HF cache directory (host)" required description="Absolute host path mounted at /hf-cache.">
              <input
                className="input font-mono text-xs"
                value={hfCacheDir}
                onChange={(e) => setHfCacheDir(e.target.value)}
                placeholder="/opt/hf-cache"
                required
              />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-fg-muted">Environment variables</span>
              <button
                type="button"
                onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}
                className="btn-secondary"
              >
                <Plus className="size-3.5" />
                Add variable
              </button>
            </div>
            {envRows.length === 0 ? (
              <div className="text-xs text-fg-subtle">No extra variables.</div>
            ) : (
              <div className="space-y-2">
                {envRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                    <input
                      className="input font-mono text-xs"
                      placeholder="KEY"
                      value={row.key}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                        )
                      }
                    />
                    <input
                      className="input font-mono text-xs"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn-ghost p-2"
                      onClick={() => setEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ---- Command preview ---- */}
        <section className="card card-pad space-y-2">
          <SectionTitle title="Launch command preview" />
          <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
            {commandPreview}
          </pre>
        </section>

        <div className="flex justify-end gap-2">
          <Link href={llmHref} className="btn-ghost">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Deploy model
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-muted">
        {label}
        {required && <span className="ml-1 text-rose-300">*</span>}
      </span>
      {children}
      {description && <span className="mt-1 block text-[11px] text-fg-subtle">{description}</span>}
    </label>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-fg">{title}</div>
      {description && <div className="mt-1 text-xs text-fg-muted">{description}</div>}
    </div>
  );
}
