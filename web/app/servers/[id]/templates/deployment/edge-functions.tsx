'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Notice } from '@/components/ui';
import { api } from '@/lib/api';
import type { Deployment, FunctionsInfo, FunctionsLayout, SecretFileInfo } from '@/lib/types';
import {
  Braces,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus,
  KeyRound,
  Loader2,
  Plus,
  RotateCw,
  Save,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';

// Mirrors the server-side validation in internal/templates/functions.go.
const FUNCTION_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
const PATH_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_SECRET_FILE_BYTES = 256 * 1024;

function starterSource(name: string): string {
  return `// Edge Function "${name}".
// Secrets from the "Function secrets" panel: Deno.env.get("KEY").
// Also available: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL.

Deno.serve(async (req) => {
  const { name = "world" } = await req.json().catch(() => ({}));
  return new Response(
    JSON.stringify({ message: \`Hello \${name}!\` }),
    { headers: { "Content-Type": "application/json" } },
  );
});
`;
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

/**
 * Edge Functions code editor + secrets manager for a Supabase deployment.
 * Everything is stored as files in the deployment workdir on the host that
 * runs it; "Apply changes" recreates the runtime container so edits and new
 * secrets take effect.
 */
export function EdgeFunctionsPanel({ serverId, dep }: { serverId: string; dep: Deployment }) {
  const [info, setInfo] = useState<FunctionsInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartNote, setRestartNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setInfo(await api.functionsList(serverId, dep.id));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errText(e, 'Failed to load edge functions'));
    }
  }, [serverId, dep.id]);

  useEffect(() => {
    if (serverId) reload();
  }, [serverId, reload]);

  const canApply = dep.status === 'running' || dep.status === 'failed';

  const apply = async () => {
    setRestarting(true);
    setRestartNote(null);
    try {
      await api.functionsRestart(serverId, dep.id);
      setPendingApply(false);
      setRestartNote({ tone: 'success', text: 'Restarting the functions runtime. Progress appears in Event history.' });
    } catch (e) {
      setRestartNote({ tone: 'danger', text: errText(e, 'Restart failed') });
    } finally {
      setRestarting(false);
    }
  };

  const changed = useCallback(() => {
    setPendingApply(true);
    setRestartNote(null);
  }, []);

  if (loadErr) {
    return (
      <section className="card card-pad space-y-2">
        <div className="text-sm font-semibold">Edge Functions</div>
        <Notice tone="danger">{loadErr}</Notice>
      </section>
    );
  }
  if (!info) {
    return (
      <section className="card card-pad flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="size-4 animate-spin text-accent" />
        Loading edge functions
      </section>
    );
  }
  if (!info.enabled || !info.layout) {
    return (
      <section className="card card-pad space-y-2">
        <div className="text-sm font-semibold">Edge Functions</div>
        <Notice>
          <div className="text-xs">
            Edge Functions are disabled for this deployment. Set <span className="font-mono">functions_enabled</span>{' '}
            to <span className="font-mono">yes</span> in Edit configuration and restart to add the runtime.
          </div>
        </Notice>
      </section>
    );
  }

  const applyBar = (
    <div className="flex flex-wrap items-center gap-2">
      {pendingApply && (
        <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-200">
          Unapplied changes
        </span>
      )}
      <button
        type="button"
        onClick={apply}
        disabled={!canApply || restarting}
        className={pendingApply ? 'btn-primary' : 'btn-secondary'}
        title={canApply ? 'Recreate the functions container' : 'Start the deployment first'}
      >
        {restarting ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
        Apply changes
      </button>
    </div>
  );

  return (
    <>
      <FunctionsSection
        serverId={serverId}
        dep={dep}
        info={info}
        layout={info.layout}
        reload={reload}
        onChanged={changed}
        applyBar={applyBar}
        restartNote={restartNote}
        canApply={canApply}
      />
      <SecretsSection serverId={serverId} dep={dep} onChanged={changed} applyBar={applyBar} />
    </>
  );
}

// ---------- Function sources ----------

function FunctionsSection({
  serverId,
  dep,
  info,
  layout,
  reload,
  onChanged,
  applyBar,
  restartNote,
  canApply,
}: {
  serverId: string;
  dep: Deployment;
  info: FunctionsInfo;
  layout: FunctionsLayout;
  reload: () => Promise<void>;
  onChanged: () => void;
  applyBar: React.ReactNode;
  restartNote: { tone: 'success' | 'danger'; text: string } | null;
  canApply: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newFn, setNewFn] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<string | null>(null);
  const autoSelected = useRef(false);

  const dirty = selected !== null && content !== original;
  const selectedFn = selected && selected.includes('/') ? selected.split('/')[0] : null;
  const selectedIsSystem = selected ? layout.system.includes(selected.split('/')[0]) : false;

  const open = useCallback(
    async (path: string) => {
      setFileLoading(true);
      setErr(null);
      try {
        const f = await api.functionFileGet(serverId, dep.id, path);
        setSelected(f.path);
        setContent(f.content);
        setOriginal(f.content);
      } catch (e) {
        setErr(errText(e, 'Failed to open file'));
      } finally {
        setFileLoading(false);
      }
    },
    [serverId, dep.id],
  );

  // Open the first user function on first load.
  useEffect(() => {
    if (autoSelected.current) return;
    autoSelected.current = true;
    const first = info.functions.find((f) => !f.system && f.files.length > 0);
    if (first) {
      const index = first.files.find((f) => /\/index\.(ts|js|tsx|jsx)$/.test(f.path)) ?? first.files[0];
      open(index.path);
    }
  }, [info, open]);

  const confirmDiscard = () => !dirty || confirm('Discard unsaved changes?');

  const select = (path: string) => {
    if (path === selected || !confirmDiscard()) return;
    open(path);
  };

  const save = async () => {
    if (!selected) return;
    setBusy('save');
    setErr(null);
    try {
      await api.functionFileSave(serverId, dep.id, selected, content);
      setOriginal(content);
      onChanged();
      await reload();
    } catch (e) {
      setErr(errText(e, 'Save failed'));
    } finally {
      setBusy(null);
    }
  };

  const createFunction = async () => {
    const name = (newFn ?? '').trim();
    if (!FUNCTION_NAME_RE.test(name)) {
      setErr('Function names use letters, digits, "-" and "_" (max 64).');
      return;
    }
    if (info.functions.some((f) => f.name === name) || info.root_files.some((f) => f.path === name)) {
      setErr(`"${name}" already exists.`);
      return;
    }
    if (!confirmDiscard()) return;
    setBusy('new-fn');
    setErr(null);
    try {
      const path = `${name}/index.ts`;
      await api.functionFileSave(serverId, dep.id, path, starterSource(name));
      setNewFn(null);
      onChanged();
      await reload();
      await open(path);
    } catch (e) {
      setErr(errText(e, 'Could not create function'));
    } finally {
      setBusy(null);
    }
  };

  const createFile = async () => {
    if (!selectedFn) return;
    const rel = (newFile ?? '').trim().replace(/^\/+/, '');
    if (!rel || !rel.split('/').every((s) => PATH_SEGMENT_RE.test(s) && !s.includes('..'))) {
      setErr('File paths use letters, digits, ".", "-" and "_" separated by "/", e.g. utils.ts or lib/db.ts.');
      return;
    }
    if (!confirmDiscard()) return;
    const path = `${selectedFn}/${rel}`;
    setBusy('new-file');
    setErr(null);
    try {
      await api.functionFileSave(serverId, dep.id, path, '');
      setNewFile(null);
      await reload();
      await open(path);
    } catch (e) {
      setErr(errText(e, 'Could not create file'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (path: string, what: string) => {
    if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
    setBusy(`delete:${path}`);
    setErr(null);
    try {
      await api.functionPathDelete(serverId, dep.id, path);
      if (selected && (selected === path || selected.startsWith(`${path}/`))) {
        setSelected(null);
        setContent('');
        setOriginal('');
      }
      onChanged();
      await reload();
    } catch (e) {
      setErr(errText(e, 'Delete failed'));
    } finally {
      setBusy(null);
    }
  };

  const onEditorKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty && busy === null) save();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      const next = content.slice(0, start) + '  ' + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  const baseUrl = (dep.config.public_api_url || `http://localhost:${dep.ports.kong_http ?? 8000}`).replace(/\/+$/, '');
  const verifyJwt = !['no', 'false', '0', 'off'].includes((dep.config.functions_verify_jwt ?? '').trim().toLowerCase());
  const endpoint = selectedFn && !selectedIsSystem ? `${baseUrl}${layout.route_prefix}${selectedFn}` : null;

  return (
    <section className="card card-pad space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-accent" />
            Edge Functions
          </div>
          <div className="mt-1 max-w-2xl text-xs text-fg-muted">
            Each folder is one function, served at <span className="font-mono">{layout.route_prefix}&lt;name&gt;</span>. Files
            live in <span className="font-mono">{layout.source_dir}</span> on the host. Save, then apply to restart the
            runtime.
          </div>
        </div>
        {applyBar}
      </div>

      {restartNote && <Notice tone={restartNote.tone}>{restartNote.text}</Notice>}
      {!canApply && (
        <Notice tone="warning">
          <span className="text-xs">The deployment is {dep.status}. Changes are saved now and take effect when it starts.</span>
        </Notice>
      )}
      {err && <Notice tone="danger">{err}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* File tree */}
        <div className="space-y-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.025]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold">
              <span>Functions</span>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-[11px]"
                onClick={() => setNewFn(newFn === null ? '' : null)}
              >
                <Plus className="size-3.5" />
                New
              </button>
            </div>
            {newFn !== null && (
              <div className="flex gap-1.5 border-b border-white/10 p-2">
                <input
                  autoFocus
                  value={newFn}
                  onChange={(e) => setNewFn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createFunction();
                    if (e.key === 'Escape') setNewFn(null);
                  }}
                  placeholder="send-push"
                  className="input py-1.5 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={createFunction}
                  disabled={busy !== null}
                  className="btn-primary px-2.5 py-1.5 text-xs"
                >
                  {busy === 'new-fn' ? <Loader2 className="size-3.5 animate-spin" /> : 'Create'}
                </button>
              </div>
            )}
            <ul className="max-h-[480px] overflow-y-auto py-1">
              {info.functions.length === 0 && (
                <li className="px-3 py-3 text-[11px] text-fg-subtle">No functions yet. Create one to get started.</li>
              )}
              {info.functions.map((fn) => (
                <li key={fn.name} className="px-1.5 py-1">
                  <div className="group flex items-center gap-1.5 px-1.5 text-xs font-medium">
                    <span className="truncate font-mono">{fn.name}</span>
                    {fn.system && (
                      <span className="rounded border border-white/10 px-1 text-[9px] uppercase tracking-wider text-fg-subtle">
                        runtime
                      </span>
                    )}
                    {!fn.system && (
                      <button
                        type="button"
                        aria-label={`Delete function ${fn.name}`}
                        title="Delete function"
                        disabled={busy !== null}
                        onClick={() => remove(fn.name, `function "${fn.name}" and all its files`)}
                        className="ml-auto rounded p-0.5 text-fg-subtle opacity-0 hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <ul className="mt-0.5">
                    {fn.files.map((f) => (
                      <FileRow
                        key={f.path}
                        label={f.path.slice(fn.name.length + 1)}
                        active={selected === f.path}
                        onClick={() => select(f.path)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
              {info.root_files.length > 0 && (
                <li className="px-1.5 py-1">
                  <div className="px-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">Shared config</div>
                  <ul className="mt-0.5">
                    {info.root_files.map((f) => (
                      <FileRow
                        key={f.path}
                        label={f.path}
                        icon={<Braces className="size-3.5 shrink-0" />}
                        active={selected === f.path}
                        onClick={() => select(f.path)}
                      />
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Editor */}
        <div className="min-w-0 space-y-3">
          {selected === null ? (
            <div className="grid min-h-[320px] place-items-center rounded-lg border border-dashed border-white/10 text-xs text-fg-subtle">
              {fileLoading ? <Loader2 className="size-4 animate-spin text-accent" /> : 'Select a file or create a function.'}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                  <FileCode2 className="size-4 shrink-0 text-accent" />
                  <span className="truncate">{selected}</span>
                  {dirty && <span className="text-amber-300">●</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedFn && !selectedIsSystem && (
                    <button
                      type="button"
                      className="btn-ghost px-2.5 py-1.5 text-xs"
                      onClick={() => setNewFile(newFile === null ? '' : null)}
                    >
                      <FilePlus className="size-3.5" />
                      New file
                    </button>
                  )}
                  {!selectedIsSystem && selectedFn && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => remove(selected, `file "${selected}"`)}
                      className="btn-ghost px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-400/10"
                    >
                      <Trash2 className="size-3.5" />
                      Delete file
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || busy !== null}
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Save
                  </button>
                </div>
              </div>

              {newFile !== null && selectedFn && (
                <div className="flex gap-1.5">
                  <span className="grid place-items-center px-1 font-mono text-xs text-fg-subtle">{selectedFn}/</span>
                  <input
                    autoFocus
                    value={newFile}
                    onChange={(e) => setNewFile(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFile();
                      if (e.key === 'Escape') setNewFile(null);
                    }}
                    placeholder="utils.ts"
                    className="input py-1.5 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={createFile}
                    disabled={busy !== null}
                    className="btn-secondary px-2.5 py-1.5 text-xs"
                  >
                    {busy === 'new-file' ? <Loader2 className="size-3.5 animate-spin" /> : 'Add'}
                  </button>
                </div>
              )}

              {selectedIsSystem && (
                <Notice tone="warning">
                  <span className="text-xs">
                    This file is part of the functions runtime. A broken main worker stops every function; edit only if you
                    know why.
                  </span>
                </Notice>
              )}

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={onEditorKey}
                spellCheck={false}
                disabled={fileLoading}
                className="input min-h-[420px] resize-y whitespace-pre font-mono text-xs leading-relaxed"
              />
              <div className="text-[11px] text-fg-subtle">Tab inserts two spaces · Ctrl/⌘+S saves</div>

              {endpoint && (
                <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-fg-subtle">Invoke</div>
                  <pre className="overflow-x-auto whitespace-pre font-mono text-[11px] text-fg-muted">
                    {`curl -X POST '${endpoint}' \\\n${
                      verifyJwt ? "  -H 'Authorization: Bearer <ANON_KEY or user JWT>' \\\n" : ''
                    }  -H 'Content-Type: application/json' \\\n  -d '{"name":"test"}'`}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function FileRow({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pl-4 pr-2 text-left font-mono text-[11px] ${
          active ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-white/[0.05] hover:text-fg'
        }`}
      >
        {icon ?? <FileCode2 className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

// ---------- Secrets ----------

interface SecretRow {
  id: number;
  key: string;
  value: string;
  reveal: boolean;
}

function SecretsSection({
  serverId,
  dep,
  onChanged,
  applyBar,
}: {
  serverId: string;
  dep: Deployment;
  onChanged: () => void;
  applyBar: React.ReactNode;
}) {
  const [layout, setLayout] = useState<FunctionsLayout | null>(null);
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [saved, setSaved] = useState('');
  const [files, setFiles] = useState<SecretFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ file: File; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const snapshot = (list: { key: string; value: string }[]) =>
    JSON.stringify(list.map((r) => [r.key.trim(), r.value]));

  const load = useCallback(async () => {
    try {
      const s = await api.secretsGet(serverId, dep.id);
      setLayout(s.layout ?? null);
      setRows(s.env.map((e) => ({ id: nextId.current++, key: e.key, value: e.value, reveal: false })));
      setSaved(snapshot(s.env));
      setFiles(s.files);
      setErr(null);
    } catch (e) {
      setErr(errText(e, 'Failed to load secrets'));
    } finally {
      setLoading(false);
    }
  }, [serverId, dep.id]);

  useEffect(() => {
    if (serverId) load();
  }, [serverId, load]);

  const dirty = useMemo(() => snapshot(rows) !== saved, [rows, saved]);

  const reserved = useCallback(
    (key: string) =>
      !!layout &&
      (layout.reserved_env.includes(key) || layout.reserved_env_prefixes.some((p) => key.startsWith(p))),
    [layout],
  );

  const rowError = (r: SecretRow): string | null => {
    const k = r.key.trim();
    if (!k) return 'Name required';
    if (!SECRET_KEY_RE.test(k)) return 'Letters, digits, _';
    if (reserved(k)) return 'Reserved by the runtime';
    if (rows.filter((o) => o.key.trim() === k).length > 1) return 'Duplicate';
    if (/[\r\n]/.test(r.value)) return 'Single line only';
    return null;
  };
  const hasErrors = rows.some((r) => rowError(r) !== null);

  const update = (id: number, patch: Partial<SecretRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = (key = '', value = '') =>
    setRows((prev) => [...prev, { id: nextId.current++, key, value, reveal: true }]);

  const save = async () => {
    setBusy('save');
    setErr(null);
    try {
      const env = rows.map((r) => ({ key: r.key.trim(), value: r.value }));
      await api.secretsSave(serverId, dep.id, env);
      setSaved(snapshot(env));
      onChanged();
    } catch (e) {
      setErr(errText(e, 'Save failed'));
    } finally {
      setBusy(null);
    }
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_SECRET_FILE_BYTES) {
      setErr(`Secret files are limited to ${formatBytes(MAX_SECRET_FILE_BYTES)}.`);
      return;
    }
    setErr(null);
    setUpload({ file: f, name: f.name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[.]+/, '') });
  };

  const doUpload = async () => {
    if (!upload) return;
    const name = upload.name.trim();
    if (!PATH_SEGMENT_RE.test(name) || name.includes('..')) {
      setErr('File names use letters, digits, ".", "-" and "_" and must not start with ".".');
      return;
    }
    if (files.some((f) => f.name === name) && !confirm(`Replace the existing secret file "${name}"?`)) return;
    setBusy('upload');
    setErr(null);
    try {
      await api.secretFileUpload(serverId, dep.id, name, await fileToBase64(upload.file));
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
      onChanged();
      await load();
    } catch (e) {
      setErr(errText(e, 'Upload failed'));
    } finally {
      setBusy(null);
    }
  };

  const removeFile = async (name: string) => {
    if (!confirm(`Delete secret file "${name}"? Functions that read it will fail.`)) return;
    setBusy(`rm:${name}`);
    setErr(null);
    try {
      await api.secretFileDelete(serverId, dep.id, name);
      onChanged();
      await load();
    } catch (e) {
      setErr(errText(e, 'Delete failed'));
    } finally {
      setBusy(null);
    }
  };

  // "AuthKey.p8" -> "AUTHKEY_P8_FILE"
  const suggestKey = (name: string) => `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_FILE`;
  const referenced = (path: string) => rows.some((r) => r.value === path);

  return (
    <section className="card card-pad space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-accent" />
            Function secrets
          </div>
          <div className="mt-1 max-w-2xl text-xs text-fg-muted">
            Environment variables for every function (
            <span className="font-mono">{layout?.secrets_env_file ?? '.env.functions'}</span>, mode 0600), read with{' '}
            <span className="font-mono">Deno.env.get(&quot;KEY&quot;)</span>. They are not shown in Supabase Studio.
          </div>
        </div>
        {applyBar}
      </div>

      {err && <Notice tone="danger">{err}</Notice>}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="size-4 animate-spin text-accent" />
          Loading secrets
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {rows.length === 0 && <div className="text-xs text-fg-subtle">No secrets yet.</div>}
            {rows.map((r) => {
              const rowErr = rowError(r);
              return (
                <div key={r.id} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
                  <div>
                    <input
                      value={r.key}
                      onChange={(e) => update(r.id, { key: e.target.value })}
                      placeholder="APNS_KEY_ID"
                      spellCheck={false}
                      className={`input py-1.5 font-mono text-xs ${rowErr ? 'border-rose-400/50' : ''}`}
                    />
                    {rowErr && <div className="mt-0.5 text-[10px] text-rose-300">{rowErr}</div>}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type={r.reveal ? 'text' : 'password'}
                      value={r.value}
                      onChange={(e) => update(r.id, { value: e.target.value })}
                      placeholder="value"
                      spellCheck={false}
                      autoComplete="off"
                      className="input py-1.5 font-mono text-xs"
                    />
                    <button
                      type="button"
                      aria-label={r.reveal ? 'Hide value' : 'Show value'}
                      onClick={() => update(r.id, { reveal: !r.reveal })}
                      className="btn-ghost px-2 py-1.5"
                    >
                      {r.reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${r.key || 'secret'}`}
                    onClick={() => setRows((prev) => prev.filter((o) => o.id !== r.id))}
                    className="btn-ghost h-fit px-2 py-1.5 text-fg-subtle hover:text-rose-300"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => addRow()} className="btn-secondary px-3 py-1.5 text-xs">
              <Plus className="size-3.5" />
              Add secret
            </button>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[11px] text-amber-300">Unsaved</span>}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || hasErrors || busy !== null}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Save secrets
              </button>
            </div>
          </div>
          {layout && (
            <div className="text-[11px] text-fg-subtle">
              Reserved (set by the runtime): {layout.reserved_env.join(', ')}
              {layout.reserved_env_prefixes.length > 0 && `, ${layout.reserved_env_prefixes.map((p) => `${p}*`).join(', ')}`}
              . Multi-line values such as private keys belong in secret files below.
            </div>
          )}

          {/* Secret files */}
          <div className="rounded-lg border border-white/10 bg-white/[0.025]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <div className="text-xs font-semibold">
                Secret files{' '}
                <span className="font-normal text-fg-subtle">
                  mounted read-only at <span className="font-mono">{layout?.secret_files_mount ?? '/run/secrets'}</span>
                </span>
              </div>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy !== null}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                <Upload className="size-3.5" />
                Upload file
              </button>
            </div>

            {upload && (
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
                <span className="text-[11px] text-fg-muted">Save as</span>
                <input
                  value={upload.name}
                  onChange={(e) => setUpload({ ...upload, name: e.target.value })}
                  className="input w-56 py-1 font-mono text-xs"
                />
                <span className="text-[11px] text-fg-subtle">{formatBytes(upload.file.size)}</span>
                <button
                  type="button"
                  onClick={doUpload}
                  disabled={busy !== null}
                  className="btn-primary px-2.5 py-1 text-xs"
                >
                  {busy === 'upload' ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUpload(null);
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}

            {files.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-fg-subtle">
                No secret files. Upload keys or certificates (e.g. an Apple APNS <span className="font-mono">AuthKey.p8</span>
                ), then add a secret pointing at its path.
              </div>
            ) : (
              <ul>
                {files.map((f) => (
                  <li
                    key={f.name}
                    className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2 text-xs last:border-b-0"
                  >
                    <KeyRound className="size-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px]">{f.container_path}</div>
                      <div className="text-[10px] text-fg-subtle">
                        {formatBytes(f.size)} · {new Date(f.mod_time).toLocaleString()}
                      </div>
                    </div>
                    {!referenced(f.container_path) && (
                      <button
                        type="button"
                        onClick={() => addRow(suggestKey(f.name), f.container_path)}
                        className="btn-ghost px-2 py-1 text-[11px]"
                        title="Add a secret whose value is this file's path"
                      >
                        <Plus className="size-3" />
                        Use in secret
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Delete ${f.name}`}
                      disabled={busy !== null}
                      onClick={() => removeFile(f.name)}
                      className="btn-ghost px-2 py-1 text-fg-subtle hover:text-rose-300"
                    >
                      {busy === `rm:${f.name}` ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="text-[11px] text-fg-subtle">
            File contents are never shown again after upload. Back up secrets separately: scheduled backups include function
            code but not secrets.
          </div>
        </>
      )}
    </section>
  );
}
