'use client';

import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

/**
 * One image input used everywhere content takes a picture: block images,
 * gallery tiles, page heroes and article covers.
 *
 * Two ways in, because both are real workflows: drop/choose a file (uploaded to
 * Supabase Storage through /api/admin/content/upload) or paste a URL you
 * already have. Either way the field shows the actual image straight away — an
 * image field that only shows a URL string is how broken pictures get
 * published.
 */

interface ImageFieldProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  /** Preview box aspect. 'auto' lets a tall image be tall. */
  aspect?: 'video' | 'square' | 'auto';
  compact?: boolean;
}

export default function ImageField({
  value,
  onChange,
  label = 'Image',
  aspect = 'video',
  compact = false,
}: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await apiFetch<{ url: string }>('/api/admin/content/upload', {
        method: 'POST',
        body,
        // Uploads are far slower than a JSON call; apiFetch's 10s default would
        // abort a large photo on a slow connection.
        timeoutMs: 60_000,
      });
      onChange(res.url);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const aspectClass =
    aspect === 'square' ? 'aspect-square' : aspect === 'auto' ? '' : 'aspect-video';

  return (
    <div>
      {label && <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>}

      {value ? (
        <div className="group relative overflow-hidden rounded-lg border border-line bg-surface">
          <div className={`${aspectClass} w-full`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="h-full w-full object-cover" />
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
            title="Remove image"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            compact ? 'py-5' : 'py-8'
          } ${dragging ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-teal/40'}`}
        >
          {uploading ? (
            <>
              <Loader2 className="mb-1.5 h-5 w-5 animate-spin text-teal-dark" />
              <span className="text-xs text-ink-muted">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="mb-1.5 h-5 w-5 text-ink-muted" />
              <span className="text-xs text-ink-muted">
                Drop an image or <span className="font-medium text-teal-dark">browse</span>
              </span>
              <span className="mt-0.5 text-[10px] text-ink-light">JPEG, PNG, WebP, GIF · max 20MB</span>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />

      <div className="mt-2 flex items-center gap-2">
        <ImageIcon className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste an image URL"
          className="min-w-0 flex-1 rounded border border-line bg-white px-2 py-1 text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
        />
      </div>

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
