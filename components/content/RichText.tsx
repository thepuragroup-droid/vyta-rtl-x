'use client';

import React from 'react';
import Link from 'next/link';
import { safeUrl } from '@/lib/content/blocks';

/**
 * The inline text syntax used inside content blocks:
 *
 *   **bold**   *italic*   `code`   [label](https://example.com)
 *
 * Parsed into React nodes — never into HTML. That is the whole point: page and
 * article copy is edited by hand in the admin panel, and turning it into
 * `dangerouslySetInnerHTML` would make every editor a potential script
 * injection into the storefront. Unmatched markers are left as literal text.
 */

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

function renderLink(label: string, href: string, key: React.Key): React.ReactNode {
  const url = safeUrl(href);
  if (!url) return <span key={key}>{label}</span>;

  const className =
    'text-teal-dark underline underline-offset-2 decoration-teal/40 hover:decoration-teal-dark transition-colors';

  // Internal links go through next/link so navigation stays client-side;
  // anything off-site opens in a new tab with the usual rel hardening.
  if (url.startsWith('/') || url.startsWith('#')) {
    return (
      <Link key={key} href={url} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a key={key} href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );
}

export function renderInline(text: string): React.ReactNode[] {
  const source = text ?? '';
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  // `TOKEN` is global, so reset lastIndex — the regex object is module-scoped.
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(source)) !== null) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      nodes.push(<strong key={key++} className="font-semibold text-ink">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-surface-2 text-[0.9em] font-mono text-ink">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      nodes.push(renderLink(token.slice(1, split), token.slice(split + 2, -1), key++));
    } else {
      nodes.push(<em key={key++} className="italic">{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

/**
 * Inline-formatted text. Blank lines inside one block's text become separate
 * paragraphs, so an editor can type naturally without adding a block per break.
 */
export default function RichText({
  text,
  className = '',
  paragraphClassName = '',
}: {
  text: string;
  className?: string;
  paragraphClassName?: string;
}) {
  const paragraphs = (text ?? '').split(/\n{2,}/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((paragraph, i) => (
        <p key={i} className={`${paragraphClassName} ${i > 0 ? 'mt-4' : ''}`.trim()}>
          {/* A single newline is a soft break inside the same paragraph. */}
          {paragraph.split('\n').map((line, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {renderInline(line)}
            </React.Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
