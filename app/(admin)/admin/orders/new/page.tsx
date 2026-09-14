'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { createAdminOrder } from '@/lib/admin/orders-extended';
import { getOrCreateInvoiceForOrder } from '@/lib/admin/invoices';
import type { Customer } from '@/lib/supabase';
import type { ShippingAddress } from '@/lib/types/ecommerce';

interface OrderItemDraft {
  product_variant_id: string;
  sku_snapshot: string;
  name_snapshot: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
}

interface VariantOption {
  id: string;
  sku: string;
  option_name: string;
  option_value: string;
  qty_on_hand: number;
  product_name: string;
  product_id: string;
  unit_price: number;
}

const emptyAddress = (): ShippingAddress => ({
  firstName: '', lastName: '', address: '', city: '',
  state: '', postalCode: '', country: 'CA', phone: '',
});

export default function NewOrderPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [shippingAddr, setShippingAddr] = useState<ShippingAddress>(emptyAddress());
  const [billingAddr, setBillingAddr] = useState<ShippingAddress>(emptyAddress());
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [shippingMethod, setShippingMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [staffNotes, setStaffNotes] = useState('');

  const [items, setItems] = useState<OrderItemDraft[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantSearch, setVariantSearch] = useState('');
  const [showVariantPicker, setShowVariantPicker] = useState(false);

  const [taxPct, setTaxPct] = useState(13);
  const [shippingCost, setShippingCost] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('customers').select('id,first_name,last_name,email').eq('active', true).order('first_name')
      .then(({ data }) => setCustomers(data ?? []));

    supabase
      .from('product_variants')
      .select(`
        id, sku, option_name, option_value, qty_on_hand,
        products (id, name, sale_price, price)
      `)
      .order('option_value')
      .then(({ data }) =>
        setVariants(
          (data ?? []).map((v: any) => ({
            id: v.id,
            sku: v.sku,
            option_name: v.option_name,
            option_value: v.option_value,
            qty_on_hand: v.qty_on_hand,
            product_id: v.products?.id ?? '',
            product_name: v.products?.name ?? 'Product',
            unit_price: v.products?.sale_price ?? v.products?.price ?? 0,
          }))
        )
      );
  }, []);

  function addVariant(v: VariantOption) {
    const existing = items.findIndex((i) => i.product_variant_id === v.id);
    if (existing !== -1) {
      setItems((prev) =>
        prev.map((i, idx) => idx === existing ? { ...i, qty: i.qty + 1 } : i)
      );
    } else {
      setItems((prev) => [
        ...prev,
        {
          product_variant_id: v.id,
          sku_snapshot: v.sku,
          name_snapshot: `${v.product_name} — ${v.option_name}: ${v.option_value}`,
          qty: 1,
          unit_price: v.unit_price,
          discount_pct: 0,
        },
      ]);
    }
    setShowVariantPicker(false);
    setVariantSearch('');
  }

  function updateItem(index: number, field: keyof OrderItemDraft, value: string | number) {
    setItems((prev) => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAddr(
    setter: React.Dispatch<React.SetStateAction<ShippingAddress>>,
    field: keyof ShippingAddress,
    value: string
  ) {
    setter((a) => ({ ...a, [field]: value }));
  }

  function AddrField({
    label, field, addr, setter, required,
  }: {
    label: string;
    field: keyof ShippingAddress;
    addr: ShippingAddress;
    setter: React.Dispatch<React.SetStateAction<ShippingAddress>>;
    required?: boolean;
  }) {
    return (
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">
          {label}{required && ' *'}
        </label>
        <input
          type="text"
          value={addr[field] ?? ''}
          onChange={(e) => updateAddr(setter, field, e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
        />
      </div>
    );
  }

  const lineItems = items.map((i) => ({
    ...i,
    line_total: i.unit_price * i.qty * (1 - i.discount_pct / 100),
  }));
  const subtotal = lineItems.reduce((s, i) => s + i.line_total, 0);
  const taxTotal = subtotal * (taxPct / 100);
  const total = subtotal + taxTotal + shippingCost;

  const filteredVariants = variants.filter((v) => {
    if (!variantSearch) return true;
    const q = variantSearch.toLowerCase();
    return (
      v.product_name.toLowerCase().includes(q) ||
      v.sku.toLowerCase().includes(q) ||
      v.option_value.toLowerCase().includes(q)
    );
  });

  async function handleSubmit() {
    if (items.length === 0) { setError('Add at least one item'); return; }
    if (!shippingAddr.address || !shippingAddr.city) { setError('Shipping address is required'); return; }
    setSaving(true);
    setError('');

    const result = await createAdminOrder({
      customer_id: customerId || undefined,
      billing_address: sameAsBilling ? shippingAddr : billingAddr,
      shipping_address: shippingAddr,
      shipping_method: shippingMethod || undefined,
      notes: notes || undefined,
      staff_notes: staffNotes || undefined,
      items: lineItems.map((i) => ({
        product_variant_id: i.product_variant_id || undefined,
        sku_snapshot: i.sku_snapshot,
        name_snapshot: i.name_snapshot,
        qty: i.qty,
        unit_price: i.unit_price,
        discount_pct: i.discount_pct,
      })),
    });

    if (!result.success) {
      setSaving(false);
      setError(result.error ?? 'Failed to create order');
      return;
    }

    // Orders and invoices are merged under /admin/invoices — every order gets a
    // draft invoice, so land on that invoice (the single surface) rather than
    // the hidden order detail page. Fall back to the order page if the invoice
    // lookup somehow fails.
    const orderId = result.order?.id;
    if (orderId) {
      const inv = await getOrCreateInvoiceForOrder(orderId);
      setSaving(false);
      if (inv.success && inv.invoice_id) {
        router.push(`/admin/invoices/${inv.invoice_id}`);
        return;
      }
      router.push(`/admin/orders/${orderId}`);
      return;
    }
    setSaving(false);
    router.push('/admin/invoices');
  }

  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/invoices" className="text-ink-muted hover:text-ink transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-ink">New Order</h1>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Customer */}
          <div className="bg-white rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4 text-sm">Customer</h2>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                if (e.target.value) {
                  const c = customers.find((cu) => cu.id === e.target.value);
                  if (c) {
                    setShippingAddr((a) => ({
                      ...a,
                      firstName: c.first_name,
                      lastName: c.last_name,
                      address: c.shipping_address ?? '',
                      city: c.shipping_city ?? '',
                      state: c.shipping_state ?? '',
                      postalCode: c.shipping_postal_code ?? '',
                      country: c.shipping_country ?? 'CA',
                      phone: c.phone ?? '',
                    }));
                  }
                }
              }}
              className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
            >
              <option value="">— Walk-in / Offline Customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} ({c.email})
                </option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-line">
              <h2 className="font-semibold text-ink text-sm">Order Items</h2>
              <button
                onClick={() => setShowVariantPicker(true)}
                className="text-xs text-teal-dark hover:text-teal-dark/80 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>
            {items.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-ink-muted text-sm mb-3">No items added</p>
                <button
                  onClick={() => setShowVariantPicker(true)}
                  className="text-sm text-teal-dark hover:text-teal-dark/80"
                >
                  + Add a product variant
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface">
                      <th className="px-4 py-2 text-left text-xs text-ink-muted font-semibold">Item</th>
                      <th className="px-4 py-2 text-center text-xs text-ink-muted font-semibold w-16">Qty</th>
                      <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold w-24">Price</th>
                      <th className="px-4 py-2 text-center text-xs text-ink-muted font-semibold w-16">Disc%</th>
                      <th className="px-4 py-2 text-right text-xs text-ink-muted font-semibold w-24">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {lineItems.map((li, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3">
                          <p className="text-ink text-sm">{li.name_snapshot}</p>
                          <p className="text-xs font-mono text-ink-muted">{li.sku_snapshot}</p>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="1"
                            value={li.qty}
                            onChange={(e) => updateItem(i, 'qty', parseInt(e.target.value) || 1)}
                            className="w-full px-2 py-1 bg-surface rounded border border-line text-sm text-center"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={li.unit_price}
                            onChange={(e) => updateItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-surface rounded border border-line text-sm text-right"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={li.discount_pct}
                            onChange={(e) => updateItem(i, 'discount_pct', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-surface rounded border border-line text-sm text-center"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          ${li.line_total.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4 text-sm">Shipping Address</h2>
            <div className="grid grid-cols-2 gap-3">
              <AddrField label="First Name" field="firstName" addr={shippingAddr} setter={setShippingAddr} required />
              <AddrField label="Last Name" field="lastName" addr={shippingAddr} setter={setShippingAddr} />
              <div className="col-span-2">
                <AddrField label="Address" field="address" addr={shippingAddr} setter={setShippingAddr} required />
              </div>
              <AddrField label="City" field="city" addr={shippingAddr} setter={setShippingAddr} required />
              <AddrField label="State / Province" field="state" addr={shippingAddr} setter={setShippingAddr} />
              <AddrField label="Postal Code" field="postalCode" addr={shippingAddr} setter={setShippingAddr} />
              <AddrField label="Country" field="country" addr={shippingAddr} setter={setShippingAddr} />
              <div className="col-span-2">
                <AddrField label="Phone" field="phone" addr={shippingAddr} setter={setShippingAddr} />
              </div>
            </div>
          </div>

          {/* Billing Address */}
          <div className="bg-white rounded-xl border border-line p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-ink text-sm">Billing Address</h2>
              <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => setSameAsBilling(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                Same as shipping
              </label>
            </div>
            {!sameAsBilling && (
              <div className="grid grid-cols-2 gap-3">
                <AddrField label="First Name" field="firstName" addr={billingAddr} setter={setBillingAddr} />
                <AddrField label="Last Name" field="lastName" addr={billingAddr} setter={setBillingAddr} />
                <div className="col-span-2">
                  <AddrField label="Address" field="address" addr={billingAddr} setter={setBillingAddr} />
                </div>
                <AddrField label="City" field="city" addr={billingAddr} setter={setBillingAddr} />
                <AddrField label="State / Province" field="state" addr={billingAddr} setter={setBillingAddr} />
                <AddrField label="Postal Code" field="postalCode" addr={billingAddr} setter={setBillingAddr} />
                <AddrField label="Country" field="country" addr={billingAddr} setter={setBillingAddr} />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-line p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Customer Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">Staff Notes (internal)</label>
              <textarea
                value={staffNotes}
                onChange={(e) => setStaffNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
            </div>
          </div>
        </div>

        {/* Right: Summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-line p-5">
            <h2 className="font-semibold text-ink mb-4 text-sm">Order Summary</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Shipping Method</label>
                <input
                  type="text"
                  value={shippingMethod}
                  onChange={(e) => setShippingMethod(e.target.value)}
                  placeholder="e.g. Canada Post Xpresspost"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Tax Rate (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={taxPct}
                  onChange={(e) => setTaxPct(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">Shipping Cost ($)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-4 space-y-2">
              {[
                { label: 'Subtotal', value: subtotal },
                { label: `Tax (${taxPct}%)`, value: taxTotal },
                { label: 'Shipping', value: shippingCost },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-ink-muted">{label}</span>
                  <span className="tabular-nums text-ink">${value.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-base pt-2 border-t border-line">
                <span>Total</span>
                <span className="tabular-nums">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving || items.length === 0}
            className="w-full px-4 py-3 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create Order
          </button>
        </div>
      </div>

      {/* Variant Picker Modal */}
      {showVariantPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-line">
              <h3 className="font-bold text-ink">Select Product Variant</h3>
              <button onClick={() => { setShowVariantPicker(false); setVariantSearch(''); }}>
                <Trash2 className="w-4 h-4 text-ink-muted" />
              </button>
            </div>
            <div className="p-4 border-b border-line">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={variantSearch}
                  onChange={(e) => setVariantSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-10 pr-4 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-line/50">
              {filteredVariants.length === 0 && (
                <p className="px-4 py-8 text-center text-ink-muted text-sm">No variants found</p>
              )}
              {filteredVariants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => addVariant(v)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface transition-colors text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{v.product_name}</p>
                    <p className="text-xs text-ink-muted">{v.option_name}: {v.option_value} · {v.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums text-ink">${v.unit_price.toFixed(2)}</p>
                    <p className={`text-xs ${v.qty_on_hand < 5 ? 'text-amber-500' : 'text-ink-muted'}`}>
                      {v.qty_on_hand} in stock
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
