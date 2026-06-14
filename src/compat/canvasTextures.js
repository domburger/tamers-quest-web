// TQ-284 (Phase 5, engine-removal TQ-227/232): texture registry for the canvas backend, replacing
// Phaser's game.textures. Maps a sprite NAME to a drawable (an HTMLCanvasElement from spritegen, an
// HTMLImageElement from a base64/url, or an ImageBitmap) that ctx.drawImage can blit directly. Mirrors
// the shim's k.loadSprite (canvas → addCanvas, string → addImage). No Phaser, no canvas drawing here.

// A drawable is anything with intrinsic dimensions ctx.drawImage accepts (canvas / image / bitmap).
const isDrawable = (v) => !!(v && typeof v === "object" && ((v.width != null) || (v.naturalWidth != null)));

export function makeTextureRegistry() {
  const tex = new Map(); // name -> drawable

  return {
    /**
     * Register a texture by name. A procedural canvas / ImageBitmap / Image is stored synchronously; a
     * base64 or URL string is loaded into an Image (async). Returns a Promise resolving to the drawable
     * (or null if it can't load / there's no DOM). Mirrors k.loadSprite.
     */
    loadSprite(name, src) {
      if (isDrawable(src)) { tex.set(name, src); return Promise.resolve(src); }
      if (typeof src === "string") {
        if (typeof Image === "undefined") return Promise.resolve(null); // headless / no DOM
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { tex.set(name, img); resolve(img); };
          img.onerror = () => resolve(null);
          img.src = src;
        });
      }
      return Promise.resolve(null);
    },
    /** Store an already-loaded drawable synchronously (e.g. a baked spritegen canvas). */
    set(name, drawable) { if (isDrawable(drawable)) tex.set(name, drawable); return drawable; },
    get(name) { return tex.get(name) || null; },
    has(name) { return tex.has(name); },
    delete(name) { return tex.delete(name); },
    clear() { tex.clear(); },
    count() { return tex.size; },
    names() { return [...tex.keys()]; },
  };
}
