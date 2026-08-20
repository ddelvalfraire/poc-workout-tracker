# App icon masters

`icon.png` and `icon-dark.png` are the 1024×1024 masters. Everything under
`public/icons/` and `src/app/favicon.ico` is derived from them — edit a master
and regenerate, never hand-edit a derived file.

| Variant | Ground | Used for |
| --- | --- | --- |
| `icon.png` | icon green `#92d702` | home screen (manifest + apple-touch), light-mode favicon |
| `icon-dark.png` | `#1a1c18` | dark-mode favicon only |

The green tile is the app icon proper: on a home screen it sits over the user's
wallpaper, where the brand ground carries the recognition. The dark variant
exists for browser chrome that is already dark, where a bright tile would read
as a lit square instead of a mark.

**The icon green is not the volt.** `--primary` — the volt, the app's one
accent — is `oklch(0.86 0.19 128)`, which resolves to `#ade74e`; the icon
ground is `#92d702`, a deeper green. The two are close enough to be mistaken
for each other and are NOT the same value. That is tolerable because the mark
is supplied artwork with its own palette, not a token consumer: no code reads
this hex, and `src/design/tokens.ts` remains the only source of UI colour. If
the two should ever converge, recolour the masters here and regenerate — never
by writing a colour into `src/`.

## Regenerating

macOS only (`sips` is a system tool; there is no image dependency in
`package.json`, and no CI runs this).

```sh
sips -z 192 192 design/icons/icon.png --out public/icons/icon-192.png
sips -z 512 512 design/icons/icon.png --out public/icons/icon-512.png
sips -z 180 180 design/icons/icon.png --out public/icons/apple-touch-icon.png
sips -z 32 32 design/icons/icon.png --out public/icons/icon-32.png
sips -z 32 32 design/icons/icon-dark.png --out public/icons/icon-dark-32.png
```

The maskable icon insets the artwork to Android's 80% safe area and pads it
back out on the artwork's own ground, so the seam is invisible:

```sh
sips -z 410 410 design/icons/icon.png --out /tmp/mask-410.png
sips -p 512 512 --padColor 92D702 /tmp/mask-410.png --out public/icons/icon-maskable-512.png
```

`src/app/favicon.ico` bundles 16/32/48 PNG payloads in one ICO. It is the
untargeted fallback (bookmarks, crawlers, `/favicon.ico` hits that never parse
the document); the themed pair above is what a browser picks when it reads the
`<link>` tags in `src/app/layout.tsx`.
