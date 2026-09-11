// Web-only file picker for bulk fixture import (Phase 11) — a plain hidden
// <input type="file"> driven imperatively, not a cross-platform package.
// Chalkie's pilot is mobile-web only (see the season pivot), and this is an
// admin/desktop-leaning task, so no native (iOS/Android) file picker is
// needed; callers gate on Platform.OS === 'web' before calling this.
// Not unit-tested — it needs a real browser (document/FileReader).
export function pickCSVFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
