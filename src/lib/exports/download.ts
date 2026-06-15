export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * PDF export via the browser's print pipeline: the notation area is marked
 * `.print-area` and a print stylesheet hides everything else. Users choose
 * "Save as PDF". Zero-dependency and vector-perfect, at the cost of one
 * extra dialog (a jsPDF + svg2pdf pipeline could automate it; see README).
 */
export function exportPdf(): void {
  window.print();
}
