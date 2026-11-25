// Client branding: names, colours, logos, title artwork and header image. Stored in the settings
// table (edited from Admin → Branding); .env values are the fallback.
const { getSetting } = require('./db');

const env = (k, d = '') => (process.env[k] ?? d).trim();

const DEFAULT_COLORS = { colorPrimary: '#0d4f4a', colorAccent: '#e8704a', colorHighlight: '#f2b84b' };
const HERO_TINTS = ['strong', 'light', 'none'];
// Heading fonts offered in Admin → Branding; the families themselves are listed in public/js/brand.js.
const FONTS = ['bricolage', 'montserrat', 'poppins', 'inter'];
const MAX_PARTNERS = 4;
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

function partnerFiles() {
  try {
    const v = JSON.parse(getSetting('brand_partner_logos') || '[]');
    return Array.isArray(v) ? v.filter((f) => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function getBranding() {
  const color = (key, def) => (isHex(getSetting(key)) ? getSetting(key) : def);
  const file = (key) => (getSetting(key) ? `/uploads/${getSetting(key)}` : null);
  const tint = getSetting('brand_hero_tint');
  const font = getSetting('brand_font');
  return {
    clientName: getSetting('brand_client_name') || env('CLIENT_NAME', 'Grindwell Norton'),
    eventName: getSetting('brand_event_name') || env('EVENT_NAME', 'AMG 2026'),
    tagline: getSetting('brand_tagline') || '',
    colorPrimary: color('brand_color_primary', DEFAULT_COLORS.colorPrimary),
    colorAccent: color('brand_color_accent', DEFAULT_COLORS.colorAccent),
    colorHighlight: color('brand_color_highlight', DEFAULT_COLORS.colorHighlight),
    logo: file('brand_logo'),
    logoBadge: getSetting('brand_logo_badge') !== '0',
    titleArt: file('brand_title_art'),
    heroImage: file('brand_hero'),
    // Finished banner artwork (logos and title built in): shown as-is instead of the typed header.
    banner: file('brand_banner'),
    bannerMobile: file('brand_banner_mobile'),
    heroTint: HERO_TINTS.includes(tint) ? tint : 'strong',
    font: FONTS.includes(font) ? font : 'bricolage',
    partnerLogos: partnerFiles().map((f) => `/uploads/${f}`),
  };
}

// Pick black or white text for a background colour (WCAG relative luminance).
function onColor(hex) {
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const L = lum(hex);
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0549 ? '#ffffff' : '#111111';
}

module.exports = { getBranding, onColor, isHex, partnerFiles, DEFAULT_COLORS, HERO_TINTS, FONTS, MAX_PARTNERS };
