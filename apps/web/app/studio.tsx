"use client";

import type { Asset, Job } from "@cc/core";
import { FITS, PRESETS, type Fit, type Preset } from "@cc/core/presets";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";

const PRESET_LABELS: Record<Preset, string> = {
  square: "پست مربعی",
  portrait: "پست عمودی",
  story: "استوری / ریلز",
  landscape: "افقی",
};

const FIT_LABELS: Record<Fit, string> = {
  cover: "برش",
  contain: "حاشیه‌ی رنگی",
  blur: "پس‌زمینه‌ی محو",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init).catch(() => null);
  if (!res) throw new Error("خطای شبکه.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? "خطای داخلی سرور.");
  return body as T;
}

export function Studio() {
  const { tr, locale, setLocale } = useI18n();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preset, setPreset] = useState<Preset>("portrait");
  const [fit, setFit] = useState<Fit>("blur");
  const [background, setBackground] = useState("#000000");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = job?.status === "queued" || job?.status === "running";

  // Poll the job until it finishes.
  useEffect(() => {
    if (!job || !busy) return;
    const timer = setInterval(async () => {
      try {
        const { job: next } = await api<{ job: Job }>(`/api/jobs/${job.id}`);
        setJob(next);
        if (next.status === "failed") setError(next.error);
      } catch (err) {
        setError((err as Error).message);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job, busy]);

  async function upload(file: File) {
    setError(null);
    setJob(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { asset } = await api<{ asset: Asset }>("/api/uploads", { method: "POST", body: form });
      setAsset(asset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!asset) return;
    setError(null);
    try {
      const { job } = await api<{ job: Job }>("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, tool: "resize", params: { preset, fit, background } }),
      });
      setJob(job);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function reset() {
    setAsset(null);
    setJob(null);
    setError(null);
  }

  const { width, height } = PRESETS[preset];
  const frameStyle = { aspectRatio: `${width} / ${height}`, background } as CSSProperties;
  const result = job?.status === "done" ? job.output : null;

  return (
    <main className="shell">
      <header className="top">
        <h1>{tr("استودیو محتوا")}</h1>
        <button className="link" onClick={() => setLocale(locale === "fa" ? "en" : "fa")}>
          {locale === "fa" ? "English" : "فارسی"}
        </button>
      </header>

      {!asset ? (
        <label
          className={`drop${dragging ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          <span className="drop-title">
            {uploading ? tr("در حال آپلود…") : tr("عکس را اینجا رها کنید یا برای انتخاب کلیک کنید")}
          </span>
          <span className="muted">{tr("JPEG، PNG یا WebP")}</span>
        </label>
      ) : (
        <div className="workspace">
          <section className="canvas">
            <div className={`frame${height > width ? " tall" : ""}`} style={frameStyle}>
              {result ? (
                <img src={result.url} alt={tr("نتیجه")} className="fill" />
              ) : (
                <>
                  {fit === "blur" && <img src={asset.url} alt="" className="fill backdrop" />}
                  <img src={asset.url} alt={tr("پیش‌نمایش")} className={`fill ${fit === "cover" ? "cover" : "contain"}`} />
                </>
              )}
              {busy && (
                <div className="overlay">{job?.status === "queued" ? tr("در صف…") : tr("در حال پردازش…")}</div>
              )}
            </div>
            <span className="muted size">
              {width}×{height}
            </span>
          </section>

          <section className="panel">
            {result ? (
              <div className="actions">
                <a className="btn primary" href={result.url} download>
                  {tr("دانلود")}
                </a>
                <button className="btn" onClick={() => setJob(null)}>
                  {tr("ویرایش دوباره")}
                </button>
                <button className="btn" onClick={reset}>
                  {tr("عکس دیگر")}
                </button>
              </div>
            ) : (
              <>
                <fieldset>
                  <legend>{tr("قالب")}</legend>
                  <div className="chips">
                    {(Object.keys(PRESETS) as Preset[]).map((p) => (
                      <button
                        key={p}
                        className={`chip${p === preset ? " on" : ""}`}
                        onClick={() => setPreset(p)}
                        disabled={busy}
                      >
                        <span
                          className="ratio"
                          style={{ aspectRatio: `${PRESETS[p].width} / ${PRESETS[p].height}` }}
                          aria-hidden
                        />
                        {tr(PRESET_LABELS[p])}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>{tr("جای‌گیری")}</legend>
                  <div className="chips">
                    {FITS.map((f) => (
                      <button key={f} className={`chip${f === fit ? " on" : ""}`} onClick={() => setFit(f)} disabled={busy}>
                        {tr(FIT_LABELS[f])}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {fit === "contain" && (
                  <label className="color">
                    {tr("رنگ حاشیه")}
                    <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
                  </label>
                )}

                <div className="actions">
                  <button className="btn primary" onClick={create} disabled={busy}>
                    {tr("ساخت")}
                  </button>
                  <button className="btn" onClick={reset} disabled={busy}>
                    {tr("عکس دیگر")}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {tr(error)}
        </p>
      )}
    </main>
  );
}
