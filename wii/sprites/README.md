Drop PNGs here. They are embedded into the binary by bin2s at build time and
reachable as `<name>_png` / `<name>_png_size` from `assets.h`.

Empty so far: source/render.c draws the diagnostic view with rectangles and
text. The look this has to reach is web/js/pixels.js, which builds its sprites
procedurally in the browser rather than shipping sheets -- so these will have to
be authored or baked out, not copied across.
