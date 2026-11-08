"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { MAX_PAGES, photosToPdf } from "./photo";

// Phone camera capture for one invoice of one or more pages (D-67), the same flow as Daftar's
// receipt capture: take a photo, "+ Add another page" for each next page (or pick several from
// the gallery), then rotate, reorder or remove pages before Sawwi reads them as one invoice.

type Page = { id: string; file: File; url: string; turns: number };

export function PhotoPages({ disabled, onReady }: { disabled: boolean; onReady: (pdf: File) => Promise<boolean> }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  // Thumbnails are object URLs: free them when the component goes.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const add = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setError(null);
    setPages((prev) => {
      const room = Math.max(0, MAX_PAGES - prev.length);
      if (files.length > room) setError(`An invoice can have up to ${MAX_PAGES} pages.`);
      return [
        ...prev,
        ...files.slice(0, room).map((file) => {
          const url = URL.createObjectURL(file);
          urls.current.push(url);
          return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url, turns: 0 };
        }),
      ];
    });
  };

  const remove = (id: string) =>
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  const clear = () => {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
  };
  const move = (i: number, by: -1 | 1) =>
    setPages((prev) => {
      const next = [...prev];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const rotate = (id: string) => setPages((prev) => prev.map((p) => (p.id === id ? { ...p, turns: (p.turns + 1) % 4 } : p)));

  async function read() {
    setError(null);
    setPreparing(true);
    try {
      const pdf = await photosToPdf(pages);
      // Keep the pages if Sawwi couldn't read them, so one can be retaken.
      if (await onReady(pdf)) clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Those photos couldn't be prepared. Try again.");
    } finally {
      setPreparing(false);
    }
  }

  const full = pages.length >= MAX_PAGES;
  const busy = disabled || preparing;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* No `multiple` on the camera input: Android Chrome ignores `capture` with it and opens the file chooser. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />

      <div className="flex gap-2">
        <button type="button" className={`${buttonClass("primary")} relative h-12 flex-1`} disabled={busy || full} onClick={() => cameraRef.current?.click()}>
          <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5h3L7.5 6h9L18 8.5h3v11H3z" />
            <circle cx="12" cy="13.5" r="3.6" />
          </svg>
          {pages.length ? "Add another page" : "Take a photo"}
          {pages.length > 0 && (
            <span className="absolute -right-1.5 -top-2 grid h-5 min-w-5 place-items-center rounded-full border-2 border-surface bg-foreground px-1 text-[11px] font-semibold text-background">{pages.length}</span>
          )}
        </button>
        <button type="button" className={`${buttonClass("secondary")} h-12`} disabled={busy || full} onClick={() => galleryRef.current?.click()}>
          Gallery
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {pages.length === 0
          ? "Lay the invoice flat in good light and fill the frame. A multi-page invoice: one photo per page."
          : full
            ? `${pages.length} pages, the most for one invoice.`
            : `${pages.length} page${pages.length === 1 ? "" : "s"}. Add the next page, or read the invoice.`}
      </p>

      {pages.length > 0 && (
        <>
          <div className="mt-4 flex items-center">
            <p className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted">Pages · in invoice order</p>
            <button type="button" className="text-xs text-danger" onClick={clear} disabled={busy}>
              Remove all
            </button>
          </div>
          <ol className="mt-2 space-y-2">
            {pages.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-muted">
                  {/* A local object URL of the user's own photo: nothing for next/image to optimise. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Page ${i + 1}`} className="max-h-16 max-w-16 object-contain transition-transform" style={{ transform: `rotate(${p.turns * 90}deg)` }} />
                </div>
                <span className="flex-1 text-sm">
                  Page {i + 1} of {pages.length}
                </span>
                <div className="flex items-center">
                  <button type="button" className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-muted disabled:opacity-30" aria-label={`Rotate page ${i + 1}`} disabled={busy} onClick={() => rotate(p.id)}>
                    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 4v5h-5" />
                      <path d="M19.5 9a8 8 0 1 0-2 6" />
                    </svg>
                  </button>
                  <button type="button" className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-muted disabled:opacity-30" aria-label={`Move page ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-muted disabled:opacity-30" aria-label={`Move page ${i + 1} down`} disabled={busy || i === pages.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-danger disabled:opacity-30" aria-label={`Remove page ${i + 1}`} disabled={busy} onClick={() => remove(p.id)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!full && (
            <button type="button" className="mt-2 w-full rounded-lg border border-dashed border-border py-2.5 text-sm text-brand disabled:opacity-50" disabled={busy} onClick={() => cameraRef.current?.click()}>
              + Add another page
            </button>
          )}
          <button type="button" className={`${buttonClass("primary")} mt-3 h-11 w-full`} disabled={busy} onClick={() => void read()}>
            {preparing ? "Preparing…" : `Read invoice (${pages.length} page${pages.length === 1 ? "" : "s"})`}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
