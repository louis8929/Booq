/**
 * Client for the optional FastAPI/librosa backend (see server/).
 * The /api prefix is proxied by Vite (vite.config.ts) in dev.
 */

import type { Transcription } from '../types';

let availability: boolean | null = null;

export async function serverAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(t);
    availability = res.ok;
  } catch {
    availability = false;
  }
  return availability;
}

export async function analyzeOnServer(
  file: File | Blob,
  onProgress?: (p: number) => void,
): Promise<Transcription> {
  const form = new FormData();
  form.append('file', file, file instanceof File ? file.name : 'audio.mp3');

  // Use XHR for upload progress (fetch still has no standard upload progress).
  const json = await new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/analyze');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.((e.loaded / e.total) * 0.5);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(`Server analysis failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Network error during analysis'));
    xhr.send(form);
  });

  const t = json as Transcription;
  if (!t || !Array.isArray(t.hits)) throw new Error('Malformed server response');
  return { ...t, source: 'server-librosa' };
}
