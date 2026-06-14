import { getCalendars, getLocales } from "expo-localization";

export type Lang = "fr" | "en" | "es";

const SUPPORTED: Lang[] = ["fr", "en", "es"];

// Detect device language; fallback to French
export function detectLang(): Lang {
  const locales = getLocales();
  for (const l of locales) {
    const code = (l.languageCode ?? "").toLowerCase() as Lang;
    if (SUPPORTED.includes(code)) return code;
  }
  return "fr";
}

// Returns true if the iPad is set to 24-hour time
export function detectUses24h(): boolean {
  const cal = getCalendars()[0];
  if (cal && typeof cal.uses24hourClock === "boolean") return cal.uses24hourClock;
  // Fallback: French/Spanish default 24h, English defaults 12h
  const lang = detectLang();
  return lang !== "en";
}

// BCP-47 tag for Intl — sanitised so values like "en-US@posix" or "C" don't crash Intl
function sanitiseTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip POSIX extension ("@posix", "@euro", etc.) and any codeset (".UTF-8")
  let t = String(raw).split("@")[0].split(".")[0].trim();
  if (!t || t.toUpperCase() === "C" || t.toUpperCase() === "POSIX") return null;
  // Normalise underscores to hyphens (e.g. fr_FR -> fr-FR)
  t = t.replace(/_/g, "-");
  // Validate by attempting to construct an Intl locale; fall back to language part only
  try {
    new Intl.DateTimeFormat(t);
    return t;
  } catch {
    const base = t.split("-")[0];
    if (!base) return null;
    try {
      new Intl.DateTimeFormat(base);
      return base;
    } catch {
      return null;
    }
  }
}

export function detectLocaleTag(): string {
  try {
    const locales = getLocales();
    for (const l of locales ?? []) {
      const cleaned = sanitiseTag(l?.languageTag);
      if (cleaned) return cleaned;
      const code = sanitiseTag(l?.languageCode);
      if (code) return code;
    }
  } catch {
    // ignore — fall through to default
  }
  // Default to French (primary supported language)
  return "fr-FR";
}

// ---------- Strings ----------
type Dict = {
  searchPlaceholder: string;
  feelsLike: string;
  feels: string; // abbreviated
  humidity: string;
  wind: string;
  now: string;
  today: string;
  tomorrow: string;
  weatherAlert: string;
  rainUnit: string; // "Pluie" / "Rain" / "Lluvia"
  snowUnit: string; // "Neige" / "Snow" / "Nieve"
  weatherRadar: string;
  myPosition: string;
  permissionDenied: string;
  permissionOpenSettings: string;
  locationUnavailable: string;
  weatherFetchError: string;
  // Alerts
  alertStrongGusts: (kmh: number) => string;
  alertStrongWind: (kmh: number) => string;
  alertStorm: string;
  alertHeavySnow: (cm: string) => string;
  alertHeavyRain: (mm: number) => string;
  // Weather codes (WMO)
  wmo: Record<number, string>;
  // Weekday formats
  daysLong: string[]; // Sun..Sat (we'll derive via Intl, but keep for capitalisation)
  // Date formatter "13 Juin"
  formatShortDate: (d: Date, locale: string) => string;
  // Long date with capitalised first letter
  formatLongDate: (d: Date, locale: string) => string;
};

const baseWmo = {
  0: { fr: "Ciel dégagé", en: "Clear sky", es: "Cielo despejado" },
  1: { fr: "Plutôt clair", en: "Mainly clear", es: "Mayormente despejado" },
  2: { fr: "Partiellement nuageux", en: "Partly cloudy", es: "Parcialmente nublado" },
  3: { fr: "Couvert", en: "Overcast", es: "Cubierto" },
  45: { fr: "Brouillard", en: "Fog", es: "Niebla" },
  48: { fr: "Brouillard givrant", en: "Rime fog", es: "Niebla helada" },
  51: { fr: "Bruine légère", en: "Light drizzle", es: "Llovizna ligera" },
  53: { fr: "Bruine", en: "Drizzle", es: "Llovizna" },
  55: { fr: "Bruine dense", en: "Dense drizzle", es: "Llovizna densa" },
  56: { fr: "Bruine verglaçante", en: "Freezing drizzle", es: "Llovizna helada" },
  57: { fr: "Bruine verglaçante dense", en: "Dense freezing drizzle", es: "Llovizna helada densa" },
  61: { fr: "Pluie faible", en: "Light rain", es: "Lluvia ligera" },
  63: { fr: "Pluie", en: "Rain", es: "Lluvia" },
  65: { fr: "Pluie forte", en: "Heavy rain", es: "Lluvia fuerte" },
  66: { fr: "Pluie verglaçante", en: "Freezing rain", es: "Lluvia helada" },
  67: { fr: "Pluie verglaçante forte", en: "Heavy freezing rain", es: "Lluvia helada fuerte" },
  71: { fr: "Neige faible", en: "Light snow", es: "Nieve ligera" },
  73: { fr: "Neige", en: "Snow", es: "Nieve" },
  75: { fr: "Neige forte", en: "Heavy snow", es: "Nieve fuerte" },
  77: { fr: "Grains de neige", en: "Snow grains", es: "Granos de nieve" },
  80: { fr: "Averses", en: "Showers", es: "Chubascos" },
  81: { fr: "Averses fortes", en: "Heavy showers", es: "Chubascos fuertes" },
  82: { fr: "Averses violentes", en: "Violent showers", es: "Chubascos violentos" },
  85: { fr: "Averses de neige", en: "Snow showers", es: "Chubascos de nieve" },
  86: { fr: "Averses de neige fortes", en: "Heavy snow showers", es: "Chubascos de nieve fuertes" },
  95: { fr: "Orage", en: "Thunderstorm", es: "Tormenta" },
  96: { fr: "Orage avec grêle", en: "Thunderstorm with hail", es: "Tormenta con granizo" },
  99: { fr: "Orage violent", en: "Severe thunderstorm", es: "Tormenta severa" },
} as const;

function wmoFor(lang: Lang): Record<number, string> {
  const out: Record<number, string> = {};
  for (const k of Object.keys(baseWmo)) {
    const code = parseInt(k, 10);
    out[code] = (baseWmo as Record<string, Record<Lang, string>>)[k][lang];
  }
  return out;
}

// Capitalise first letter (needed because Intl returns lowercase weekday on iOS for some locales)
function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function makeFormatLong(d: Date, locale: string): string {
  try {
    const s = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
    return cap(s);
  } catch {
    return d.toDateString();
  }
}

function makeFormatShort(d: Date, locale: string): string {
  try {
    const s = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(d);
    return cap(s);
  } catch {
    return `${d.getDate()}`;
  }
}

const FR: Dict = {
  searchPlaceholder: "Rechercher une ville…",
  feelsLike: "Ressenti",
  feels: "ress.",
  humidity: "Humidité",
  wind: "Vent",
  now: "Maintenant",
  today: "Aujourd'hui",
  tomorrow: "demain",
  weatherAlert: "Alerte météo",
  rainUnit: "Pluie",
  snowUnit: "Neige",
  weatherRadar: "Radar météo",
  myPosition: "Ma position",
  permissionDenied: "Permission de localisation refusée.",
  permissionOpenSettings: "Permission refusée. Ouvrez les Réglages pour autoriser la localisation.",
  locationUnavailable: "Localisation indisponible.",
  weatherFetchError: "Impossible de récupérer la météo. Vérifiez votre connexion.",
  alertStrongGusts: (k) => `Vent fort — rafales jusqu'à ${k} km/h`,
  alertStrongWind: (k) => `Vent soutenu — jusqu'à ${k} km/h`,
  alertStorm: "Orage prévu",
  alertHeavySnow: (cm) => `Fortes chutes de neige — ${cm} cm`,
  alertHeavyRain: (mm) => `Fortes pluies — ${mm} mm`,
  wmo: wmoFor("fr"),
  daysLong: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"],
  formatShortDate: makeFormatShort,
  formatLongDate: makeFormatLong,
};

const EN: Dict = {
  searchPlaceholder: "Search a city…",
  feelsLike: "Feels like",
  feels: "feels",
  humidity: "Humidity",
  wind: "Wind",
  now: "Now",
  today: "Today",
  tomorrow: "tomorrow",
  weatherAlert: "Weather alert",
  rainUnit: "Rain",
  snowUnit: "Snow",
  weatherRadar: "Weather radar",
  myPosition: "My location",
  permissionDenied: "Location permission denied.",
  permissionOpenSettings: "Permission denied. Open Settings to allow location.",
  locationUnavailable: "Location unavailable.",
  weatherFetchError: "Unable to fetch weather. Check your connection.",
  alertStrongGusts: (k) => `Strong wind — gusts up to ${k} km/h`,
  alertStrongWind: (k) => `Sustained wind — up to ${k} km/h`,
  alertStorm: "Thunderstorm expected",
  alertHeavySnow: (cm) => `Heavy snowfall — ${cm} cm`,
  alertHeavyRain: (mm) => `Heavy rain — ${mm} mm`,
  wmo: wmoFor("en"),
  daysLong: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  formatShortDate: makeFormatShort,
  formatLongDate: makeFormatLong,
};

const ES: Dict = {
  searchPlaceholder: "Buscar una ciudad…",
  feelsLike: "Sensación",
  feels: "sens.",
  humidity: "Humedad",
  wind: "Viento",
  now: "Ahora",
  today: "Hoy",
  tomorrow: "mañana",
  weatherAlert: "Alerta meteorológica",
  rainUnit: "Lluvia",
  snowUnit: "Nieve",
  weatherRadar: "Radar meteorológico",
  myPosition: "Mi ubicación",
  permissionDenied: "Permiso de ubicación denegado.",
  permissionOpenSettings: "Permiso denegado. Abre Ajustes para permitir la ubicación.",
  locationUnavailable: "Ubicación no disponible.",
  weatherFetchError: "No se pudo obtener el clima. Comprueba tu conexión.",
  alertStrongGusts: (k) => `Viento fuerte — ráfagas hasta ${k} km/h`,
  alertStrongWind: (k) => `Viento sostenido — hasta ${k} km/h`,
  alertStorm: "Tormenta prevista",
  alertHeavySnow: (cm) => `Fuertes nevadas — ${cm} cm`,
  alertHeavyRain: (mm) => `Fuertes lluvias — ${mm} mm`,
  wmo: wmoFor("es"),
  daysLong: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
  formatShortDate: makeFormatShort,
  formatLongDate: makeFormatLong,
};

const TRANSLATIONS: Record<Lang, Dict> = { fr: FR, en: EN, es: ES };

export function getT(lang: Lang): Dict {
  return TRANSLATIONS[lang] ?? FR;
}
