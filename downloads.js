/*
 * downloads.js — durable offline episode files.
 *
 * No bare package imports: the app ships as raw files inside the APK with no
 * bundler, so `import ... from '@capacitor/...'` cannot resolve in the
 * WebView. Capacitor injects `window.Capacitor` natively, and every plugin is
 * reached through `Capacitor.Plugins`, the same way app.js already does it.
 *
 * Android uses the native FileTransfer plugin so large episodes are never
 * held in a JavaScript Blob. The browser fallback exists for previewing the
 * UI; native APK downloads are the supported path.
 */

const META_KEY = 'astralanime.downloads';
const DIR = 'astralanime-downloads';
const listeners = new Set();

/* ── Capacitor access (resolved lazily, never at import time) ─────── */

function cap() {
  return window.Capacitor || null;
}

function isNative() {
  const c = cap();
  return !!(c && (typeof c.isNativePlatform === 'function' ? c.isNativePlatform() : c.isNative));
}

function plugin(name) {
  return cap()?.Plugins?.[name] || null;
}

/** Filesystem plugin, or a clear error. Only needed for on-device storage. */
function fs() {
  const p = plugin('Filesystem');
  if (!p) throw new Error('Offline storage is not available in this environment');
  return p;
}

const DATA = 'DATA'; // Directory.Data

/* ── persisted list ───────────────────────────────────────────────── */

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(META_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let items = read();

function write() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(items));
  } catch {}
  emit();
}

function emit() {
  listeners.forEach(fn => {
    try { fn(items); } catch {}
  });
}

/* ── naming ───────────────────────────────────────────────────────── */

function safePart(value, fallback) {
  const clean = String(value || fallback)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return clean || fallback;
}

function fileName({ title, episode, language, source }) {
  return [
    safePart(title, 'anime'),
    `ep-${Number(episode) || 1}`,
    language === 'dub' ? 'dub' : 'sub',
    `q-${Number(source) + 1 || 1}`
  ].join('-') + '.mp4';
}

function itemKey(meta) {
  return [
    meta.src,
    meta.id,
    meta.episode,
    meta.language,
    meta.source
  ].join(':');
}

/* ── filesystem helpers ───────────────────────────────────────────── */

async function ensureDirectory() {
  await fs().mkdir({
    directory: DATA,
    path: DIR,
    recursive: true
  }).catch(() => {});
}

async function localUri(path) {
  const result = await fs().getUri({ directory: DATA, path });
  return result.uri;
}

async function deleteFile(path) {
  const p = plugin('Filesystem');
  if (!p || !path) return;
  await p.deleteFile({ directory: DATA, path }).catch(() => {});
}

/** Streams `url` into memory and writes it through the Filesystem plugin. */
async function browserDownload(url, path, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();

  let bytes;
  if (!reader) {
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    const chunks = [];
    let received = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      received += next.value.length;
      onProgress?.(total ? received / total : 0);
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    chunks.forEach(chunk => {
      bytes.set(chunk, offset);
      offset += chunk.length;
    });
  }

  // Build the base64 string in slices so large files do not blow the stack
  // or create millions of one-character strings.
  let binary = '';
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE));
  }
  await fs().writeFile({ directory: DATA, path, data: btoa(binary) });
  onProgress?.(1);
}

/* ── public API (unchanged shape) ─────────────────────────────────── */

export const Downloads = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  list() {
    return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  find(meta) {
    return items.find(item => item.key === itemKey(meta)) || null;
  },

  async download(meta, onProgress) {
    if (!meta?.url) throw new Error('This source has no downloadable file');
    await ensureDirectory();

    const key = itemKey(meta);
    const path = `${DIR}/${fileName(meta)}`;
    const existing = items.find(item => item.key === key);
    const item = {
      ...meta,
      key,
      path,
      status: 'downloading',
      progress: 0,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    items = [item, ...items.filter(row => row.key !== key)];
    write();

    try {
      const report = progress => {
        item.progress = progress;
        item.updatedAt = Date.now();
        items = items.map(row => row.key === key ? { ...item } : row);
        write();
        onProgress?.(progress);
      };

      const transfer = plugin('FileTransfer');
      if (isNative() && transfer) {
        const uri = await localUri(path);
        const progressListener = await transfer.addListener('progress', event => {
          const percent = Number(event?.percent);
          const got = Number(event?.bytes);
          const contentLength = Number(event?.contentLength);
          const progress = Number.isFinite(percent)
            ? percent / 100
            : contentLength > 0
              ? got / contentLength
              : 0;
          if (progress > 0) report(Math.min(1, progress));
        }).catch(() => null);

        try {
          await transfer.downloadFile({ url: meta.url, path: uri, progress: true });
        } catch (nativeError) {
          if (!globalThis.fetch) throw nativeError;
          await browserDownload(meta.url, path, report);
        } finally {
          progressListener?.remove?.();
        }
      } else {
        await browserDownload(meta.url, path, report);
      }

      item.status = 'complete';
      item.progress = 1;
      item.updatedAt = Date.now();
      items = items.map(row => row.key === key ? { ...item } : row);
      write();
      return item;
    } catch (error) {
      items = items.filter(row => row.key !== key);
      write();
      await deleteFile(path);
      throw error;
    }
  },

  async uri(item) {
    if (!item?.path) return '';
    const uri = await localUri(item.path);
    return cap()?.convertFileSrc ? cap().convertFileSrc(uri) : uri;
  },

  async remove(item) {
    if (!item) return;
    await deleteFile(item.path);
    items = items.filter(row => row.key !== item.key);
    write();
  },

  async clear() {
    for (const item of items) await deleteFile(item.path);
    items = [];
    write();
  },

  emit
};
