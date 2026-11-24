import { drawSvgToCanvas } from "./export";

export type BriefingFormat = "pdf" | "pptx";
export interface BriefingPage {
  title: string;
  svg: () => string;
}
const width = 1920;
const height = 1080;

/** Raster pages contain only visible audience artwork, including a scene's finished camera. */
export async function briefingFile(format: BriefingFormat, title: string, pages: BriefingPage[], background: string,
  onProgress?: (page: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (!pages.length) throw new Error("Choose a diagram or at least one scene to export.");
  const pdf = format === "pdf" ? await (await import("pdf-lib")).PDFDocument.create() : undefined;
  const deck = format === "pptx" ? new (await import("pptxgenjs")).default() : undefined;
  if (pdf) { pdf.setTitle(title); pdf.setCreator("Meridian"); }
  if (deck) { deck.layout = "LAYOUT_WIDE"; deck.title = title; deck.author = "Meridian"; }
  for (const [index, page] of pages.entries()) {
    signal?.throwIfAborted();
    onProgress?.(index + 1);
    const svg = new DOMParser().parseFromString(page.svg(), "image/svg+xml").documentElement;
    if (svg.localName !== "svg") throw new Error("The page image could not be read.");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const canvas = await drawSvgToCanvas(new XMLSerializer().serializeToString(svg), width, height, background);
    try {
      if (pdf) {
        const image = await pdf.embedJpg(canvas.toDataURL("image/jpeg", .97));
        pdf.addPage([960, 540]).drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
      } else if (deck) {
        deck.addSlide().addImage({ data: canvas.toDataURL("image/png"), x: 0, y: 0, w: 40 / 3, h: 7.5, altText: page.title });
      }
    } finally { canvas.width = canvas.height = 1; }
  }
  signal?.throwIfAborted();
  if (pdf) return new Blob([new Uint8Array(await pdf.save()).buffer], { type: "application/pdf" });
  const bytes = await deck!.write({ outputType: "arraybuffer", compression: true }) as ArrayBuffer;
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
