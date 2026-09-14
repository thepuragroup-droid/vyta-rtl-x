// Print a PDF blob WITHOUT opening a new tab: load it into an off-screen
// iframe and invoke the browser's print dialog on that frame. Used for
// printing Easyship shipping labels from the admin order views.
export function printPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* some browsers block programmatic print on cross-origin frames */
    }
  };
  document.body.appendChild(iframe);
  // Clean up after the print dialog has had time to open.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    iframe.remove();
  }, 60_000);
}
