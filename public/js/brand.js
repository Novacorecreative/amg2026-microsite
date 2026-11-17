/* Turns the three brand colours into the full set of CSS variables the site uses. Shared by guest site and admin. */
window.Brand = (() => {
  const rgb = (h) => {
    const n = parseInt(String(h).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const onColor = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

  // Heading fonts (free Google Fonts). Keys match FONTS in src/branding.js.
  const FONTS = {
    bricolage: { label: 'Bricolage Grotesque (default)', family: 'Bricolage Grotesque', css: 'Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800' },
    montserrat: { label: 'Montserrat (close to Gotham)', family: 'Montserrat', css: 'Montserrat:wght@600;700;800' },
    poppins: { label: 'Poppins', family: 'Poppins', css: 'Poppins:wght@600;700;800' },
    inter: { label: 'Inter', family: 'Inter', css: 'Inter:wght@600;700;800' },
  };
  const font = (key) => FONTS[key] || FONTS.bricolage;
  function loadFont(key) {
    const f = font(key);
    if (document.querySelector(`link[data-font="${f.family}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.font = f.family;
    l.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`;
    document.head.append(l);
  }

  function vars(b) {
    const p = b.colorPrimary, a = b.colorAccent, h = b.colorHighlight;
    return {
      '--font-display': `'${font(b.font).family}', 'Segoe UI', system-ui, sans-serif`,
      '--teal-900': mix(p, '#000000', 0.45),
      '--teal-800': mix(p, '#000000', 0.2),
      '--teal-700': p,
      '--teal-500': mix(p, '#ffffff', 0.22),
      '--teal-100': mix(p, '#ffffff', 0.86),
      '--on-primary': onColor(p),
      '--coral': a,
      '--coral-dark': mix(a, '#000000', 0.18),
      '--on-accent': onColor(a),
      '--gold': h,
      '--on-highlight': onColor(h),
      '--ink': mix(p, '#0b1414', 0.75),
      '--muted': mix('#5f6b6d', p, 0.15),
    };
  }

  function apply(b, el = document.documentElement) {
    if (!b) return;
    loadFont(b.font);
    for (const [k, v] of Object.entries(vars(b))) el.style.setProperty(k, v);
    if (el === document.documentElement) {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
      meta.content = b.colorPrimary;
      if (b.logo) {
        let icon = document.querySelector('link[rel="icon"]');
        if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon); }
        icon.href = b.logo;
      }
    }
  }

  // Hero background: brand gradient, optionally over a photo or artwork.
  // The tint sets how much of the image shows through (hex alpha on the gradient).
  const TINTS = { strong: ['cc', 'e6'], light: ['55', '99'], none: ['00', '00'] };
  function heroBackground(b) {
    const v = vars(b);
    const [a1, a2] = b.heroImage ? TINTS[b.heroTint] || TINTS.strong : ['', ''];
    const grad = `radial-gradient(120% 140% at 100% 0%, ${v['--teal-500']}${a1} 0%, ${b.colorPrimary}${a1} 45%, ${v['--teal-900']}${a2} 100%)`;
    return b.heroImage ? `${grad}, url("${b.heroImage}") center / cover no-repeat` : grad;
  }

  // Readability check for the admin preview.
  const warnings = (b) => {
    const out = [];
    if (contrast(mix(b.colorPrimary, '#000000', 0.45), '#ffffff') < 4.5) out.push('The primary colour is quite light — white text on the header may be hard to read. Try a deeper shade.');
    if (contrast(b.colorAccent, onColor(b.colorAccent)) < 3) out.push('Button text may be hard to read on the accent colour.');
    return out;
  };

  return { apply, vars, mix, onColor, contrast, heroBackground, warnings, FONTS };
})();
