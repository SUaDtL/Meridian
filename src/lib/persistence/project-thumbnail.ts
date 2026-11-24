import { openWorkspaceDatabase } from "./project-inventory";

/** Cache only a small raster. Project documents remain the authority for reopening. */
export async function cacheThumbnail(key: string, updatedAt: string, svg: string, signal: AbortSignal) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = 192; canvas.height = 108;
    const k = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const w = image.naturalWidth * k, h = image.naturalHeight * k;
    canvas.getContext("2d")?.drawImage(image, (192-w)/2, (108-h)/2, w, h);
    const data = canvas.toDataURL("image/webp", .75);
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("previews", "readwrite");
        tx.objectStore("previews").put({ key: "tile/" + key, updatedAt, data });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } finally { URL.revokeObjectURL(url); }
}
