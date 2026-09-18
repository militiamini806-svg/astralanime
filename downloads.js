/*
 * downloads.js — durable offline episode files.
 *
 * Android uses Capacitor's native FileTransfer plugin so large episodes do
 * not have to be held in a JavaScript Blob. The browser fallback is useful
 * for previewing the UI, but native APK downloads are the supported path.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { Capacitor } from '@capacitor/core';

const META_KEY = 'astralanime.downloads';
const DIR = 'astralanime-downloads';
const listeners = new Set();

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
  listeners.forEach(fn => fn(items));
}

function emit() {
  listeners.forEach(fn => fn(items));
}

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

async function ensureDirectory() {
  await Filesystem.mkdir({
    directory: Directory.Data,
    path: DIR,
    recursive: true
  }).catch(() => {});
}

async function localUri(path) {
  const result = await Filesystem.getUri({
    directory: Directory.Data,
    path
  });
  return result.uri;
}

async function browserDownload(url, path, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    const data = await blob.arrayBuffer();
    const bytes = new Uint8Array(data);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    await Filesystem.writeFile({
      directory: Directory.Data,
      path,
      data: btoa(binary)
    });
    onProgress?.(1);
    return;
  }

  const chunks = [];
  let received = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    received += next.value.length;
    onProgress?.(total ? received / total : 0);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  chunks.forEach(chunk => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  let binary = '';
  merged.forEach(byte => { binary += String.fromCharCode(byte); });
  await Filesystem.writeFile({
    directory: Directory.Data,
    path,
    data: btoa(binary)
  });
  onProgress?.(1);
}

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

      if (Capacitor.isNativePlatform()) {
        const uri = await localUri(path);
        const progressListener = await FileTransfer.addListener('progress', event => {
          const percent = Number(event?.percent);
          const bytes = Number(event?.bytes);
          const contentLength = Number(event?.contentLength);
          const progress = Number.isFinite(percent)
            ? percent / 100
            : contentLength > 0
              ? bytes / contentLength
              : 0;
          if (progress > 0) report(Math.min(1, progress));
        }).catch(() => null);

        try {
          await FileTransfer.downloadFile({
            url: meta.url,
            path: uri,
            progress: true
          });
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
      await Filesystem.deleteFile({ directory: Directory.Data, path }).catch(() => {});
      throw error;
    }
  },

  async uri(item) {
    if (!item?.path) return '';
    return Capacitor.convertFileSrc(await localUri(item.path));
  },

  async remove(item) {
    if (!item) return;
    await Filesystem.deleteFile({
      directory: Directory.Data,
      path: item.path
    }).catch(() => {});
    items = items.filter(row => row.key !== item.key);
    write();
  },

  async clear() {
    for (const item of items) {
      await Filesystem.deleteFile({
        directory: Directory.Data,
        path: item.path
      }).catch(() => {});
    }
    items = [];
    write();
  },

  emit
};