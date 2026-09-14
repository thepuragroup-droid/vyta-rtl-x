'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Plus, Save, Trash2, ClipboardList, TrendingUp, AlertTriangle, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUserRole } from '../../layout';
import { canEdit } from '@/lib/permissions';
import {
  getVariantsByProduct,
  createVariant,
  updateVariant,
  deleteVariant,
  adjustInventory,
  getInventoryLog,
} from '@/lib/admin/inventory';
import type { ProductVariant, InventoryLog } from '@/lib/types/ecommerce';

interface ProductDetail {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  cost_price: number | null;
  sale_price: number | null;
  weight_grams: number | null;
  warehouse_location: string | null;
  is_active: boolean;
  supplier_id: string | null;
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userRole = useUserRole();
  const editable = canEdit(userRole);

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [log, setLog] = useState<InventoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Variant being edited/created
  const [editVariant, setEditVariant] = useState<Partial<ProductVariant> | null>(null);
  const [isNewVariant, setIsNewVariant] = useState(false);

  // Adjustment modal
  const [adjustTarget, setAdjustTarget] = useState<ProductVariant | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState<InventoryLog['reason']>('adjustment');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: prod } = await supabase
      .from('products')
      .select('id,name,sku,category,cost_price,sale_price,weight_grams,warehouse_location,is_active,active,supplier_id')
      .eq('id', id)
      .single();

    if (prod) {
      setProduct({ ...prod, is_active: prod.is_active ?? prod.active ?? true });
      const [vList, logList] = await Promise.all([
        getVariantsByProduct(id),
        getInventoryLog(undefined, 30),
      ]);
      setVariants(vList);
      setLog(logList.filter((l) => vList.some((v) => v.id === l.variant_id)));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function saveProduct() {
    if (!product) return;
    setSaving(true);
    await supabase
      .from('products')
      .update({
        sku: product.sku,
        cost_price: product.cost_price,
        sale_price: product.sale_price,
        weight_grams: product.weight_grams,
        warehouse_location: product.warehouse_location,
        is_active: product.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    setSaving(false);
    flash('Saved');
  }

  async function saveVariant() {
    if (!editVariant) return;
    setSaving(true);
    if (isNewVariant) {
      await createVariant({ ...editVariant as any, product_id: id });
    } else {
      await updateVariant(editVariant.id!, editVariant);
    }
    setEditVariant(null);
    await load();
    setSaving(false);
    flash(isNewVariant ? 'Variant added' : 'Variant saved');
  }

  async function handleDeleteVariant(variantId: string) {
    if (!confirm('Delete this variant? This cannot be undone.')) return;
    await deleteVariant(variantId);
    await load();
  }

  async function handleAdjust() {
    if (!adjustTarget) return;
    const qty = parseInt(adjustQty, 10);
    if (isNaN(qty) || qty === 0) return;
    setAdjusting(true);
    const result = await adjustInventory(adjustTarget.id, qty, adjustReason, {
      note: adjustNote || undefined,
    });
    setAdjusting(false);
    if (result.success) {
      setAdjustTarget(null);
      setAdjustQty('');
      setAdjustNote('');
      await load();
      flash('Inventory adjusted');
    } else {
      flash(result.error ?? 'Failed to adjust inventory');
    }
  }

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-ink-muted" /></div>;
  }

  if (!product) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted mb-4">Product not found</p>
        <Link href="/admin/inventory" className="text-bronze hover:text-bronze/80 text-sm">Back to Inventory</Link>
      </div>
    );
  }

  return (
    <>
      {/* Back + Title */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/inventory" className="text-ink-muted hover:text-ink transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-ink">{product.name}</h1>
          {product.sku && <p className="text-xs font-mono text-ink-muted">{product.sku}</p>}
        </div>
      </div>

      {msg && (
        <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          {msg}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Product Details + Variants */}
        <div className="lg:col-span-2 space-y-6">
          {/* Product Fields */}
          {editable && (
            <div className="bg-white rounded-xl border border-line p-5">
              <h2 className="font-semibold text-ink mb-4 text-sm">Product Details</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'SKU', key: 'sku', type: 'text' },
                  { label: 'Cost Price ($)', key: 'cost_price', type: 'number' },
                  { label: 'Sale Price ($)', key: 'sale_price', type: 'number' },
                  { label: 'Weight (g)', key: 'weight_grams', type: 'number' },
                  { label: 'Warehouse Location', key: 'warehouse_location', type: 'text' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
                    <input
                      type={type}
                      value={(product as any)[key] ?? ''}
                      onChange={(e) =>
                        setProduct((p) => p ? {
                          ...p,
                          [key]: type === 'number' ? (e.target.value ? parseFloat(e.target.value) : null) : e.target.value,
                        } : p)
                      }
                      className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={product.is_active}
                    onChange={(e) => setProduct((p) => p ? { ...p, is_active: e.target.checked } : p)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="is_active" className="text-sm text-ink">Active</label>
                </div>
              </div>
              <button
                onClick={saveProduct}
                disabled={saving}
                className="mt-4 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            </div>
          )}

          {/* Variants */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-line">
              <h2 className="font-semibold text-ink text-sm">Variants</h2>
              {editable && (
                <button
                  onClick={() => { setIsNewVariant(true); setEditVariant({ product_id: id, qty_on_hand: 0, reorder_threshold: 5 }); }}
                  className="text-xs text-bronze hover:text-bronze/80 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Variant
                </button>
              )}
            </div>
            <div className="divide-y divide-line/50">
              {variants.length === 0 && (
                <p className="px-5 py-8 text-center text-ink-muted text-sm">No variants yet</p>
              )}
              {variants.map((v) => {
                const isLow = v.qty_on_hand < v.reorder_threshold;
                return (
                  <div key={v.id} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-ink">{v.option_name}: {v.option_value}</span>
                        {isLow && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                      <p className="text-xs font-mono text-ink-muted">{v.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-sm tabular-nums ${isLow ? 'text-amber-500' : 'text-ink'}`}>
                        {v.qty_on_hand}
                        <span className="font-normal text-ink-muted text-xs"> / {v.reorder_threshold} min</span>
                      </p>
                    </div>
                    {editable && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAdjustTarget(v)}
                          className="px-2.5 py-1.5 bg-surface border border-line rounded-lg text-xs text-ink-muted hover:text-ink transition-colors"
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setIsNewVariant(false); setEditVariant({ ...v }); }}
                          className="px-2.5 py-1.5 bg-surface border border-line rounded-lg text-xs text-ink-muted hover:text-ink transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteVariant(v.id)}
                          className="px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-500 hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Inventory Log */}
        <div>
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="flex items-center gap-2 p-5 border-b border-line">
              <ClipboardList className="w-4 h-4 text-ink-muted" />
              <h2 className="font-semibold text-ink text-sm">Inventory Log</h2>
            </div>
            <div className="divide-y divide-line/50 max-h-96 overflow-y-auto">
              {log.length === 0 && (
                <p className="px-5 py-8 text-center text-ink-muted text-sm">No log entries</p>
              )}
              {log.map((entry) => (
                <div key={entry.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold tabular-nums ${entry.change_qty > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {entry.change_qty > 0 ? '+' : ''}{entry.change_qty}
                    </span>
                    <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded bg-surface text-ink-muted">
                      {entry.reason}
                    </span>
                  </div>
                  {entry.note && <p className="text-xs text-ink-muted mt-0.5">{entry.note}</p>}
                  <p className="text-[10px] text-ink-muted mt-1">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Variant Edit Modal */}
      {editVariant && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl">
            <h3 className="font-bold text-ink mb-4">{isNewVariant ? 'Add Variant' : 'Edit Variant'}</h3>
            <div className="space-y-3">
              {[
                { label: 'SKU *', key: 'sku', type: 'text' },
                { label: 'Option Name (e.g. Size)', key: 'option_name', type: 'text' },
                { label: 'Option Value (e.g. 5mg)', key: 'option_value', type: 'text' },
                { label: 'Qty on Hand', key: 'qty_on_hand', type: 'number' },
                { label: 'Reorder Threshold', key: 'reorder_threshold', type: 'number' },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-ink-muted mb-1">{label}</label>
                  <input
                    type={type}
                    value={(editVariant as any)[key] ?? ''}
                    onChange={(e) =>
                      setEditVariant((v) => v ? {
                        ...v,
                        [key]: type === 'number' ? parseInt(e.target.value, 10) || 0 : e.target.value,
                      } : v)
                    }
                    className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditVariant(null)}
                className="flex-1 px-4 py-2 border border-line rounded-lg text-sm text-ink-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveVariant}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl">
            <h3 className="font-bold text-ink mb-1">Adjust Stock</h3>
            <p className="text-sm text-ink-muted mb-4">
              {adjustTarget.option_name}: {adjustTarget.option_value} — current: {adjustTarget.qty_on_hand}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Change Qty (+ add, − subtract)</label>
                <input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  placeholder="e.g. 10 or -5"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Reason</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value as InventoryLog['reason'])}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                >
                  <option value="adjustment">Adjustment</option>
                  <option value="restock">Restock</option>
                  <option value="sale">Sale</option>
                  <option value="return">Return</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setAdjustTarget(null); setAdjustQty(''); setAdjustNote(''); }}
                className="flex-1 px-4 py-2 border border-line rounded-lg text-sm text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjust}
                disabled={adjusting || !adjustQty || adjustQty === '0'}
                className="flex-1 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-50"
              >
                {adjusting ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
