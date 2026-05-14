'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, Notice, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { TemplateDefinition, TemplateField } from '@/lib/types';
import { ArrowLeft, Boxes, Loader2, Plus, Rocket, Trash2 } from 'lucide-react';

export default function TemplateDeployPage() {
  return (
    <DashboardShell>
      <DeployForm />
    </DashboardShell>
  );
}

function DeployForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get('template') ?? '';

  const [template, setTemplate] = useState<TemplateDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>([]);

  const load = useCallback(async () => {
    if (!templateId) {
      setErr('No template selected.');
      setLoading(false);
      return;
    }
    try {
      const t = await api.templateGet(templateId);
      setTemplate(t);
      const cfg: Record<string, string> = {};
      for (const f of t.fields) {
        if (f.default) cfg[f.key] = f.default;
      }
      setConfig(cfg);
      const pmap: Record<string, number> = {};
      for (const p of t.ports) {
        pmap[p.key] = p.default;
      }
      setPorts(pmap);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!template) return {} as Record<string, TemplateField[]>;
    const out: Record<string, TemplateField[]> = {};
    for (const f of template.fields) {
      const g = f.group || 'general';
      (out[g] ||= []).push(f);
    }
    return out;
  }, [template]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;
    setErr(null);
    setSubmitting(true);
    try {
      const envMap: Record<string, string> = {};
      for (const row of envRows) {
        if (row.key.trim()) envMap[row.key.trim()] = row.value;
      }
      const result = await api.templateDeploy(template.id, {
        name: name.trim(),
        config,
        ports,
        env: envMap,
      });
      router.push(`/templates/deployment?id=${encodeURIComponent(result.id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Deploy failed');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-fg-muted">
        <div className="glass-panel flex items-center gap-2 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-accent" />
          Loading template
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="space-y-4">
        <Link href="/templates" className="btn-ghost inline-flex w-fit items-center gap-2">
          <ArrowLeft className="size-4" />
          Back to templates
        </Link>
        <EmptyState
          title="Template not found"
          message={err || 'Choose a template from the catalog.'}
          icon={<Boxes className="size-5" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/templates" className="btn-ghost inline-flex w-fit items-center gap-2">
        <ArrowLeft className="size-4" />
        Back to templates
      </Link>

      <PageHeader
        eyebrow={`Template: ${template.id}`}
        title={`Deploy ${template.name}`}
        description={template.description}
      />

      {err && <Notice tone="danger">{err}</Notice>}

      <form onSubmit={submit} className="space-y-5">
        <section className="card card-pad space-y-4">
          <SectionTitle title="Project" />
          <Field label="Project name" required description="Used for the deployment slug, compose project, and container names.">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="acme-supabase"
              required
              maxLength={64}
            />
          </Field>
        </section>

        {Object.entries(grouped).map(([group, fields]) => (
          <section key={group} className="card card-pad space-y-4">
            <SectionTitle title={prettyGroup(group)} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {fields.map((f) => (
                <DynamicField
                  key={f.key}
                  field={f}
                  value={config[f.key] ?? ''}
                  onChange={(v) => setConfig((p) => ({ ...p, [f.key]: v }))}
                />
              ))}
            </div>
          </section>
        ))}

        {template.ports.length > 0 && (
          <section className="card card-pad space-y-4">
            <SectionTitle title="Ports" description="Each deployment must use unique host ports." />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {template.ports.map((p) => (
                <Field key={p.key} label={p.label} description={p.description}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    className="input font-mono text-xs"
                    value={ports[p.key] ?? ''}
                    onChange={(e) =>
                      setPorts((prev) => ({ ...prev, [p.key]: Number(e.target.value) || 0 }))
                    }
                  />
                </Field>
              ))}
            </div>
          </section>
        )}

        <section className="card card-pad space-y-4">
          <SectionTitle
            title="Extra environment variables"
            description="Optional. Appended to the generated .env file."
            actions={
              <button
                type="button"
                onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}
                className="btn-secondary"
              >
                <Plus className="size-3.5" />
                Add variable
              </button>
            }
          />
          {envRows.length === 0 && (
            <div className="text-xs text-fg-subtle">No extra variables.</div>
          )}
          <div className="space-y-2">
            {envRows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_2fr_auto] gap-2">
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
                  onClick={() =>
                    setEnvRows((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/templates" className="btn-ghost">
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Deploy
          </button>
        </div>
      </form>
    </div>
  );
}

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string;
  onChange: (v: string) => void;
}) {
  const handle = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value);
  return (
    <Field label={field.label} required={field.required} description={field.description}>
      {field.type === 'textarea' ? (
        <textarea
          className="input min-h-24"
          value={value}
          onChange={handle}
          placeholder={field.placeholder}
        />
      ) : field.type === 'password' || field.type === 'secret' ? (
        <input
          type="password"
          autoComplete="new-password"
          className="input font-mono text-xs"
          value={value}
          onChange={handle}
          placeholder={field.placeholder}
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          className="input font-mono text-xs"
          value={value}
          onChange={handle}
          placeholder={field.placeholder}
        />
      ) : (
        <input
          className="input"
          value={value}
          onChange={handle}
          placeholder={field.placeholder}
        />
      )}
    </Field>
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

function SectionTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div>
        <div className="text-sm font-semibold text-fg">{title}</div>
        {description && <div className="mt-1 text-xs text-fg-muted">{description}</div>}
      </div>
      {actions}
    </div>
  );
}

function prettyGroup(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1).replace(/[-_]/g, ' ');
}
