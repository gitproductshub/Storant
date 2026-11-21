STORANT BRAND ASSETS

Included:
- favicon-light.ico / favicon-dark.ico
- favicon-light.svg / favicon-dark.svg
- favicon PNG sizes (16, 32, 48)
- PWA icons in 192x192 and 512x512
- 512x512 maskable PWA icon variants
- manifest.json (light) and manifest-dark.json (dark)

Use one manifest per deployment/theme. A web app manifest does not automatically
switch launcher icons based on the phone's light/dark setting; choose the desired
manifest or implement a platform-specific icon strategy.

Suggested HTML:
<link rel="icon" href="/favicon-light.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-light.ico" sizes="any">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#FBF9FF">

For dark deployment, use favicon-dark.svg / favicon-dark.ico and manifest-dark.json.
