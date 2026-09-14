'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, Search, Edit2, Trash2, Save, X, AlertCircle, Upload,
  Image as ImageIcon, Check, FileUp, FileText, Pencil, History,
  Package, Mail, Send, SlidersHorizontal, ChevronLeft, ChevronRight,
  Bell, Table2, Grid2x2, ChevronDown, TrendingUp, Calendar, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { appendAdminViewParam } from '@/lib/admin/admin-view';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { apiFetch } from '@/lib/api-fetch';
import type { Product } from '@/lib/supabase';
import { rankBySearch } from '@/lib/search';
import {
  DEFAULT_USD_RATE, productUsdPrice, formatMoney, vialPriceFor, vialsPerBoxOf,
  type PriceCurrency,
} from '@/lib/pricing';
import { currentWeekRange, toDateInput } from '@/lib/admin/stock-change-report';
import ProductHistoryPanel from './ProductHistoryPanel';
import CellEditGrid from './CellEditGrid';

interface ImportPreviewRow {
  slug: string;
  name: string;
  price: number;
  strength: string | null;
  description_short: string | null;
}

const PAGE_SIZE = 20;

type ReportCardKey = 'products' | 'stock' | 'lowout' | 'revenue';
type ReportColumnKey =
  | 'sku' | 'product' | 'strength' | 'price' | 'stock'
  | 'stockValue' | 'unitsSold' | 'revenue' | 'status';
type StockUnit = 'boxes' | 'vials';
type ReportGroupKey = 'catalog' | 'inventory' | 'pricing' | 'revenue';
type ReportStockStatus = 'all' | 'lowout' | 'low' | 'out';
type StockReportColumnKey =
  | 'sku' | 'description' | 'strength' | 'stock' | 'minQty' | 'onOrder' | 'needToOrder';

/**
 * The Products Report is customized by whole SECTIONS, not by individual
 * columns: an admin thinks "I want the pricing on this", not "I want column 4".
 * Each group contributes the cards and columns that make it legible on its own.
 */
const REPORT_GROUPS: Array<{
  key: ReportGroupKey;
  label: string;
  description: string;
  cards: ReportCardKey[];
  columns: ReportColumnKey[];
}> = [
  {
    key: 'catalog',
    label: 'Catalog',
    description: 'SKU, description, strength, product count & status',
    cards: ['products'],
    columns: ['sku', 'product', 'strength', 'status'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    description: 'Stock on hand plus low / out-of-stock counts',
    cards: ['stock', 'lowout'],
    columns: ['stock'],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    description: 'Unit price per product',
    cards: [],
    columns: ['price'],
  },
  {
    key: 'revenue',
    label: 'Revenue',
    description: 'Stock value, units sold & total revenue',
    cards: ['revenue'],
    columns: ['stockValue', 'unitsSold', 'revenue'],
  },
];

const REPORT_STOCK_STATUS: Array<{ key: ReportStockStatus; label: string; description: string }> = [
  { key: 'all',    label: 'All products',       description: 'No stock filter' },
  { key: 'lowout', label: 'Low or out of stock', description: 'At/under min or sold out' },
  { key: 'low',    label: 'Low stock only',     description: 'At or under the min quantity' },
  { key: 'out',    label: 'Out of stock only',  description: 'Zero stock on hand' },
];

const STOCK_REPORT_COLUMNS: Array<{ key: StockReportColumnKey; label: string; description: string }> = [
  { key: 'sku',         label: 'SKU',           description: 'Product slug / SKU code' },
  { key: 'description', label: 'Description',   description: 'Product name' },
  { key: 'strength',    label: 'Strength',      description: 'Dosage / strength' },
  { key: 'stock',       label: 'Stock',         description: 'Current stock on hand' },
  { key: 'minQty',      label: 'Min Quantity',  description: 'Low-stock threshold' },
  { key: 'onOrder',     label: 'On Order',      description: 'Units on open purchase orders' },
  { key: 'needToOrder', label: 'Need To Order', description: 'Units to reach the minimum' },
];

/** Flatten selected groups into card / column keys, in declaration order. */
function cardsFromGroups(groups: Record<ReportGroupKey, boolean>): ReportCardKey[] {
  return REPORT_GROUPS.filter((g) => groups[g.key]).flatMap((g) => g.cards);
}

function columnsFromGroups(groups: Record<ReportGroupKey, boolean>): ReportColumnKey[] {
  return REPORT_GROUPS.filter((g) => groups[g.key]).flatMap((g) => g.columns);
}

const ALL_GROUPS_ON: Record<ReportGroupKey, boolean> = {
  catalog: true, inventory: true, pricing: true, revenue: true,
};

const ALL_STOCK_COLUMNS_ON: Record<StockReportColumnKey, boolean> = {
  sku: true, description: true, strength: true,
  stock: true, minQty: true, onOrder: true, needToOrder: true,
};

const REPORT_CONFIG_KEY = 'aminocan.productReport.config';

type InlineField = 'price' | 'price_usd' | 'vial_price' | 'stock_quantity' | 'vials_per_box' | 'low_stock_threshold';

/** Compact "N boxes + M vials" formatter. */
function formatBoxes(vials: number, vialsPerBox: number): string {
  const v = Math.max(0, Math.floor(Number(vials) || 0));
  const per = Math.max(1, Math.floor(Number(vialsPerBox) || 10));
  if (v === 0) return '0 boxes';
  const boxes = Math.floor(v / per);
  const rem = v % per;
  if (boxes === 0) return `${rem} vial${rem === 1 ? '' : 's'}`;
  if (rem === 0) return `${boxes} box${boxes === 1 ? '' : 'es'}`;
  return `${boxes} box${boxes === 1 ? '' : 'es'} + ${rem}`;
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0);
}

export default function ProductsManagementPage() {
  const { canCreate, canEdit, canDelete, canEditProductDescriptors, userRole } = usePermissions();
  const isAdmin = userRole === 'admin';
  // Analytics/marketing editors may open the edit modal and change descriptor
  // (copy/image) fields only. `canEdit` (admin) still gates all commerce
  // fields, inline table editing, create, and delete.
  const canEditDescriptors = canEdit || canEditProductDescriptors;
  // A descriptor-only save skips commerce validation and sends a stripped
  // payload; the server re-strips authoritatively.
  const descriptorsOnly = !canEdit;

  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingStock, setDownloadingStock] = useState(false);
  const [downloadingChanges, setDownloadingChanges] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<{ id: string; field: InlineField; value: string } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<'details' | 'images'>('details');

  // View mode. 'table' is the full catalog table (all columns + row actions);
  // 'cells' swaps in the spreadsheet grid for bulk price/stock updates.
  // The grid stages its edits locally, so `gridDirty` guards leaving it.
  const [viewMode, setViewMode] = useState<'table' | 'cells'>('table');
  const [gridDirty, setGridDirty] = useState(0);

  // Currency toggle — CAD is the base price on every row; USD reads from
  // `products.price_usd` when set, otherwise `price × usdRate`.
  const [priceCurrency, setPriceCurrency] = useState<PriceCurrency>('CAD');
  const [usdRate, setUsdRate] = useState<number>(DEFAULT_USD_RATE);

  // Restock confirm dialog state
  const [restockConfirm, setRestockConfirm] = useState<{
    productName: string;
    emails: string[];
    onConfirm: () => void;
  } | null>(null);
  const [restockSaving, setRestockSaving] = useState(false);

  // CSV Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview'>('upload');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    csvPath: string;
    newProducts: ImportPreviewRow[];
    updateProducts: ImportPreviewRow[];
    skippedRows: number;
  } | null>(null);
  const [importConfirming, setImportConfirming] = useState(false);

  // ---- Reports menu + the four report modals ----
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showStockReportModal, setShowStockReportModal] = useState(false);
  const [showChangeReportModal, setShowChangeReportModal] = useState(false);

  // Products Report config. Prices are always the catalog's own, in CAD —
  // there is one price per product, so there is nothing to choose here.
  const [reportGroups, setReportGroups] = useState<Record<ReportGroupKey, boolean>>(ALL_GROUPS_ON);
  const [reportStockStatus, setReportStockStatus] = useState<ReportStockStatus>('all');

  // Stock display — SHARED by all three downloads, edited from two modals.
  const [stockUnit, setStockUnit] = useState<StockUnit>('boxes');
  const [showRemainder, setShowRemainder] = useState(true);

  // Stock Report config
  const [stockShowCards, setStockShowCards] = useState(true);
  const [stockShowOnOrder, setStockShowOnOrder] = useState(true);
  const [stockColumns, setStockColumns] =
    useState<Record<StockReportColumnKey, boolean>>(ALL_STOCK_COLUMNS_ON);

  // Stock Change Report — the date range is not persisted (it is a question
  // about *now*, and a stale saved range would silently print the wrong week).
  const [changeRange, setChangeRange] = useState<{ from: string; to: string }>(() => currentWeekRange());

  const reportConfigLoaded = useRef(false);

  // Stock Report email schedule modal (admin only)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleSending, setScheduleSending] = useState(false);
  const [schedule, setSchedule] = useState<{
    enabled: boolean;
    recipients: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    lastSentAt: string | null;
  }>({ enabled: false, recipients: '', frequency: 'weekly', lastSentAt: null });

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    price_usd: '',
    vial_price: '',
    stock_quantity: '',
    vials_per_box: '10',
    category: '',
    image_url: '',
    box_image_url: '',
    strength: '',
    purity: '',
    form: '',
    featured: false,
    active: true,
    is_checkout_addon: false,
    slug: '',
    sku: '',
    description_short: '',
    benefits: '',
    mechanism: '',
    coa_urls: [] as string[],
    low_stock_threshold: '10',
  });

  useEffect(() => {
    fetchProducts();
    // Pull the USD exchange rate from site settings so USD-mode prices are
    // consistent across the admin + storefront.
    (async () => {
      try {
        const token = await getToken();
        const res = await apiFetch<{ settings?: any }>(`/api/admin/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        const rate = Number(res?.settings?.usd_exchange_rate);
        if (Number.isFinite(rate) && rate > 0) setUsdRate(rate);
      } catch {
        /* fall back to DEFAULT_USD_RATE */
      }
    })();
    // Restore the saved report config. Every field is validated before it is
    // applied, and the guard ref stops the save-effect below from writing the
    // defaults back over what we just loaded on first render.
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(REPORT_CONFIG_KEY) : null;
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg?.groups && typeof cfg.groups === 'object') {
          setReportGroups({
            ...ALL_GROUPS_ON,
            ...Object.fromEntries(
              REPORT_GROUPS.map((g) => [g.key, cfg.groups[g.key] !== false]),
            ),
          } as Record<ReportGroupKey, boolean>);
        }
        if (REPORT_STOCK_STATUS.some((o) => o.key === cfg?.reportStockStatus)) {
          setReportStockStatus(cfg.reportStockStatus);
        }
        if (cfg?.stockUnit === 'boxes' || cfg?.stockUnit === 'vials') setStockUnit(cfg.stockUnit);
        if (typeof cfg?.showRemainder === 'boolean') setShowRemainder(cfg.showRemainder);
        if (typeof cfg?.stockShowCards === 'boolean') setStockShowCards(cfg.stockShowCards);
        if (typeof cfg?.stockShowOnOrder === 'boolean') setStockShowOnOrder(cfg.stockShowOnOrder);
        if (cfg?.stockColumns && typeof cfg.stockColumns === 'object') {
          setStockColumns(
            Object.fromEntries(
              STOCK_REPORT_COLUMNS.map((c) => [c.key, cfg.stockColumns[c.key] !== false]),
            ) as Record<StockReportColumnKey, boolean>,
          );
        }
      }
    } catch {
      /* corrupt or blocked localStorage — fall back to the defaults */
    }
    reportConfigLoaded.current = true;
  }, []);

  useEffect(() => {
    if (!reportConfigLoaded.current) return;
    try {
      window.localStorage.setItem(
        REPORT_CONFIG_KEY,
        JSON.stringify({
          groups: reportGroups,
          reportStockStatus,
          stockUnit,
          showRemainder,
          stockShowCards,
          stockShowOnOrder,
          stockColumns,
        }),
      );
    } catch {
      /* localStorage disabled — no-op */
    }
  }, [
    reportGroups, reportStockStatus, stockUnit, showRemainder,
    stockShowCards, stockShowOnOrder, stockColumns,
  ]);

  // Debounce the search box so ranking doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to page 0 on new search.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery]);

  // Rank products by name (3) > category (1) > slug (1) > sku (1).
  // Empty query returns everything in fetch order.
  useEffect(() => {
    if (!debouncedQuery) {
      setFilteredProducts(products);
      return;
    }
    setFilteredProducts(
      rankBySearch(products, debouncedQuery, [
        { get: (p) => p.name, weight: 3 },
        { get: (p) => p.category, weight: 1 },
        { get: (p) => p.slug, weight: 1 },
        { get: (p) => p.sku, weight: 1 },
      ]),
    );
  }, [debouncedQuery, products]);

  const getToken = async () => {
    const { data: session } = await supabase.auth.getSession();
    return session.session?.access_token ?? '';
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const { products: data } = await apiFetch<{ products: Product[] }>('/api/admin/products', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProducts(data || []);
    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Failed to load products');
    }
    setLoading(false);
  };

  // ---- Report downloads ----
  // Shared stock-display params: one setting, three reports.
  const stockParams = () => ({
    stockUnit,
    boxRemainder: showRemainder ? '1' : '0',
  });

  /**
   * The one download primitive: open a tab, fetch the report, point the tab at
   * the result.
   *
   * The tab is opened SYNCHRONOUSLY inside the click — `window.open` after an
   * `await` has lost the click's user activation and the pop-up blocker eats
   * it (reliably in Safari, on a slow report in Chrome), leaving the admin to
   * click "Allow pop-ups" and start over. So the tab opens immediately holding
   * a placeholder and is navigated once the HTML arrives.
   */
  const openReport = async (
    path: string,
    setBusy: (v: boolean) => void,
    extra: Record<string, string> = {},
  ) => {
    setBusy(true);
    const tab = window.open('', '_blank');
    if (tab) {
      tab.document.write(
        '<!doctype html><title>Generating report…</title>' +
        '<body style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;' +
        'color:#56707F;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
        'Generating report…</body>',
      );
      tab.document.close();
    }
    try {
      const token = await getToken();
      const params = new URLSearchParams(extra);
      // The printed report is a print of what the admin is looking at, so the
      // page's search box always travels with it.
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const qs = appendAdminViewParam(params).toString();

      const response = await fetch(`${path}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        tab?.close();
        setError('Could not generate report');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    } catch (err) {
      console.error('Error downloading report:', err);
      tab?.close();
      setError('Could not generate report');
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    const extra: Record<string, string> = {
      cards: cardsFromGroups(reportGroups).join(','),
      cols: columnsFromGroups(reportGroups).join(','),
      ...stockParams(),
    };
    // Only send the stock filter when it actually narrows the report — the
    // default URL stays clean and readable.
    if (reportStockStatus !== 'all') extra.stockStatus = reportStockStatus;
    return openReport('/api/admin/products/report', setDownloading, extra);
  };

  const downloadStockReport = () =>
    openReport('/api/admin/products/stock-report', setDownloadingStock, {
      ...stockParams(),
      cards: stockShowCards ? '1' : '0',
      onOrder: stockShowOnOrder ? '1' : '0',
      cols: STOCK_REPORT_COLUMNS.filter((c) => stockColumns[c.key]).map((c) => c.key).join(','),
    });

  const downloadChangeReport = () =>
    openReport('/api/admin/products/stock-change-report', setDownloadingChanges, {
      from: changeRange.from,
      to: changeRange.to,
      ...stockParams(),
    });


  // ---- Storage helpers ----
  const extractFilePathFromUrl = (url: string, bucket: 'products' | 'certificates'): string | null => {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split(`/object/public/${bucket}/`);
      return pathParts[1] || null;
    } catch {
      return null;
    }
  };

  const deleteFileFromStorage = async (url: string, bucket: 'products' | 'certificates') => {
    const path = extractFilePathFromUrl(url, bucket);
    if (!path) return;
    try {
      const token = await getToken();
      const endpoint = bucket === 'products'
        ? '/api/admin/products/upload'
        : '/api/admin/products/upload-certificate';
      await apiFetch(`${endpoint}?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': '' },
      });
    } catch (err) {
      console.error(`Error deleting file from ${bucket} bucket:`, err);
    }
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'image_url' | 'box_image_url',
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please upload an image file'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Image must be less than 20MB'); return; }

    setUploading(true);
    setError('');
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('file', file);
      const { url } = await apiFetch<{ url: string }>('/api/admin/products/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      setFormData((prev) => ({ ...prev, [field]: url }));
    } catch (err: any) {
      setError(err.message || 'Failed to upload image');
    }
    e.target.value = '';
    setUploading(false);
  };

  const handleCertificateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const invalid = files.find((f) => f.type !== 'application/pdf');
    if (invalid) { setError('Please upload PDF files only'); return; }
    const tooBig = files.find((f) => f.size > 20 * 1024 * 1024);
    if (tooBig) { setError('Each PDF must be less than 20MB'); return; }

    setUploading(true);
    setError('');
    try {
      const token = await getToken();
      const uploaded: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          const { url } = await apiFetch<{ url: string }>('/api/admin/products/upload-certificate', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          });
          uploaded.push(url);
        } catch (err: any) {
          setError(err.message || 'Failed to upload certificate');
          setUploading(false);
          return;
        }
      }
      setFormData((prev) => ({ ...prev, coa_urls: [...prev.coa_urls, ...uploaded] }));
    } catch (err) {
      console.error('Error uploading certificate:', err);
      setError('Failed to upload certificate');
    }
    e.target.value = '';
    setUploading(false);
  };

  // ---- Create / Update ----
  const buildPayload = () => {
    const price = parseFloat(formData.price);
    const stockQuantity = parseInt(formData.stock_quantity, 10);
    const vialsPerBox = parseInt(formData.vials_per_box, 10);
    const lowStockThreshold = parseInt(formData.low_stock_threshold, 10);
    const priceUsdRaw = formData.price_usd.trim();
    const vialPriceRaw = formData.vial_price.trim();
    const priceUsd = priceUsdRaw === '' ? null : parseFloat(priceUsdRaw);
    const vialPrice = vialPriceRaw === '' ? null : parseFloat(vialPriceRaw);

    return {
      name: formData.name,
      description: formData.description || null,
      price,
      price_usd: priceUsd !== null && !isNaN(priceUsd) && priceUsd >= 0 ? priceUsd : null,
      vial_price: vialPrice !== null && !isNaN(vialPrice) && vialPrice >= 0 ? vialPrice : null,
      stock_quantity: stockQuantity,
      vials_per_box: isNaN(vialsPerBox) || vialsPerBox < 1 ? 10 : vialsPerBox,
      category: formData.category || null,
      image_url: formData.image_url || null,
      box_image_url: formData.box_image_url || null,
      strength: formData.strength || null,
      purity: formData.purity || null,
      form: formData.form || null,
      featured: formData.featured,
      active: formData.active,
      is_checkout_addon: formData.is_checkout_addon,
      slug: formData.slug || null,
      sku: formData.sku || null,
      description_short: formData.description_short || null,
      benefits: formData.benefits || null,
      mechanism: formData.mechanism || null,
      coa_url: formData.coa_urls.length > 0 ? formData.coa_urls : null,
      low_stock_threshold: isNaN(lowStockThreshold) ? 10 : lowStockThreshold,
      change_source: 'form',
    };
  };

  // Descriptor-only payload (copy + images). Excludes every commerce/visibility
  // field so a marketing editor's save can never touch price/stock/status. The
  // server re-strips authoritatively regardless of what the client sends.
  const buildDescriptorPayload = () => ({
    name: formData.name,
    slug: formData.slug || null,
    category: formData.category || null,
    description: formData.description || null,
    description_short: formData.description_short || null,
    benefits: formData.benefits || null,
    mechanism: formData.mechanism || null,
    strength: formData.strength || null,
    purity: formData.purity || null,
    form: formData.form || null,
    image_url: formData.image_url || null,
    box_image_url: formData.box_image_url || null,
    coa_url: formData.coa_urls.length > 0 ? formData.coa_urls : null,
    change_source: 'form',
  });

  const handleCreateOrUpdate = async () => {
    setError('');
    setSuccess('');

    // Descriptor-only editors (analytics) skip commerce validation entirely.
    if (descriptorsOnly) {
      if (!formData.name) { setError('Name is required'); return; }
      await doCreateOrUpdate();
      return;
    }

    if (!formData.name || !formData.price || formData.stock_quantity === '') {
      setError('Name, price, and stock quantity are required');
      return;
    }
    const price = parseFloat(formData.price);
    const stockQuantity = parseInt(formData.stock_quantity, 10);
    if (isNaN(price) || price < 0) { setError('Invalid price'); return; }
    if (isNaN(stockQuantity) || stockQuantity < 0) { setError('Invalid stock quantity'); return; }

    // Restock guard: editing an out-of-stock product to positive stock
    // may have waiters. Confirm first, then send.
    const goingBackInStock =
      !!editingProduct && editingProduct.stock_quantity <= 0 && stockQuantity > 0;
    if (goingBackInStock) {
      const waiters = await fetchWaiters(editingProduct.id);
      if (waiters.length > 0) {
        setRestockConfirm({
          productName: editingProduct.name,
          emails: waiters,
          onConfirm: async () => { await doCreateOrUpdate(); },
        });
        return;
      }
    }
    await doCreateOrUpdate();
  };

  const doCreateOrUpdate = async () => {
    try {
      const token = await getToken();
      const payload = descriptorsOnly ? buildDescriptorPayload() : buildPayload();
      const url = editingProduct
        ? `/api/admin/products/${editingProduct.id}`
        : '/api/admin/products';
      const method = editingProduct ? 'PATCH' : 'POST';
      await apiFetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      setSuccess(editingProduct ? 'Product updated successfully' : 'Product created successfully');
      setShowModal(false);
      resetForm();
      fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Failed to save product');
    }
  };

  const handleDelete = async () => {
    if (!deletingProduct) return;
    try {
      const token = await getToken();
      await apiFetch(`/api/admin/products/${deletingProduct.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': '' },
      });
      setSuccess('Product deleted successfully');
      setShowDeleteModal(false);
      setDeletingProduct(null);
      fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Failed to delete product');
    }
  };

  // Look up pending waiters for a product (used by both the inline stock
  // edit and the form-level restock guard).
  const fetchWaiters = async (productId: string): Promise<string[]> => {
    try {
      const token = await getToken();
      const data = await apiFetch<{ emails?: string[] }>(
        `/api/admin/stock-notifications?product_id=${productId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return data.emails ?? [];
    } catch {
      return [];
    }
  };

  const handleInlineSave = async () => {
    if (!inlineEdit) return;
    const raw = inlineEdit.value.trim();
    // vial_price / price_usd can be blanked out to fall back to auto.
    const canBlank = inlineEdit.field === 'vial_price' || inlineEdit.field === 'price_usd';
    if (canBlank && raw === '') {
      await commitInlineSave(inlineEdit.id, inlineEdit.field, null);
      return;
    }
    const num = inlineEdit.field === 'price' || inlineEdit.field === 'price_usd' || inlineEdit.field === 'vial_price'
      ? parseFloat(raw)
      : parseInt(raw, 10);
    if (isNaN(num) || num < 0) { setInlineEdit(null); return; }
    if (inlineEdit.field === 'vials_per_box' && num < 1) { setInlineEdit(null); return; }

    const product = products.find((p) => p.id === inlineEdit.id);
    if (!product) { setInlineEdit(null); return; }

    if (inlineEdit.field === 'stock_quantity' && product.stock_quantity <= 0 && num > 0) {
      const waiters = await fetchWaiters(inlineEdit.id);
      if (waiters.length > 0) {
        const captured = { ...inlineEdit, num };
        setRestockConfirm({
          productName: product.name,
          emails: waiters,
          onConfirm: async () => { await commitInlineSave(captured.id, captured.field, num); },
        });
        return;
      }
    }
    await commitInlineSave(inlineEdit.id, inlineEdit.field, num);
  };

  const commitInlineSave = async (id: string, field: InlineField, val: number | null) => {
    setInlineSaving(true);
    try {
      const token = await getToken();
      await apiFetch(`/api/admin/products/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: val, change_source: 'inline' }),
      });
      setProducts((prev) => prev.map((p) => p.id === id ? { ...p, [field]: val as any } : p));
    } catch (err) {
      console.error('Inline save failed:', err);
    }
    setInlineSaving(false);
    setInlineEdit(null);
  };

  // Leaving cell-edit mode with staged (unsaved) cells would silently drop
  // them, so make that an explicit choice.
  const switchViewMode = (mode: 'table' | 'cells') => {
    if (mode === viewMode) return;
    if (viewMode === 'cells' && gridDirty > 0) {
      const ok = window.confirm(
        `You have ${gridDirty} product${gridDirty === 1 ? '' : 's'} with unsaved cell edits. Leave anyway and discard them?`,
      );
      if (!ok) return;
      setGridDirty(0);
    }
    setInlineEdit(null);
    setViewMode(mode);
  };

  // Merge the rows the grid just PATCHed back into the page's product list so
  // the table view and the grid agree without a full refetch.
  const handleGridSaved = (updated: Product[]) => {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((p) => [p.id, p]));
    setProducts((prev) => prev.map((p) => byId.get(p.id) ?? p));
    setSuccess(`Updated ${updated.length} product${updated.length === 1 ? '' : 's'}`);
  };

  const confirmRestock = async () => {
    if (!restockConfirm) return;
    setRestockSaving(true);
    await restockConfirm.onConfirm();
    setRestockConfirm(null);
    setRestockSaving(false);
  };

  // ---- Modal open/close helpers ----
  const openCreateModal = () => {
    resetForm();
    setEditingProduct(null);
    setModalTab('details');
    setShowModal(true);
    setError('');
  };

  const openEditModal = (product: Product) => {
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      price_usd: product.price_usd != null ? String(product.price_usd) : '',
      vial_price: product.vial_price != null ? String(product.vial_price) : '',
      stock_quantity: product.stock_quantity.toString(),
      vials_per_box: (product.vials_per_box ?? 10).toString(),
      category: product.category || '',
      image_url: product.image_url || '',
      box_image_url: product.box_image_url || '',
      strength: product.strength || '',
      purity: product.purity || '',
      form: product.form || '',
      featured: product.featured,
      active: product.active,
      is_checkout_addon: product.is_checkout_addon ?? false,
      slug: product.slug || '',
      sku: product.sku || '',
      description_short: product.description_short || '',
      benefits: product.benefits || '',
      mechanism: product.mechanism || '',
      coa_urls: product.coa_url ?? [],
      low_stock_threshold: product.low_stock_threshold?.toString() ?? '10',
    });
    setEditingProduct(product);
    setModalTab('details');
    setShowModal(true);
    setError('');
  };

  const openDeleteModal = (product: Product) => {
    setDeletingProduct(product);
    setShowDeleteModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '', description: '', price: '', price_usd: '', vial_price: '',
      stock_quantity: '', vials_per_box: '10', category: '', image_url: '',
      box_image_url: '', strength: '', purity: '', form: '', featured: false,
      active: true, is_checkout_addon: false, slug: '', sku: '', description_short: '', benefits: '',
      mechanism: '', coa_urls: [], low_stock_threshold: '10',
    });
    setEditingProduct(null);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportStep('upload');
    setImportFile(null);
    setImportPreview(null);
    setError('');
  };

  const handleImportUpload = async () => {
    if (!importFile) { setError('Please select a CSV file'); return; }
    setImportLoading(true);
    setError('');
    try {
      const token = await getToken();
      const fd = new FormData();
      fd.append('file', importFile);
      const data = await apiFetch<typeof importPreview>('/api/admin/products/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      setImportPreview(data);
      setImportStep('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to analyze CSV');
    }
    setImportLoading(false);
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImportConfirming(true);
    setError('');
    try {
      const token = await getToken();
      const data = await apiFetch<{ inserted: number; updated: number }>('/api/admin/products/import', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          newProducts: importPreview.newProducts,
          updateProducts: importPreview.updateProducts,
          csvPath: importPreview.csvPath,
        }),
      });
      setSuccess(`Imported ${data.inserted} new and updated ${data.updated} products`);
      closeImportModal();
      fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Import failed');
    }
    setImportConfirming(false);
  };

  const downloadCsvTemplate = () => {
    const header = 'Code,Product Name,MG,Wholesale Price,CAD Price';
    const blob = new Blob([header + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Stock Report email schedule ----
  const openScheduleModal = async () => {
    setShowScheduleModal(true);
    setScheduleLoading(true);
    try {
      const token = await getToken();
      const res = await apiFetch<{ settings?: any }>('/api/admin/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const s = res?.settings ?? {};
      const recipients = Array.isArray(s.stock_report_email_recipients)
        ? (s.stock_report_email_recipients as string[]).join(', ')
        : '';
      setSchedule({
        enabled: !!s.stock_report_email_enabled,
        recipients,
        frequency: (s.stock_report_email_frequency as 'daily' | 'weekly' | 'monthly') ?? 'weekly',
        lastSentAt: s.stock_report_email_last_sent_at ?? null,
      });
    } catch (err) {
      console.error('Failed to load schedule:', err);
    }
    setScheduleLoading(false);
  };

  const saveSchedule = async () => {
    if (schedule.enabled && parseRecipients(schedule.recipients).length === 0) {
      setError('Add at least one recipient email to enable the schedule');
      return;
    }
    setScheduleSaving(true);
    try {
      const token = await getToken();
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          stock_report_email_enabled: schedule.enabled,
          stock_report_email_recipients: parseRecipients(schedule.recipients),
          stock_report_email_frequency: schedule.frequency,
        }),
      });
      setSuccess('Stock Report schedule saved');
      setShowScheduleModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule');
    }
    setScheduleSaving(false);
  };

  const sendScheduleNow = async () => {
    setScheduleSending(true);
    try {
      const token = await getToken();
      const recipients = parseRecipients(schedule.recipients);
      const res = await apiFetch<{ success: boolean; recipients: string[]; error?: string }>(
        '/api/admin/products/stock-report/send',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify(recipients.length > 0 ? { recipients } : {}),
        },
      );
      if (res.success) {
        setSuccess(`Stock Report sent to ${res.recipients.length} recipient${res.recipients.length === 1 ? '' : 's'}`);
      } else {
        setError(res.error || 'Failed to send stock report');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send stock report');
    }
    setScheduleSending(false);
  };

  const resetReportConfig = () => {
    setReportGroups(ALL_GROUPS_ON);
    setReportStockStatus('all');
    setStockUnit('boxes');
    setShowRemainder(true);
  };

  const resetStockReportConfig = () => {
    setStockUnit('boxes');
    setShowRemainder(true);
    setStockShowCards(true);
    setStockShowOnOrder(true);
    setStockColumns(ALL_STOCK_COLUMNS_ON);
  };

  // ---- Derived report state ----
  const selectedColumnCount = columnsFromGroups(reportGroups).length;
  const reportBusy = downloading || downloadingStock || downloadingChanges;

  // A report with no columns is nothing.
  const canDownloadReport = selectedColumnCount > 0;

  // ---- Derived pagination ----
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedProducts = filteredProducts.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filteredProducts.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filteredProducts.length, (safePage + 1) * PAGE_SIZE);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink mb-1">Products</h1>
          <p className="text-ink-muted text-sm">
            {canEdit
              ? 'Manage product catalog'
              : canEditDescriptors
                ? 'Edit product copy & images'
                : 'Product catalog (view only)'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Reports menu — all four report actions live behind one trigger */}
          <div className="relative">
            <button
              onClick={() => setShowReportsMenu((v) => !v)}
              disabled={reportBusy}
              aria-haspopup="true"
              aria-expanded={showReportsMenu}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 bg-white text-ink border border-line rounded-lg hover:bg-surface transition-all font-medium text-sm disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {reportBusy ? 'Generating…' : 'Reports'}
              <ChevronDown className={`w-4 h-4 transition-transform ${showReportsMenu ? 'rotate-180' : ''}`} />
            </button>

            {showReportsMenu && (
              <>
                {/* Click-away backdrop, behind the panel. */}
                <div className="fixed inset-0 z-10" onClick={() => setShowReportsMenu(false)} />
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white border border-line rounded-xl shadow-lg z-20 p-1.5">
                  <div className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Download a report
                  </div>

                  {/* Products Report — download + customize */}
                  <div className="flex items-stretch">
                    <button
                      onClick={() => { setShowReportsMenu(false); downloadReport(); }}
                      disabled={downloading || !canDownloadReport}
                      className="flex-1 flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <FileText className="w-4 h-4 text-teal-dark mt-0.5 flex-shrink-0" />
                      <span>
                        <span className="block text-sm font-medium text-ink">Products Report</span>
                        <span className="block text-xs text-ink-muted">Catalog, inventory &amp; pricing</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setShowReportsMenu(false); setShowReportModal(true); }}
                      title="Customize Products Report"
                      aria-label="Customize Products Report"
                      className="px-2.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stock Report — download + customize */}
                  <div className="flex items-stretch">
                    <button
                      onClick={() => { setShowReportsMenu(false); downloadStockReport(); }}
                      disabled={downloadingStock}
                      className="flex-1 flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Package className="w-4 h-4 text-teal-dark mt-0.5 flex-shrink-0" />
                      <span>
                        <span className="block text-sm font-medium text-ink">Stock Report</span>
                        <span className="block text-xs text-ink-muted">On-hand &amp; reorder levels</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setShowReportsMenu(false); setShowStockReportModal(true); }}
                      title="Customize Stock Report"
                      aria-label="Customize Stock Report"
                      className="px-2.5 rounded-lg text-ink-muted hover:bg-surface hover:text-ink"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Stock Changes — the date range makes its modal mandatory */}
                  <button
                    onClick={() => { setShowReportsMenu(false); setShowChangeReportModal(true); }}
                    disabled={downloadingChanges}
                    className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <TrendingUp className="w-4 h-4 text-teal-dark mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="block text-sm font-medium text-ink">Stock Changes</span>
                      <span className="block text-xs text-ink-muted">Movement over a date range</span>
                    </span>
                  </button>

                  {isAdmin && (
                    <>
                      <div className="my-1 border-t border-line/70" />
                      <button
                        onClick={() => { setShowReportsMenu(false); openScheduleModal(); }}
                        className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg hover:bg-surface"
                      >
                        <Mail className="w-4 h-4 text-ink-muted mt-0.5 flex-shrink-0" />
                        <span>
                          <span className="block text-sm font-medium text-ink">Email Schedule</span>
                          <span className="block text-xs text-ink-muted">Auto-email the Stock Report</span>
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {canCreate && (
            <>
              <button
                onClick={() => { setShowImportModal(true); setImportStep('upload'); }}
                className="inline-flex items-center gap-2 px-3 py-2.5 bg-surface text-ink border border-line rounded-lg hover:bg-line/50 transition-all font-medium text-sm justify-center"
              >
                <FileUp className="w-4 h-4" />
                Import CSV
              </button>
              <button
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 px-3 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm justify-center"
              >
                <Plus className="w-4 h-4" />
                Add Product
              </button>
            </>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-800">{error}</p>
          </div>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-emerald-800">{success}</p>
          </div>
          <button onClick={() => setSuccess('')} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search + currency toggle */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search products…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-surface rounded-xl border border-line focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-ink placeholder-ink-muted text-sm"
          />
        </div>
        {/* View mode — full table vs. spreadsheet cell editing */}
        <div className="inline-flex rounded-xl border border-line bg-surface p-1">
          <button
            onClick={() => switchViewMode('table')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'table' ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
            title="Full catalog table"
          >
            <Table2 className="w-4 h-4" />
            Table
          </button>
          <button
            onClick={() => switchViewMode('cells')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'cells' ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
            title="Spreadsheet-style price & stock editing"
          >
            <Grid2x2 className="w-4 h-4" />
            Cell edit
            {gridDirty > 0 && viewMode !== 'cells' && (
              <span className="ml-0.5 px-1.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold">
                {gridDirty}
              </span>
            )}
          </button>
        </div>
        {viewMode === 'table' && (
          <div className="inline-flex rounded-xl border border-line bg-surface p-1">
            {(['CAD', 'USD'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setPriceCurrency(c)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  priceCurrency === c ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                ${c}
              </button>
            ))}
          </div>
        )}
      </div>
      {viewMode === 'table' && priceCurrency === 'USD' && (
        <p className="-mt-3 mb-6 text-xs text-ink-muted">
          Showing USD prices (1 CAD ≈ ${usdRate.toFixed(3)} USD). Edit a USD price
          to override it; a blank USD price reverts to auto (CAD × rate).
        </p>
      )}

      {/* Products — spreadsheet grid (bulk price/stock) or the full table */}
      {viewMode === 'cells' ? (
        loading ? (
          <div className="bg-white rounded-xl border border-line p-12 flex items-center justify-center gap-3 text-sm text-ink-muted">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal" />
            Loading catalog…
          </div>
        ) : (
          <CellEditGrid
            products={filteredProducts}
            canEdit={canEdit}
            onSaved={handleGridSaved}
            onDirtyCountChange={setGridDirty}
          />
        )
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Case Price ({priceCurrency})
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">
                    Vial price ({priceCurrency})
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Stock (vials)</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Vials / Box</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Min Quantity</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => <ProductSkeletonRow key={i} />)
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-ink-muted text-sm">
                      No products found
                    </td>
                  </tr>
                ) : (
                  pagedProducts.map((product) => renderRow(product))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          {!loading && filteredProducts.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
              <span className="text-sm text-ink-muted">
                Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
                <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
                <span className="font-medium text-ink tabular-nums">{filteredProducts.length}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">Page {safePage + 1} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                  disabled={safePage + 1 >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && renderProductModal()}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deletingProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-ink">Delete Product</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-ink-muted hover:text-ink transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-6">
              Are you sure you want to delete <strong>{deletingProduct.name}</strong>? This
              action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-medium text-sm inline-flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restock Confirm Dialog (z-[60] so it can appear over the edit modal) */}
      {restockConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-teal/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-teal-dark" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-ink">Notify waitlist?</h2>
                <p className="text-xs text-ink-muted">{restockConfirm.productName}</p>
              </div>
              <button
                onClick={() => { setRestockConfirm(null); setInlineEdit(null); }}
                className="ml-auto text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-3">
              Restocking will email <strong>{restockConfirm.emails.length}</strong> waitlisted
              customer{restockConfirm.emails.length !== 1 ? 's' : ''}:
            </p>
            <ul className="max-h-48 overflow-y-auto border border-line rounded-lg divide-y divide-line/50 mb-6">
              {restockConfirm.emails.map((email) => (
                <li key={email} className="px-3 py-2 text-sm text-ink-muted">{email}</li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => { setRestockConfirm(null); setInlineEdit(null); }}
                className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmRestock}
                disabled={restockSaving}
                className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restockSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                Confirm &amp; notify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import — Step 1 */}
      {showImportModal && importStep === 'upload' && renderImportUpload()}

      {/* CSV Import — Step 2 */}
      {showImportModal && importStep === 'preview' && importPreview && renderImportPreview()}

      {/* Customize Report Modal */}
      {showReportModal && renderReportCustomizeModal()}

      {/* Customize Stock Report modal */}
      {showStockReportModal && renderStockReportCustomizeModal()}

      {/* Stock Change Report modal */}
      {showChangeReportModal && renderChangeReportModal()}

      {/* Stock Report email schedule modal */}
      {showScheduleModal && renderScheduleModal()}
    </>
  );

  // ---------- Row renderer ----------
  function renderRow(product: Product) {
    const usdPrice = productUsdPrice(product, usdRate);
    const cadVialFallback = vialPriceFor(product);
    const usdVial = cadVialFallback != null ? cadVialFallback * usdRate : 0;
    const vialsPerBox = vialsPerBoxOf(product.vials_per_box);

    const isInline = (field: InlineField) =>
      inlineEdit?.id === product.id && inlineEdit.field === field;

    return (
      <React.Fragment key={product.id}>
        <tr className={`hover:bg-surface transition-colors ${historyOpen === product.id ? 'bg-surface' : ''}`}>
          {/* Product cell — image + box image + name/slug */}
          <td className="px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name}
                    className="w-12 h-12 rounded-lg object-cover border border-line" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-surface border border-line flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-ink-muted" />
                  </div>
                )}
                {product.box_image_url && (
                  <img src={product.box_image_url} alt="Box"
                    className="w-12 h-12 rounded-lg object-cover border border-line"
                    title="Box / packaging image" />
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-ink">{product.name}</div>
                {product.slug && <div className="text-xs text-ink-muted">{product.slug}</div>}
              </div>
            </div>
          </td>

          {/* Price */}
          <td className="px-5 py-4 font-semibold text-ink tabular-nums">
            {priceCurrency === 'CAD' ? (
              renderInlineNumber({
                product, field: 'price',
                displayValue: `${formatMoney(product.price, 'CAD')}`,
                inputWidth: 'w-24', step: '0.01',
              })
            ) : (
              // USD cell — inline-editable only when a manual override exists
              // or the admin explicitly wants to set one. A blank input on
              // save reverts to auto (CAD × rate).
              isInline('price_usd') && canEdit ? (
                <input
                  type="number" step="0.01" min="0" autoFocus
                  placeholder="auto"
                  value={inlineEdit!.value}
                  onChange={(e) => setInlineEdit({ ...inlineEdit!, value: e.target.value })}
                  onBlur={handleInlineSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInlineSave();
                    if (e.key === 'Escape') setInlineEdit(null);
                  }}
                  className="w-24 px-2 py-1 border border-teal/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              ) : inlineSaving && isInline('price_usd') ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-teal" />
                  <span className="text-sm">{inlineEdit!.value || 'auto'}</span>
                </span>
              ) : (
                <button
                  disabled={!canEdit}
                  onClick={() => setInlineEdit({
                    id: product.id, field: 'price_usd',
                    value: product.price_usd != null ? String(product.price_usd) : '',
                  })}
                  className={`group inline-flex items-center gap-1 ${
                    canEdit
                      ? 'border-b border-dashed border-ink-muted/40 hover:border-teal hover:text-teal-dark cursor-pointer'
                      : ''
                  }`}
                  title={canEdit ? 'Click to override; blank to reset to auto' : ''}
                >
                  {formatMoney(usdPrice, 'USD')}
                  {product.price_usd == null && (
                    <span className="ml-1 text-[10px] font-medium text-ink-muted uppercase tracking-wide">auto</span>
                  )}
                  {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-teal-dark" />}
                </button>
              )
            )}
          </td>

          {/* Vial price */}
          <td className="px-5 py-4 text-sm tabular-nums">
            {priceCurrency === 'CAD' ? (
              isInline('vial_price') && canEdit ? (
                <input
                  type="number" step="0.01" min="0" autoFocus
                  placeholder="auto (from case price)"
                  value={inlineEdit!.value}
                  onChange={(e) => setInlineEdit({ ...inlineEdit!, value: e.target.value })}
                  onBlur={handleInlineSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleInlineSave();
                    if (e.key === 'Escape') setInlineEdit(null);
                  }}
                  className="w-28 px-2 py-1 border border-teal/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              ) : inlineSaving && isInline('vial_price') ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-teal" />
                  <span className="text-sm">{inlineEdit!.value || 'auto'}</span>
                </span>
              ) : (
                <button
                  disabled={!canEdit}
                  onClick={() => setInlineEdit({
                    id: product.id, field: 'vial_price',
                    value: product.vial_price != null ? String(product.vial_price) : '',
                  })}
                  className={`group inline-flex items-center gap-1 text-ink ${
                    canEdit
                      ? 'border-b border-dashed border-ink-muted/40 hover:border-teal hover:text-teal-dark cursor-pointer'
                      : ''
                  }`}
                  title={canEdit ? 'Click to override; blank to reset to auto' : ''}
                >
                  {formatMoney(cadVialFallback, 'CAD')}
                  {product.vial_price == null && (
                    <span className="ml-1 text-[10px] font-medium text-ink-muted uppercase tracking-wide">auto</span>
                  )}
                  {canEdit && <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-teal-dark" />}
                </button>
              )
            ) : (
              // USD vial price is derived — no per-vial USD override exists.
              <span className="inline-flex items-center gap-1 text-ink" title="Switch to CAD to edit">
                {formatMoney(usdVial, 'USD')}
                <span className="ml-1 text-[10px] font-medium text-ink-muted uppercase tracking-wide">auto</span>
              </span>
            )}
          </td>

          {/* Stock */}
          <td className="px-5 py-4">
            {renderInlineNumber({
              product, field: 'stock_quantity',
              displayValue: String(product.stock_quantity),
              inputWidth: 'w-20', step: '1',
              coloredByStock: true,
            })}
            <div className="text-[10px] text-ink-muted mt-0.5">
              {formatBoxes(product.stock_quantity, vialsPerBox)}
            </div>
          </td>

          {/* Vials / Box */}
          <td className="px-5 py-4 text-sm text-ink">
            {renderInlineNumber({
              product, field: 'vials_per_box',
              displayValue: String(vialsPerBox),
              inputWidth: 'w-16', step: '1', min: 1,
            })}
          </td>

          {/* Min Quantity (low_stock_threshold) */}
          <td className="px-5 py-4">
            {renderInlineNumber({
              product, field: 'low_stock_threshold',
              displayValue: `≤ ${product.low_stock_threshold ?? 0}`,
              inputWidth: 'w-20', step: '1',
              lowStockColor: true,
            })}
          </td>

          {/* Status */}
          <td className="px-5 py-4">
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
              product.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-ink-muted'
            }`}>
              {product.active ? 'Active' : 'Inactive'}
            </span>
            {product.featured && (
              <span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-teal/10 text-teal-dark">
                Featured
              </span>
            )}
          </td>

          {/* Actions */}
          <td className="px-5 py-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryOpen((cur) => (cur === product.id ? null : product.id))}
                className={`p-2 rounded-lg transition-colors ${
                  historyOpen === product.id
                    ? 'bg-teal/10 text-teal-dark'
                    : 'hover:bg-surface text-ink-muted hover:text-ink'
                }`}
                title="History"
                aria-expanded={historyOpen === product.id}
              >
                <History className="w-4 h-4" />
              </button>
              {canEditDescriptors && (
                <button
                  onClick={() => openEditModal(product)}
                  className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
              {canEdit && canDelete && (
                <button
                  onClick={() => openDeleteModal(product)}
                  className="p-2 hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </td>
        </tr>
        {historyOpen === product.id && (
          <tr>
            <td colSpan={8} className="px-5 pb-5 pt-0 bg-surface/40 border-b border-line">
              <div className="flex items-center gap-2 mb-3 text-sm font-medium text-ink">
                <History className="w-4 h-4 text-teal-dark" />
                Change history — {product.name}
              </div>
              <ProductHistoryPanel productId={product.id} />
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  }

  // Generic inline number cell — used for the numeric-only columns
  // (price, stock, vials/box, min-qty). Nullable fields (price_usd,
  // vial_price) render their own custom cell above.
  function renderInlineNumber(args: {
    product: Product;
    field: InlineField;
    displayValue: string;
    inputWidth: string;
    step: string;
    min?: number;
    coloredByStock?: boolean;
    lowStockColor?: boolean;
  }) {
    const { product, field, displayValue, inputWidth, step, min = 0 } = args;
    const isThis = inlineEdit?.id === product.id && inlineEdit.field === field;
    const rawVal = (product as any)[field] as number | null | undefined;
    const stockColor = args.coloredByStock
      ? Number(rawVal) > 10 ? 'text-emerald-600'
        : Number(rawVal) > 0 ? 'text-amber-600'
        : 'text-red-600'
      : '';
    const lowColor = args.lowStockColor
      ? product.stock_quantity <= (product.low_stock_threshold ?? 0) ? 'text-amber-600' : 'text-ink'
      : '';

    if (inlineSaving && isThis) {
      return (
        <div className="flex items-center gap-1.5 text-ink-muted">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-teal" />
          <span className="text-sm">{inlineEdit!.value}</span>
        </div>
      );
    }
    if (isThis && canEdit) {
      return (
        <input
          type="number" step={step} min={min} autoFocus
          value={inlineEdit!.value}
          onChange={(e) => setInlineEdit({ ...inlineEdit!, value: e.target.value })}
          onBlur={handleInlineSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleInlineSave();
            if (e.key === 'Escape') setInlineEdit(null);
          }}
          className={`${inputWidth} px-2 py-1 border border-teal/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal/40`}
        />
      );
    }
    if (canEdit) {
      return (
        <button
          onClick={() => setInlineEdit({
            id: product.id, field,
            value: rawVal != null ? String(rawVal) : '',
          })}
          className={`group inline-flex items-center gap-1 border-b border-dashed border-ink-muted/40 hover:border-teal hover:bg-teal/5 cursor-pointer text-sm font-medium ${stockColor} ${lowColor}`}
          title="Click to edit"
        >
          {displayValue}
          <Pencil className="w-3 h-3 text-ink-muted/40 group-hover:text-teal-dark" />
        </button>
      );
    }
    return (
      <span className={`text-sm font-medium ${stockColor} ${lowColor || 'text-ink'}`}>
        {displayValue}
      </span>
    );
  }

  // ---------- Product create/edit modal (two tabs) ----------
  function renderProductModal() {
    const imageCount = (formData.image_url ? 1 : 0) + (formData.box_image_url ? 1 : 0) + formData.coa_urls.length;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-4xl w-full p-4 sm:p-6 my-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-ink">
              {editingProduct ? 'Edit Product' : 'Add New Product'}
            </h2>
            <button onClick={() => setShowModal(false)} className="text-ink-muted hover:text-ink transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-line mb-4">
            <button
              onClick={() => setModalTab('details')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                modalTab === 'details' ? 'border-teal text-teal-dark' : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <FileText className="w-4 h-4" /> Details
            </button>
            <button
              onClick={() => setModalTab('images')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                modalTab === 'images' ? 'border-teal text-teal-dark' : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <ImageIcon className="w-4 h-4" /> Images &amp; Files
              {imageCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-semibold bg-teal/15 text-teal-dark rounded-full px-1">
                  {imageCount}
                </span>
              )}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto pr-2">
            {modalTab === 'images' ? renderImagesTab() : renderDetailsTab()}
          </div>

          <div className="flex gap-3 pt-6 mt-6 border-t border-line">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateOrUpdate}
              disabled={uploading}
              className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {editingProduct ? 'Update Product' : 'Create Product'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderImagesTab() {
    return (
      <div className="grid sm:grid-cols-2 gap-4">
        {renderImageDropzone('image_url', 'Product Image', 'Primary storefront image')}
        {renderImageDropzone('box_image_url', 'Box / Packaging Image', 'Shown on hover and for box pack sizes')}

        {/* COA PDFs */}
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-ink mb-2">
            Certificates of Analysis (COA — PDF)
            {formData.coa_urls.length > 0 && (
              <span className="ml-2 text-[10px] font-medium text-ink-muted normal-case">
                {formData.coa_urls.length} uploaded
              </span>
            )}
          </label>
          {formData.coa_urls.length > 0 && (
            <div className="space-y-2 mb-3">
              {formData.coa_urls.map((url, idx) => {
                const fileName = url.split('/').pop()?.split('?')[0] || `COA #${idx + 1}.pdf`;
                return (
                  <div key={url} className="flex items-center gap-3 border border-line rounded-lg p-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
                      <FileText className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink truncate">COA #{idx + 1}</p>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-teal-dark hover:underline">
                        View {decodeURIComponent(fileName)}
                      </a>
                    </div>
                    <button
                      onClick={async () => {
                        await deleteFileFromStorage(url, 'certificates');
                        setFormData((prev) => ({ ...prev, coa_urls: prev.coa_urls.filter((u) => u !== url) }));
                      }}
                      className="flex-shrink-0 p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="relative">
            <input
              type="file" accept="application/pdf" multiple
              onChange={handleCertificateUpload}
              disabled={uploading}
              className="hidden"
              id="certificate-upload"
            />
            <label
              htmlFor="certificate-upload"
              className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
            >
              {uploading ? (
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal mx-auto mb-1" />
                  <p className="text-xs text-ink-muted">Uploading...</p>
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-ink-muted mb-1" />
                  <p className="text-xs text-ink-muted">
                    {formData.coa_urls.length > 0 ? 'Add another COA' : 'Click to upload PDF certificate (max 20MB)'}
                  </p>
                </>
              )}
            </label>
          </div>
        </div>
      </div>
    );
  }

  function renderImageDropzone(
    field: 'image_url' | 'box_image_url',
    title: string,
    helper: string,
  ) {
    const url = formData[field];
    return (
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{title}</label>
        <p className="text-xs text-ink-muted mb-2">{helper}</p>
        {url ? (
          <div className="relative">
            <img src={url} alt={title} className="w-full h-48 object-cover rounded-lg border border-line" />
            <button
              onClick={async () => {
                await deleteFileFromStorage(url, 'products');
                setFormData((prev) => ({ ...prev, [field]: '' }));
              }}
              className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="file" accept="image/*"
              onChange={(e) => handleImageUpload(e, field)}
              disabled={uploading}
              className="hidden"
              id={`upload-${field}`}
            />
            <label
              htmlFor={`upload-${field}`}
              className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
            >
              {uploading ? (
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal mx-auto mb-2" />
                  <p className="text-sm text-ink-muted">Uploading...</p>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-ink-muted mb-2" />
                  <p className="text-sm text-ink-muted">Click to upload image (max 20MB)</p>
                </>
              )}
            </label>
          </div>
        )}
      </div>
    );
  }

  function renderDetailsTab() {
    return (
      <div className="space-y-4">
        {/* Name + Slug */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text" value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-ink text-sm"
              placeholder="Product name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Slug</label>
            <input
              type="text" value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-ink text-sm"
              placeholder="auto-generated if empty"
            />
          </div>
        </div>

        {/* SKU */}
        <div>
          <label className="block text-sm font-medium text-ink mb-2">SKU</label>
          <input
            type="text" value={formData.sku}
            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
            className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-ink text-sm"
            placeholder="e.g., SKU-001"
          />
        </div>

        {/* Pricing + stock (6 fields) — commerce fields, admin only. Hidden for
            descriptor-only (analytics) editors; the server also strips them. */}
        {canEdit && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Case Price (CAD) <span className="text-red-500">*</span>
            </label>
            <input
              type="number" step="0.01" min="0" value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Price (USD)</label>
            <input
              type="number" step="0.01" min="0" value={formData.price_usd}
              onChange={(e) => setFormData({ ...formData, price_usd: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="auto"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Leave blank to auto-calculate (CAD × {usdRate.toFixed(3)}).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Vial Price</label>
            <input
              type="number" step="0.01" min="0" value={formData.vial_price}
              onChange={(e) => setFormData({ ...formData, vial_price: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="auto"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Single-vial price. Leave blank to derive it from the case
              price (case price ÷ vials per box).
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              Stock (vials) <span className="text-red-500">*</span>
            </label>
            <input
              type="number" min="0" value={formData.stock_quantity}
              onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Vials per Box</label>
            <input
              type="number" min="1" value={formData.vials_per_box}
              onChange={(e) => setFormData({ ...formData, vials_per_box: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="10"
            />
            <p className="mt-1 text-[11px] text-ink-muted">Defaults to 10.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Low Stock Alert Threshold</label>
            <input
              type="number" min="0" value={formData.low_stock_threshold}
              onChange={(e) => setFormData({ ...formData, low_stock_threshold: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="10"
            />
          </div>
        </div>
        )}

        {/* Category & Strength */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Category</label>
            <input
              type="text" value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="e.g., Peptides"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Strength</label>
            <input
              type="text" value={formData.strength}
              onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="e.g., 5mg"
            />
          </div>
        </div>

        {/* Purity & Form */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Purity</label>
            <input
              type="text" value={formData.purity}
              onChange={(e) => setFormData({ ...formData, purity: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="e.g., 99%"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-2">Form</label>
            <input
              type="text" value={formData.form}
              onChange={(e) => setFormData({ ...formData, form: e.target.value })}
              className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              placeholder="e.g., Lyophilized Powder"
            />
          </div>
        </div>

        {/* Descriptions */}
        <div>
          <label className="block text-sm font-medium text-ink mb-2">Short Description</label>
          <textarea
            value={formData.description_short}
            onChange={(e) => setFormData({ ...formData, description_short: e.target.value })}
            rows={2}
            className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
            placeholder="Brief product description"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-2">Full Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
            placeholder="Detailed product description"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-2">Benefits</label>
          <textarea
            value={formData.benefits}
            onChange={(e) => setFormData({ ...formData, benefits: e.target.value })}
            rows={2}
            className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-2">Mechanism</label>
          <textarea
            value={formData.mechanism}
            onChange={(e) => setFormData({ ...formData, mechanism: e.target.value })}
            rows={2}
            className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg text-ink text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
        </div>

        {/* Featured / Active / Checkout add-on — visibility toggles, admin only. */}
        {canEdit && (
        <div className="flex gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={formData.featured}
              onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
              className="w-4 h-4 text-teal-dark bg-surface border-line rounded focus:ring-teal/40"
            />
            <span className="text-sm font-medium text-ink">Featured Product</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={formData.active}
              onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
              className="w-4 h-4 text-teal-dark bg-surface border-line rounded focus:ring-teal/40"
            />
            <span className="text-sm font-medium text-ink">Active</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={formData.is_checkout_addon}
              onChange={(e) => setFormData({ ...formData, is_checkout_addon: e.target.checked })}
              className="w-4 h-4 text-teal-dark bg-surface border-line rounded focus:ring-teal/40"
            />
            <span className="text-sm font-medium text-ink">Checkout add-on</span>
          </label>
        </div>
        )}
      </div>
    );
  }

  // ---------- CSV Import modals ----------
  function renderImportUpload() {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-ink">Import Products from CSV</h2>
            <button onClick={closeImportModal} className="text-ink-muted hover:text-ink transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="mb-3">
            <input
              type="file" accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="hidden" id="csv-import-upload"
            />
            <label
              htmlFor="csv-import-upload"
              className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors"
            >
              {importFile ? (
                <>
                  <FileUp className="w-8 h-8 text-teal-dark mb-2" />
                  <p className="text-sm font-medium text-ink">{importFile.name}</p>
                  <p className="text-xs text-ink-muted mt-1">
                    {(importFile.size / 1024).toFixed(1)} KB — click to change
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-ink-muted mb-2" />
                  <p className="text-sm text-ink-muted">Click to upload CSV (max 5 MB)</p>
                  <p className="text-xs text-ink-muted mt-1">
                    Required columns: Code, Product Name, MG, Wholesale Price, CAD Price
                  </p>
                </>
              )}
            </label>
          </div>
          <div className="mb-5 text-center">
            <button onClick={downloadCsvTemplate} className="text-xs text-teal-dark hover:underline inline-flex items-center gap-1">
              <FileText className="w-3 h-3" />
              Download template
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={closeImportModal}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleImportUpload}
              disabled={!importFile || importLoading}
              className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Analyzing...
                </>
              ) : (
                <>
                  <FileUp className="w-4 h-4" />
                  Analyze CSV
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderImportPreview() {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-3xl w-full p-6 my-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-ink">Confirm Import</h2>
            <button onClick={closeImportModal} className="text-ink-muted hover:text-ink transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-3 mb-5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 text-sm font-medium">
              <Plus className="w-3.5 h-3.5" />
              {importPreview!.newProducts.length} New
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal/10 text-teal-dark text-sm font-medium">
              <Edit2 className="w-3.5 h-3.5" />
              {importPreview!.updateProducts.length} Updates
            </span>
            {importPreview!.skippedRows > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 text-sm font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {importPreview!.skippedRows} Skipped (no Code)
              </span>
            )}
          </div>
          <div className="border border-line rounded-xl overflow-hidden mb-6">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="bg-surface border-b border-line">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Slug</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Strength</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {[
                    ...importPreview!.newProducts.map((p) => ({ ...p, _status: 'new' as const })),
                    ...importPreview!.updateProducts.map((p) => ({ ...p, _status: 'update' as const })),
                  ].map((row) => (
                    <tr key={row.slug} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-2.5">
                        {row._status === 'new' ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-700">New</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-teal/10 text-teal-dark">Update</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-muted font-mono">{row.slug}</td>
                      <td className="px-4 py-2.5 text-ink font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{row.strength || '—'}</td>
                      <td className="px-4 py-2.5 text-ink tabular-nums">${row.price.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => { setImportStep('upload'); setError(''); }}
              className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
            >
              Back
            </button>
            <button
              onClick={handleImportConfirm}
              disabled={importConfirming}
              className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importConfirming ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Importing...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm Import
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Customize Report Modal ----------
  // ---------- Shared modal fragments ----------

  /** Boxes/vials + leftover-vials toggle. Shared by two modals, one state. */
  function renderStockDisplayBlock() {
    return (
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Stock display</label>
        <p className="text-xs text-ink-muted mb-2">
          Applies to every report on this page (Products, Stock, Stock Changes).
        </p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: 'boxes' as StockUnit, label: 'Boxes', description: 'e.g. 24 boxes' },
            { key: 'vials' as StockUnit, label: 'Vials', description: 'e.g. 243 vials' },
          ]).map((opt) => {
            const on = stockUnit === opt.key;
            return (
              <label
                key={opt.key}
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  on ? 'border-teal bg-teal-50' : 'border-line hover:bg-surface'
                }`}
              >
                <input
                  type="radio" name="stockUnit" checked={on}
                  onChange={() => setStockUnit(opt.key)}
                  className="mt-0.5 w-4 h-4 border-line text-teal-dark focus:ring-teal/40"
                />
                <div>
                  <div className="text-sm font-medium text-ink">{opt.label}</div>
                  <div className="text-xs text-ink-muted">{opt.description}</div>
                </div>
              </label>
            );
          })}
        </div>
        <label
          className={`mt-2 flex items-start gap-2.5 p-3 rounded-lg border border-line transition-colors ${
            stockUnit === 'boxes' ? 'hover:bg-surface cursor-pointer' : 'opacity-50 cursor-not-allowed'
          }`}
        >
          <input
            type="checkbox"
            checked={showRemainder}
            disabled={stockUnit !== 'boxes'}
            onChange={(e) => setShowRemainder(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
          />
          <div className="text-sm text-ink">
            Show leftover vials in parentheses (e.g. 24 boxes (3 vials))
          </div>
        </label>
      </div>
    );
  }

  // ---------- Customize Products Report ----------
  function renderReportCustomizeModal() {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-lg w-full p-6 my-8">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-teal-dark" /> Customize Report
            </h2>
            <button
              onClick={() => setShowReportModal(false)}
              aria-label="Close"
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            Choose what the Products Report shows.
          </p>

          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
            {/* ---- Report sections ---- */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-ink">Report sections</label>
                <div className="text-xs">
                  <button
                    onClick={() => setReportGroups(ALL_GROUPS_ON)}
                    className="text-teal-dark hover:underline mr-2"
                  >
                    All
                  </button>
                  <button
                    onClick={() =>
                      setReportGroups({ catalog: false, inventory: false, pricing: false, revenue: false })
                    }
                    className="text-ink-muted hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {REPORT_GROUPS.map((g) => {
                  const on = reportGroups[g.key];
                  return (
                    <label
                      key={g.key}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                        on ? 'border-teal bg-teal-50' : 'border-line hover:bg-surface'
                      }`}
                    >
                      <input
                        type="checkbox" checked={on}
                        onChange={() => setReportGroups({ ...reportGroups, [g.key]: !on })}
                        className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
                      />
                      <div>
                        <div className="text-sm font-medium text-ink">{g.label}</div>
                        <div className="text-xs text-ink-muted">{g.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedColumnCount === 0 && (
                <p className="mt-2 text-xs text-red-600">Select at least one section to download.</p>
              )}
            </div>

            {/* ---- Stock status ---- */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Stock status</label>
              <div className="grid grid-cols-2 gap-2">
                {REPORT_STOCK_STATUS.map((opt) => {
                  const on = reportStockStatus === opt.key;
                  return (
                    <label
                      key={opt.key}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                        on ? 'border-teal bg-teal-50' : 'border-line hover:bg-surface'
                      }`}
                    >
                      <input
                        type="radio" name="reportStockStatus" checked={on}
                        onChange={() => setReportStockStatus(opt.key)}
                        className="mt-0.5 w-4 h-4 border-line text-teal-dark focus:ring-teal/40"
                      />
                      <div>
                        <div className="text-sm font-medium text-ink">{opt.label}</div>
                        <div className="text-xs text-ink-muted">{opt.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {renderStockDisplayBlock()}
          </div>

          <div className="flex items-center justify-between gap-2 pt-6 mt-6 border-t border-line">
            <button onClick={resetReportConfig} className="text-sm text-ink-muted hover:text-ink">
              Reset to defaults
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowReportModal(false); downloadReport(); }}
                disabled={downloading || !canDownloadReport}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Download Report
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Customize Stock Report ----------
  function renderStockReportCustomizeModal() {
    const noColumns = STOCK_REPORT_COLUMNS.every((c) => !stockColumns[c.key]);
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-md w-full p-6 my-8">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <Package className="w-5 h-5 text-teal-dark" /> Customize Stock Report
            </h2>
            <button
              onClick={() => setShowStockReportModal(false)}
              aria-label="Close"
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            On-hand and reorder levels. No pricing — safe to share with the warehouse.
          </p>

          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
            {renderStockDisplayBlock()}

            <div className="space-y-2">
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors">
                <input
                  type="checkbox" checked={stockShowCards}
                  onChange={(e) => setStockShowCards(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
                />
                <div>
                  <div className="text-sm font-medium text-ink">Summary cards</div>
                  <div className="text-xs text-ink-muted">Totals across the top of the report</div>
                </div>
              </label>
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors">
                <input
                  type="checkbox" checked={stockShowOnOrder}
                  onChange={(e) => setStockShowOnOrder(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
                />
                <div>
                  <div className="text-sm font-medium text-ink">&quot;On Order&quot; explanation footer</div>
                  <div className="text-xs text-ink-muted">
                    Which purchase orders the numbers came from
                  </div>
                </div>
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Columns
                </span>
                <div className="text-xs">
                  <button
                    onClick={() => setStockColumns(ALL_STOCK_COLUMNS_ON)}
                    className="text-teal-dark hover:underline mr-2"
                  >
                    All
                  </button>
                  <button
                    onClick={() =>
                      setStockColumns(
                        Object.fromEntries(
                          STOCK_REPORT_COLUMNS.map((c) => [c.key, false]),
                        ) as Record<StockReportColumnKey, boolean>,
                      )
                    }
                    className="text-ink-muted hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {STOCK_REPORT_COLUMNS.map((c) => {
                  const on = stockColumns[c.key];
                  return (
                    <label
                      key={c.key}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                        on ? 'border-teal bg-teal-50' : 'border-line hover:bg-surface'
                      }`}
                    >
                      <input
                        type="checkbox" checked={on}
                        onChange={() => setStockColumns({ ...stockColumns, [c.key]: !on })}
                        className="mt-0.5 w-4 h-4 rounded border-line text-teal-dark focus:ring-teal/40"
                      />
                      <div>
                        <div className="text-sm font-medium text-ink">{c.label}</div>
                        <div className="text-xs text-ink-muted">{c.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {noColumns && (
                <p className="mt-2 text-xs text-amber-600">
                  No columns selected — the report will include all columns.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-6 mt-6 border-t border-line">
            <button onClick={resetStockReportConfig} className="text-sm text-ink-muted hover:text-ink">
              Reset to defaults
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setShowStockReportModal(false)}
                className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowStockReportModal(false); downloadStockReport(); }}
                disabled={downloadingStock}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <Package className="w-4 h-4" /> Download Stock Report
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Stock Change Report ----------
  function renderChangeReportModal() {
    const setPreset = (from: Date, to: Date) =>
      setChangeRange({ from: toDateInput(from), to: toDateInput(to) });
    const today = new Date();
    const daysAgo = (n: number) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);

    const presets: Array<{ label: string; apply: () => void }> = [
      { label: 'This week', apply: () => setChangeRange(currentWeekRange()) },
      { label: 'Last 7 days', apply: () => setPreset(daysAgo(6), today) },
      { label: 'Last 30 days', apply: () => setPreset(daysAgo(29), today) },
      {
        label: 'This month',
        apply: () => setPreset(new Date(today.getFullYear(), today.getMonth(), 1), today),
      },
    ];

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-md w-full p-6 my-8">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-dark" /> Stock Changes
            </h2>
            <button
              onClick={() => setShowChangeReportModal(false)}
              aria-label="Close"
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-ink-muted mb-5">
            How stock moved over a date range. Products that did not move are left out.
          </p>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">From</label>
                <input
                  type="date"
                  value={changeRange.from}
                  max={changeRange.to}
                  onChange={(e) => setChangeRange({ ...changeRange, from: e.target.value })}
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">To</label>
                <input
                  type="date"
                  value={changeRange.to}
                  min={changeRange.from}
                  onChange={(e) => setChangeRange({ ...changeRange, to: e.target.value })}
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={p.apply}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink"
                >
                  <Calendar className="w-3.5 h-3.5" /> {p.label}
                </button>
              ))}
            </div>

            {renderStockDisplayBlock()}
          </div>

          <div className="flex items-center justify-end gap-2 pt-6 mt-6 border-t border-line">
            <button
              onClick={() => setShowChangeReportModal(false)}
              className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowChangeReportModal(false); downloadChangeReport(); }}
              disabled={downloadingChanges || !changeRange.from || !changeRange.to}
              className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4" /> Download Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Stock Report email schedule ----------
  function renderScheduleModal() {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-xl max-w-lg w-full p-6 my-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-ink flex items-center gap-2">
              <Mail className="w-5 h-5 text-teal-dark" /> Stock Report Email
            </h2>
            <button
              onClick={() => setShowScheduleModal(false)}
              aria-label="Close"
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-ink-muted mb-4">
            Automatically email the Stock Report (no pricing) on a schedule.
          </p>

          {scheduleLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-teal-dark" />
            </div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={schedule.enabled}
                  onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
                  className="mt-1"
                />
                <div>
                  <span className="text-sm font-medium text-ink">Enable scheduled email</span>
                  <p className="text-[11px] text-ink-muted">
                    When on, a cron job will email the report at the chosen frequency.
                  </p>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Recipients</label>
                <input
                  type="text" value={schedule.recipients}
                  onChange={(e) => setSchedule({ ...schedule, recipients: e.target.value })}
                  placeholder="warehouse@aminocan.com, buyer@aminocan.com"
                  className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
                />
                <p className="mt-1 text-[11px] text-ink-muted">
                  Separate multiple addresses with commas.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Frequency</label>
                <div className="inline-flex rounded-lg border border-line bg-surface p-1">
                  {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setSchedule({ ...schedule, frequency: f })}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                        schedule.frequency === f
                          ? 'bg-ink text-white shadow-sm'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">
                  Sent around 8am (server time) on the chosen cadence.
                  {schedule.lastSentAt && (
                    <> Last sent {new Date(schedule.lastSentAt).toLocaleString()}.</>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6 pt-4 border-t border-line">
            <button
              onClick={sendScheduleNow}
              disabled={scheduleSending || scheduleLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white text-ink border border-line rounded-lg hover:bg-surface transition-all font-medium text-sm disabled:opacity-50"
            >
              {scheduleSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Send now
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveSchedule}
                disabled={scheduleSaving || scheduleLoading}
                className="px-4 py-2 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                {scheduleSaving ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function ProductSkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-surface" />
          <div>
            <div className="h-4 w-32 bg-surface rounded mb-1.5" />
            <div className="h-3 w-20 bg-surface rounded" />
          </div>
        </div>
      </td>
      <td className="px-5 py-4"><div className="h-4 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-10 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-12 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-12 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-5 w-16 bg-surface rounded-full" /></td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-surface rounded-lg" />
          <div className="w-8 h-8 bg-surface rounded-lg" />
          <div className="w-8 h-8 bg-surface rounded-lg" />
        </div>
      </td>
    </tr>
  );
}
