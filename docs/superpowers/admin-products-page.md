# Admin Products Page — Architecture & Style Guide

> Reference document for replicating this pattern in other projects.
> Source: `app/(admin)/admin/products/page.tsx`

---

## Overview

A full CRUD admin page for managing a product catalog. Features:
- Searchable data table with inline editing for price and stock
- Create / Edit modal with file uploads (image + PDFs)
- Delete confirmation modal
- Two-step CSV import (analyze → preview → confirm)
- Role-based permission gating throughout

---

## File Map

```
app/(admin)/admin/products/page.tsx       — main page component (client)
app/api/admin/products/route.ts           — GET (list) + POST (create)
app/api/admin/products/[id]/route.ts      — PUT (update) + DELETE
app/api/admin/products/upload/route.ts    — POST (image upload) + DELETE (image removal)
app/api/admin/products/upload-certificate/route.ts — POST (PDF upload) + DELETE
app/api/admin/products/import/route.ts    — POST (analyze CSV) + PUT (confirm import)
lib/permissions.ts                        — role capability functions
lib/hooks/usePermissions.ts              — React hook wrapping permissions
```

---

## Permission System

### `lib/permissions.ts`

Three roles: `'customer' | 'assistant' | 'admin'`

| Capability | customer | assistant | admin |
|---|---|---|---|
| `canAccessAdmin` | ❌ | ✅ | ✅ |
| `canEdit` | ❌ | ❌ | ✅ |
| `canCreate` | ❌ | ❌ | ✅ |
| `canDelete` | ❌ | ❌ | ✅ |

Assistants can view the admin panel but cannot mutate anything. All four functions take a `UserRole` string and return boolean.

### `lib/hooks/usePermissions.ts`

```ts
const { canCreate, canEdit, canDelete, userRole } = usePermissions();
```

Reads the role from the admin layout context (`useUserRole()`) and maps it through the permission functions. Call this once at the top of the page component.

### API-side verification

Every API route runs its own independent `verifyAdminRole(request)` function — it reads the `Authorization: Bearer <token>` header, calls `supabase.auth.getUser(token)` with the service role key, then queries the `customers` table for the role. The client-side permission check is for UX only; the API is the real guard.

```
GET    /api/admin/products        → admin OR assistant
POST   /api/admin/products        → admin only (requireMutation: true)
PUT    /api/admin/products/[id]   → admin only
DELETE /api/admin/products/[id]   → admin only
```

---

## State Shape

```ts
// Table data
const [products, setProducts] = useState<Product[]>([]);
const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
const [loading, setLoading] = useState(true);
const [searchQuery, setSearchQuery] = useState('');

// Modals
const [showModal, setShowModal] = useState(false);           // create/edit
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [showImportModal, setShowImportModal] = useState(false);

// Modal state
const [editingProduct, setEditingProduct] = useState<Product | null>(null);
const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

// Feedback
const [error, setError] = useState('');
const [success, setSuccess] = useState('');

// File uploads
const [uploading, setUploading] = useState(false);

// Inline editing (price and stock_quantity only)
const [inlineEdit, setInlineEdit] = useState<{
  id: string;
  field: 'price' | 'stock_quantity';
  value: string;
} | null>(null);
const [inlineSaving, setInlineSaving] = useState(false);

// CSV import
const [importStep, setImportStep] = useState<'upload' | 'preview'>('upload');
const [importFile, setImportFile] = useState<File | null>(null);
const [importLoading, setImportLoading] = useState(false);
const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
const [importConfirming, setImportConfirming] = useState(false);
```

The form state is a flat object covering all editable product fields. `coa_urls` is a string array (one entry per uploaded PDF):

```ts
const [formData, setFormData] = useState({
  name, description, price, stock_quantity, category,
  image_url, strength, purity, form, featured, active,
  slug, description_short, benefits, mechanism,
  coa_urls: [] as string[],
});
```

---

## Page Layout

```
Header row (title + action buttons)
  ↓
Alert banners (error / success — dismissible)
  ↓
Search bar
  ↓
Data table
  ↓
[Modals rendered in portal — fixed inset-0]
  ├─ Create/Edit modal
  ├─ Delete confirmation modal
  └─ CSV Import modal (2 steps)
```

### Header pattern

```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-2xl font-bold text-ink mb-1">Product Management</h1>
    <p className="text-ink-muted text-sm">Manage product catalog</p>
  </div>
  {canCreate && (
    <div className="flex items-center gap-2">
      <button /* secondary */ className="... bg-surface border border-line ...">
        <FileUp /> Import CSV
      </button>
      <button /* primary */ className="... bg-ink text-white ...">
        <Plus /> Add Product
      </button>
    </div>
  )}
</div>
```

Secondary button: `bg-surface text-ink border border-line hover:bg-line/50`
Primary button: `bg-ink text-white hover:bg-ink/90`

### Alert banner pattern

```tsx
{error && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
    <div className="flex-1"><p className="text-sm text-red-800">{error}</p></div>
    <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
  </div>
)}
```

Success uses `bg-emerald-50 border-emerald-200` and `<Check />` icon. Both are manually dismissible via the × button.

---

## Data Table

```
bg-white rounded-xl border border-line overflow-hidden
  → overflow-x-auto wrapper
    → <table className="w-full">
      → <thead> bg-surface
        → th: px-5 py-3, text-xs font-semibold text-ink-muted uppercase tracking-wider
      → <tbody className="divide-y divide-line/50">
        → tr: hover:bg-surface transition-colors
          → td: px-5 py-4
```

Loading and empty states both use a single `<tr>` spanning all columns:
```tsx
<td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
  Loading... / No products found
</td>
```

### Stock quantity colour coding

```ts
product.stock_quantity > 10  → text-emerald-600   (healthy)
product.stock_quantity > 0   → text-amber-600     (low)
product.stock_quantity === 0 → text-red-600       (out of stock)
```

### Status badges

```tsx
// Active/Inactive
<span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
  product.active
    ? 'bg-emerald-500/10 text-emerald-600'
    : 'bg-gray-500/10 text-ink-muted'
}`}>

// Featured (second badge, shown alongside Active)
<span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-bronze/10 text-bronze">
  Featured
</span>
```

### Actions column

```tsx
{canEdit ? (
  <>
    <button onClick={() => openEditModal(product)}
      className="p-2 hover:bg-surface rounded-lg transition-colors text-ink-muted hover:text-ink">
      <Edit2 className="w-4 h-4" />
    </button>
    {canDelete && (
      <button onClick={() => openDeleteModal(product)}
        className="p-2 hover:bg-red-50 rounded-lg transition-colors text-ink-muted hover:text-red-600">
        <Trash2 className="w-4 h-4" />
      </button>
    )}
  </>
) : (
  <span className="text-xs text-ink-muted">View only</span>
)}
```

---

## Inline Editing

Price and stock can be edited directly in the table row without opening the modal. The pattern:

**Display state** — value shown as clickable text (only when `canEdit`):
```tsx
<span
  onClick={() => canEdit && setInlineEdit({ id: product.id, field: 'price', value: product.price.toString() })}
  className={canEdit ? 'cursor-pointer hover:text-bronze transition-colors' : ''}
  title={canEdit ? 'Click to edit' : undefined}
>
  ${product.price.toFixed(2)}
</span>
```

**Editing state** — replaces the span with a small input:
```tsx
<input
  type="number"
  value={inlineEdit.value}
  autoFocus
  onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
  onBlur={handleInlineSave}           // save on focus loss
  onKeyDown={(e) => {
    if (e.key === 'Enter') handleInlineSave();
    if (e.key === 'Escape') setInlineEdit(null);  // discard
  }}
  className="w-24 px-2 py-1 border border-bronze/60 rounded text-sm focus:outline-none focus:ring-2 focus:ring-bronze/40"
/>
```

**Saving state** — shown while the API call is in flight:
```tsx
<div className="flex items-center gap-1.5 text-ink-muted">
  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-bronze" />
  <span className="text-sm tabular-nums">${parseFloat(inlineEdit.value).toFixed(2)}</span>
</div>
```

The `inlineEdit` state holds `{ id, field, value }`. Only one cell is editable at a time. On save, the local `products` array is updated optimistically.

---

## Create / Edit Modal

**Structure:**
```
fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto
  → bg-white rounded-xl max-w-2xl w-full p-6 my-8
    → header (title + × close)
    → inline error banner (if any)
    → scrollable field area: max-h-[60vh] overflow-y-auto pr-2
      → Image upload
      → COA PDF upload (multi-file)
      → Text fields
      → Checkboxes
    → sticky footer: border-t border-line pt-6 mt-6
      → Cancel + Save buttons (flex gap-3, each flex-1)
```

**Opening the modal:**
- Create: call `resetForm()` then `setShowModal(true)` — `editingProduct` is null
- Edit: call `openEditModal(product)` which maps the product into `formData` and sets `editingProduct`

The same modal and `handleCreateOrUpdate` function handles both. The API call is `POST /api/admin/products` for create and `PUT /api/admin/products/[id]` for update.

### Image upload field

Uses a hidden `<input type="file">` with a styled `<label>` as the clickable target. The input id and label `htmlFor` must match.

```tsx
// No image yet — show drop zone
<label htmlFor="image-upload"
  className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface transition-colors">
  {uploading ? <spinner /> : <><Upload /><p>Click to upload image (max 20MB)</p></>}
</label>

// Image already set — show preview with remove button
<div className="relative">
  <img src={formData.image_url} className="w-full h-48 object-cover rounded-lg border border-line" />
  <button onClick={removeImage}
    className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
    <X />
  </button>
</div>
```

Upload goes to `POST /api/admin/products/upload` as `multipart/form-data`. Returns `{ url }`. Removal calls `DELETE /api/admin/products/upload?path=<encoded-path>`.

### COA (PDF) upload field

Similar pattern but allows multiple files and shows a list of already-uploaded PDFs. The upload button is always visible so you can keep adding files after some are already attached.

```tsx
// List of uploaded PDFs
{formData.coa_urls.map((url, idx) => (
  <div className="flex items-center gap-3 border border-line rounded-lg p-3">
    <div className="w-8 h-8 bg-red-50 rounded-lg ..."> {/* PDF icon */} </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium text-ink truncate">{fileName}</p>
      <a href={url} target="_blank" className="text-[10px] text-bronze hover:underline">View</a>
    </div>
    <button onClick={() => removeThisCoa(url)}><X /></button>
  </div>
))}

// Upload trigger (always visible below the list)
<label htmlFor="certificate-upload"
  className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface">
  {formData.coa_urls.length > 0 ? 'Add more COA PDFs' : 'Click to upload COA PDF(s)'}
</label>
```

### Form field pattern

All inputs follow the same structure:
```tsx
<div>
  <label className="block text-sm font-medium text-ink mb-2">
    Field Name <span className="text-red-500">*</span>  {/* required indicator */}
  </label>
  <input
    type="text"
    value={formData.fieldName}
    onChange={(e) => setFormData({ ...formData, fieldName: e.target.value })}
    className="w-full px-4 py-2.5 bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-bronze/40 focus:border-transparent text-ink text-sm"
    placeholder="..."
  />
</div>
```

Grid layouts for paired fields: `<div className="grid grid-cols-2 gap-4">`

Textareas use `rows={2}` or `rows={3}` and `resize-none`.

Checkboxes:
```tsx
<label className="flex items-center gap-2 cursor-pointer">
  <input type="checkbox" checked={formData.featured}
    onChange={(e) => setFormData({ ...formData, featured: e.target.checked })}
    className="w-4 h-4 text-bronze bg-surface border-line rounded focus:ring-bronze/40" />
  <span className="text-sm font-medium text-ink">Featured Product</span>
</label>
```

### Modal button footer pattern

```tsx
<div className="flex gap-3 pt-6 mt-6 border-t border-line">
  <button onClick={close}
    className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm">
    Cancel
  </button>
  <button onClick={handleSave}
    className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2">
    <Save className="w-4 h-4" />
    {editingProduct ? 'Update Product' : 'Create Product'}
  </button>
</div>
```

Danger action (delete modal):
```tsx
<button className="flex-1 ... bg-red-500 text-white hover:bg-red-600 ...">
  <Trash2 /> Delete Product
</button>
```

---

## Delete Confirmation Modal

Smaller modal (`max-w-md`), no scroll area. Pattern:
1. Show product name in bold inside warning text
2. Two buttons: Cancel (secondary) + Delete (red primary)
3. `deletingProduct` state holds the target; cleared on close or after successful delete

```tsx
<p className="text-sm text-ink-muted mb-6">
  Are you sure you want to delete <strong>{deletingProduct.name}</strong>?
  This action cannot be undone.
</p>
```

---

## CSV Import (Two-Step Modal)

The same `showImportModal` controls both steps; `importStep` switches between them.

### Step 1 — Upload (`'upload'`)

- File input limited to `.csv` (max 5 MB)
- Styled drop zone shows file name + size once selected
- "Analyze CSV" button sends `POST /api/admin/products/import` as FormData
- On success, response sets `importPreview` and advances `importStep` to `'preview'`

```tsx
<label htmlFor="csv-import-upload"
  className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface">
  {importFile
    ? <><FileUp className="text-bronze" /><p>{importFile.name}</p><p>{size} KB — click to change</p></>
    : <><Upload /><p>Click to upload CSV (max 5 MB)</p><p>Required columns: Code, Product Name, MG, Wholesale Price, CAD Price</p></>
  }
</label>
```

### Step 2 — Preview (`'preview'`)

Shows three summary badges before the table:
```tsx
<span className="... bg-emerald-500/10 text-emerald-700">
  <Plus /> {importPreview.newProducts.length} New
</span>
<span className="... bg-bronze/10 text-bronze">
  <Edit2 /> {importPreview.updateProducts.length} Updates
</span>
{importPreview.skippedRows > 0 && (
  <span className="... bg-amber-500/10 text-amber-700">
    <AlertCircle /> {importPreview.skippedRows} Skipped (no Code)
  </span>
)}
```

Preview table (`max-h-80 overflow-y-auto`, `sticky` thead) merges new + update rows with a Status badge column. "Confirm Import" calls `PUT /api/admin/products/import` with the preview data. "Back" returns to step 1.

### Import API (`app/api/admin/products/import/route.ts`)

Uses `xlsx` package to parse CSV (handles various CSV dialects via the spreadsheet reader):
- **`POST`** — upload file to `product-imports` Supabase Storage bucket, parse rows, diff against existing slugs, return `{ csvPath, newProducts, updateProducts, skippedRows }`
- **`PUT`** — receive confirmed lists, run a single `supabase.upsert()` with `onConflict: 'slug'` — inserts new rows, updates existing by slug. Max 500 rows per import.

CSV column mapping:
| CSV column | DB field |
|---|---|
| `Code` | `slug` (slugified) |
| `Product Name` | `name` |
| `MG` | `strength` |
| `CAD Price` (preferred) or `Wholesale Price` | `price` |
| Both prices | `description_short` (e.g. `Wholesale: $10.00 \| CAD: $13.00`) |

New products from CSV default to `stock_quantity: 0`, `featured: false`, `active: price > 0`. All other fields are `null` and must be filled in manually after import.

---

## API Route Auth Pattern

Every admin API route contains a local `verifyAdminRole` function (not shared — each route is self-contained):

```ts
async function verifyAdminRole(request: NextRequest, requireMutation = false) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  const { data: customer } = await supabase.from('customers').select('role').eq('id', user.id).single();
  const role = customer?.role || 'customer';

  if (requireMutation) return { authorized: canCreate(role), role };
  return { authorized: role === 'admin' || role === 'assistant', role };
}
```

Client sends the token like this:
```ts
const { data: session } = await supabase.auth.getSession();
const token = session.session?.access_token;
fetch('/api/admin/products', { headers: { Authorization: `Bearer ${token}` } });
```

---

## Supabase Storage Buckets

| Bucket | Used for | Delete endpoint |
|---|---|---|
| `products` | Product images | `DELETE /api/admin/products/upload?path=<path>` |
| `certificates` | COA PDFs | `DELETE /api/admin/products/upload-certificate?path=<path>` |
| `product-imports` | Uploaded CSV files (audit trail) | Not exposed (retained) |

File path is extracted from the public URL by splitting on `/object/public/<bucket>/`:
```ts
function extractFilePathFromUrl(url, bucket) {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split(`/object/public/${bucket}/`);
  return pathParts[1] || null;
}
```

---

## Design Token Reference

| Token | Usage |
|---|---|
| `text-ink` | Primary text |
| `text-ink-muted` | Secondary / placeholder text |
| `bg-surface` | Subtle background (inputs, table header, hover rows) |
| `border-line` | All borders |
| `text-bronze` / `bg-bronze/10` | Accent / highlight (focus rings, featured badge, inline edit hover) |
| `focus:ring-bronze/40` | Focus ring on all inputs |
| `divide-line/50` | Table row dividers |
| `hover:bg-line/50` | Hover on cancel/secondary buttons |

All modals use `fixed inset-0 bg-black/50` overlay with `z-50`.
