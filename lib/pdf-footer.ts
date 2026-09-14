/**
 * pdfkit footer helper.
 *
 * Drawing into the bottom margin is what a footer IS, but pdfkit treats any
 * write below `page.height - margins.bottom` as overflow and helpfully starts
 * a new page — which, on a footer pass over `bufferedPageRange()`, emits a
 * blank twin page for every page in the document.
 *
 * `drawInFooterStrip` zeroes the bottom margin for the duration of the draw
 * and restores it afterwards, so the footer lands where it was asked to and
 * nothing spills onto a new page.
 */
export function drawInFooterStrip(doc: any, draw: () => void): void {
  const original = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  try {
    draw();
  } finally {
    doc.page.margins.bottom = original;
  }
}
