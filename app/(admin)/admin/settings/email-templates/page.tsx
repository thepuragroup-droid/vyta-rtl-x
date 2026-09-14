'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, AlertCircle, Check, RotateCcw } from 'lucide-react';
import { supabase, type SiteSettings } from '@/lib/supabase';
import { useUserRole } from '../../layout';
import {
  MERGE_VARS, renderTemplate,
  DEFAULT_CUSTOMER_SUBJECT, DEFAULT_CUSTOMER_BODY,
  DEFAULT_ADMIN_SUBJECT, DEFAULT_ADMIN_BODY,
} from '@/lib/invoice-email-templates';

type TemplateKind = 'customer' | 'admin';

const sampleVars = MERGE_VARS.reduce<Record<string, string>>((acc, v) => {
  acc[v.token] = v.sample;
  return acc;
}, {});

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function EmailTemplatesPage() {
  const userRole = useUserRole();
  const isReadOnly = userRole !== 'admin';

  const [tab, setTab] = useState<TemplateKind>('customer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [custSubject, setCustSubject] = useState('');
  const [custBody, setCustBody] = useState('');
  const [adminSubject, setAdminSubject] = useState('');
  const [adminBody, setAdminBody] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        const json = await res.json();
        const s: SiteSettings = json.settings;
        setCustSubject(s.invoice_customer_email_subject ?? DEFAULT_CUSTOMER_SUBJECT);
        setCustBody(s.invoice_customer_email_body ?? DEFAULT_CUSTOMER_BODY);
        setAdminSubject(s.invoice_admin_email_subject ?? DEFAULT_ADMIN_SUBJECT);
        setAdminBody(s.invoice_admin_email_body ?? DEFAULT_ADMIN_BODY);
      } catch {
        setError('Failed to load templates');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const subject = tab === 'customer' ? custSubject : adminSubject;
  const body = tab === 'customer' ? custBody : adminBody;
  const setSubject = tab === 'customer' ? setCustSubject : setAdminSubject;
  const setBody = tab === 'customer' ? setCustBody : setAdminBody;

  const previewSubject = useMemo(() => renderTemplate(subject, sampleVars), [subject]);
  const previewBody = useMemo(() => renderTemplate(body, sampleVars), [body]);

  const insertToken = (token: string) => {
    if (isReadOnly) return;
    setBody(`${body}{{${token}}}`);
  };

  const resetActive = () => {
    if (isReadOnly) return;
    if (tab === 'customer') {
      setCustSubject(DEFAULT_CUSTOMER_SUBJECT);
      setCustBody(DEFAULT_CUSTOMER_BODY);
    } else {
      setAdminSubject(DEFAULT_ADMIN_SUBJECT);
      setAdminBody(DEFAULT_ADMIN_BODY);
    }
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          invoice_customer_email_subject: custSubject,
          invoice_customer_email_body: custBody,
          invoice_admin_email_subject: adminSubject,
          invoice_admin_email_body: adminBody,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setSuccess('Templates saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [custSubject, custBody, adminSubject, adminBody]);

  if (loading) {
    return <div className="text-center py-20 text-sm text-ink-muted">Loading templates…</div>;
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/settings"
            className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-ink">Invoice Email Templates</h1>
            <p className="text-sm text-ink-muted">Edit the customer and admin invoice emails.</p>
          </div>
        </div>
        {!isReadOnly && (
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl p-4 bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl p-4 bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          <Check className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-6 border-b border-line">
        {(['customer', 'admin'] as TemplateKind[]).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`pb-2 text-sm font-medium capitalize transition-colors ${
              tab === k ? 'border-b-2 border-teal text-ink' : 'text-ink-muted hover:text-ink'
            }`}>
            {k} email
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-line p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5">Subject</label>
              <input type="text" value={subject} disabled={isReadOnly}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5">Body</label>
              <textarea value={body} disabled={isReadOnly} rows={12}
                onChange={(e) => setBody(e.target.value)}
                className="w-full px-4 py-2.5 bg-surface rounded-lg border border-line text-sm text-ink font-mono focus:outline-none focus:ring-2 focus:ring-teal/40 disabled:opacity-50" />
            </div>
            {!isReadOnly && (
              <button onClick={resetActive}
                className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
                <RotateCcw className="w-3.5 h-3.5" /> Reset to default
              </button>
            )}
          </div>

          {/* Merge vars */}
          <div className="bg-white rounded-xl border border-line p-5">
            <p className="text-xs font-medium text-ink-muted uppercase tracking-wider mb-3">Merge variables</p>
            <div className="flex flex-wrap gap-2">
              {MERGE_VARS.map((v) => (
                <button key={v.token} onClick={() => insertToken(v.token)} disabled={isReadOnly}
                  title={v.description}
                  className="px-2.5 py-1 rounded-md bg-teal/10 text-teal-dark font-mono text-xs hover:bg-teal/20 disabled:opacity-50">
                  {`{{${v.token}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="bg-white rounded-xl border border-line overflow-hidden h-fit">
          <div className="p-4 border-b border-line">
            <p className="text-xs font-medium text-ink-muted uppercase tracking-wider">Live preview</p>
          </div>
          <div className="p-5">
            <p className="text-xs text-ink-muted">Subject</p>
            <p className="font-semibold text-ink mb-4">{previewSubject}</p>
            <p className="text-xs text-ink-muted">Body</p>
            <div className="text-sm text-ink whitespace-pre-wrap mt-1">{previewBody}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
