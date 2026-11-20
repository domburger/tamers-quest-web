const isDrawable = (v) => !!(v && typeof v === "object" && ((v.width != null) || (v.naturalWidth != null)));

export function makeTextureRegistry() {
  const tex = new Map();

  return {
    loadSprite(name, src) {
      if (isDrawable(src)) { tex.set(name, src); return Promise.resolve(src); }
      if (typeof src === "string") {
        if (typeof Image === "undefined") return Promise.resolve(null);
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { tex.set(name, img); resolve(img); };
          img.onerror = () => resolve(null);
          img.src = src;
        });
      }
      return Promise.resolve(null);
    },
    set(name, drawable) { if (isDrawable(drawable)) tex.set(name, drawable); return drawable; },
    get(name) { return tex.get(name) || null; },
    has(name) { return tex.has(name); },
    delete(name) { return tex.delete(name); },
    clear() { tex.clear(); },
    count() { return tex.size; },
    names() { return [...tex.keys()]; },
  };
}
