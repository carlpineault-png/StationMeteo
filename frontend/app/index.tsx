import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { storage } from "@/src/utils/storage";

// ---------- Types ----------
type Unit = "C" | "F";

type Place = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type WeatherData = {
  current: {
    temperature: number;
    apparent: number;
    weatherCode: number;
    windSpeed: number;
    humidity: number;
    isDay: number;
    time: string;
    rain: number; // mm
    snowfall: number; // cm
    precipitation: number; // mm (total)
  };
  hourly: { time: string; temp: number; apparent: number; code: number; precip: number; sunshine: number }[];
  // Full hourly arrays for 7 days, used by the day timeline bar
  hourlyAll: {
    time: string[];
    sunshine: number[]; // seconds in the hour (0..3600)
    precipitation: number[]; // mm in the hour
  };
  daily: {
    date: string;
    tMax: number;
    tMin: number;
    aMax: number;
    aMin: number;
    code: number;
    rainSum: number; // mm
    snowSum: number; // cm
    windMax: number; // km/h
    gustMax: number; // km/h
  }[];
  timezone: string;
};

// ---------- Weather code mapping (WMO) ----------
const WEATHER_INFO: Record<
  number,
  { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; nightIcon?: keyof typeof MaterialCommunityIcons.glyphMap }
> = {
  0: { label: "Ciel dégagé", icon: "weather-sunny", nightIcon: "weather-night" },
  1: { label: "Plutôt clair", icon: "weather-partly-cloudy", nightIcon: "weather-night-partly-cloudy" },
  2: { label: "Partiellement nuageux", icon: "weather-partly-cloudy", nightIcon: "weather-night-partly-cloudy" },
  3: { label: "Couvert", icon: "weather-cloudy" },
  45: { label: "Brouillard", icon: "weather-fog" },
  48: { label: "Brouillard givrant", icon: "weather-fog" },
  51: { label: "Bruine légère", icon: "weather-partly-rainy" },
  53: { label: "Bruine", icon: "weather-partly-rainy" },
  55: { label: "Bruine dense", icon: "weather-pouring" },
  56: { label: "Bruine verglaçante", icon: "weather-snowy-rainy" },
  57: { label: "Bruine verglaçante dense", icon: "weather-snowy-rainy" },
  61: { label: "Pluie faible", icon: "weather-rainy" },
  63: { label: "Pluie", icon: "weather-pouring" },
  65: { label: "Pluie forte", icon: "weather-pouring" },
  66: { label: "Pluie verglaçante", icon: "weather-snowy-rainy" },
  67: { label: "Pluie verglaçante forte", icon: "weather-snowy-rainy" },
  71: { label: "Neige faible", icon: "weather-snowy" },
  73: { label: "Neige", icon: "weather-snowy-heavy" },
  75: { label: "Neige forte", icon: "weather-snowy-heavy" },
  77: { label: "Grains de neige", icon: "weather-snowy" },
  80: { label: "Averses", icon: "weather-pouring" },
  81: { label: "Averses fortes", icon: "weather-pouring" },
  82: { label: "Averses violentes", icon: "weather-pouring" },
  85: { label: "Averses de neige", icon: "weather-snowy-heavy" },
  86: { label: "Averses de neige fortes", icon: "weather-snowy-heavy" },
  95: { label: "Orage", icon: "weather-lightning" },
  96: { label: "Orage avec grêle", icon: "weather-lightning" },
  99: { label: "Orage violent", icon: "weather-lightning" },
};

function infoFor(code: number, isDay = 1) {
  const info = WEATHER_INFO[code] ?? { label: "—", icon: "weather-cloudy" as const };
  const icon = !isDay && info.nightIcon ? info.nightIcon : info.icon;
  return { label: info.label, icon };
}

// ---------- Gradient + Background image by condition ----------
function gradientFor(code: number, isDay = 1): [string, string, ...string[]] {
  if (!isDay) return ["rgba(15,32,39,0.55)", "rgba(44,83,100,0.65)"];
  if (code === 0 || code === 1) return ["rgba(77,160,176,0.35)", "rgba(211,157,56,0.45)"];
  if (code === 2 || code === 3 || code === 45 || code === 48) return ["rgba(117,127,154,0.45)", "rgba(215,221,232,0.45)"];
  if (code >= 51 && code <= 67) return ["rgba(44,62,80,0.55)", "rgba(52,152,219,0.55)"];
  if (code >= 71 && code <= 86) return ["rgba(131,164,212,0.45)", "rgba(182,251,255,0.45)"];
  if (code >= 95) return ["rgba(55,59,68,0.65)", "rgba(66,134,244,0.6)"];
  return ["rgba(77,160,176,0.35)", "rgba(211,157,56,0.45)"];
}

// Background photo (local assets). Chosen by weather group + day/night.
const BG_IMAGES = {
  sun: require("../assets/weather/sun.jpg"),
  partly: require("../assets/weather/partly.jpg"),
  cloudy: require("../assets/weather/cloudy.jpg"),
  fog: require("../assets/weather/fog.jpg"),
  rain: require("../assets/weather/rain.jpg"),
  snow: require("../assets/weather/snow.jpg"),
  night: require("../assets/weather/night.jpg"),
  storm: require("../assets/weather/storm.jpg"),
};

function backgroundFor(code: number, isDay = 1) {
  if (!isDay) return BG_IMAGES.night;
  if (code === 0 || code === 1) return BG_IMAGES.sun;
  if (code === 2) return BG_IMAGES.partly;
  if (code === 3) return BG_IMAGES.cloudy;
  if (code === 45 || code === 48) return BG_IMAGES.fog;
  if (code >= 51 && code <= 67) return BG_IMAGES.rain;
  if (code >= 71 && code <= 86) return BG_IMAGES.snow;
  if (code >= 95) return BG_IMAGES.storm;
  return BG_IMAGES.sun;
}

// ---------- Unit helpers ----------
const cToF = (c: number) => c * 1.8 + 32;
function fmtTemp(celsius: number, unit: Unit) {
  const v = unit === "C" ? celsius : cToF(celsius);
  return `${Math.round(v)}°`;
}

// ---------- French date helpers ----------
const DAYS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const DAYS_FR_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function formatLongDate(d: Date) {
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

// Format precipitation: rain in mm, snow in cm. Returns null if dry.
function formatPrecip(rainMm: number, snowCm: number): string | null {
  const parts: string[] = [];
  if (snowCm > 0.05) parts.push(`Neige ${snowCm.toFixed(1).replace(".", ",")} cm`);
  if (rainMm > 0.05) parts.push(`Pluie ${rainMm.toFixed(1).replace(".", ",")} mm`);
  return parts.length === 0 ? null : parts.join(" • ");
}

// ---------- API ----------
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

async function geocodeCity(query: string): Promise<Place[]> {
  const url = `${OM_GEOCODE}?name=${encodeURIComponent(query)}&count=8&language=fr&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erreur géocodage");
  const data = await res.json();
  return (data.results ?? []) as Place[];
}

async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; country?: string; admin1?: string }> {
  // Use expo-location's native reverse geocoding (Apple Maps on iOS, Google on Android)
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    const r = results?.[0];
    if (r) {
      const name = r.city || r.subregion || r.district || r.name || "Ma position";
      return { name, country: r.country ?? undefined, admin1: r.region ?? undefined };
    }
  } catch {
    // ignore and fall through
  }
  return { name: "Ma position" };
}

async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day,rain,showers,snowfall,precipitation",
    hourly: "temperature_2m,apparent_temperature,weather_code,sunshine_duration,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,rain_sum,showers_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max",
    timezone: "auto",
    forecast_days: "7",
  });
  const res = await fetch(`${OM_FORECAST}?${params.toString()}`);
  if (!res.ok) throw new Error("Erreur météo");
  const d = await res.json();

  // Next 24h slice starting from now
  const nowIso = d.current?.time as string;
  const allTimes: string[] = d.hourly?.time ?? [];
  const startIdx = Math.max(0, allTimes.findIndex((t) => t >= nowIso));
  const sliceIdx = startIdx === -1 ? 0 : startIdx;
  const hourly = allTimes.slice(sliceIdx, sliceIdx + 24).map((t, i) => ({
    time: t,
    temp: d.hourly.temperature_2m[sliceIdx + i],
    apparent: d.hourly.apparent_temperature?.[sliceIdx + i] ?? d.hourly.temperature_2m[sliceIdx + i],
    code: d.hourly.weather_code[sliceIdx + i],
    precip: d.hourly.precipitation?.[sliceIdx + i] ?? 0,
    sunshine: d.hourly.sunshine_duration?.[sliceIdx + i] ?? 0,
  }));

  const daily = (d.daily?.time ?? []).map((date: string, i: number) => ({
    date,
    tMax: d.daily.temperature_2m_max[i],
    tMin: d.daily.temperature_2m_min[i],
    aMax: d.daily.apparent_temperature_max?.[i] ?? d.daily.temperature_2m_max[i],
    aMin: d.daily.apparent_temperature_min?.[i] ?? d.daily.temperature_2m_min[i],
    code: d.daily.weather_code[i],
    rainSum: (d.daily.rain_sum?.[i] ?? 0) + (d.daily.showers_sum?.[i] ?? 0),
    snowSum: d.daily.snowfall_sum?.[i] ?? 0,
    windMax: d.daily.wind_speed_10m_max?.[i] ?? 0,
    gustMax: d.daily.wind_gusts_10m_max?.[i] ?? 0,
  }));

  return {
    current: {
      temperature: d.current.temperature_2m,
      apparent: d.current.apparent_temperature,
      weatherCode: d.current.weather_code,
      windSpeed: d.current.wind_speed_10m,
      humidity: d.current.relative_humidity_2m,
      isDay: d.current.is_day,
      time: d.current.time,
      rain: (d.current.rain ?? 0) + (d.current.showers ?? 0),
      snowfall: d.current.snowfall ?? 0,
      precipitation: d.current.precipitation ?? 0,
    },
    hourly,
    hourlyAll: {
      time: allTimes,
      sunshine: d.hourly.sunshine_duration ?? [],
      precipitation: d.hourly.precipitation ?? [],
    },
    daily,
    timezone: d.timezone,
  };
}

// ---------- Storage keys ----------
const K_UNIT = "weather.unit";
const K_PLACE = "weather.place";

// ---------- Day-timeline helpers ----------
type HourSample = { hour: number; sunshine: number; precip: number };

function getDayHours(
  all: { time: string[]; sunshine: number[]; precipitation: number[] },
  date: string,
): HourSample[] {
  const out: HourSample[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, sunshine: 0, precip: 0 }));
  for (let idx = 0; idx < all.time.length; idx++) {
    const t = all.time[idx];
    if (!t.startsWith(date)) continue;
    const hour = parseInt(t.slice(11, 13), 10);
    if (hour >= 0 && hour < 24) {
      out[hour] = {
        hour,
        sunshine: all.sunshine[idx] ?? 0,
        precip: all.precipitation[idx] ?? 0,
      };
    }
  }
  return out;
}

function segmentColor(s: HourSample): string {
  if (s.precip >= 0.05) {
    // Blue, deeper for heavier rain
    if (s.precip >= 2) return "#1976D2";
    if (s.precip >= 0.5) return "#42A5F5";
    return "#90CAF9";
  }
  if (s.sunshine >= 1800) return "#FFC83D"; // mostly sunny in this hour
  if (s.sunshine >= 600) return "#FFE082"; // partly sunny
  return "rgba(255,255,255,0.18)"; // cloudy / night
}

// Background tint for hourly card (semi-transparent over the global background)
function hourCardTint(precip: number, sunshine: number, code: number): string {
  if (precip >= 0.05) {
    // Blue tint — deeper for heavier rain
    if (precip >= 2) return "rgba(25,118,210,0.78)";
    if (precip >= 0.5) return "rgba(66,165,245,0.72)";
    return "rgba(144,202,249,0.62)";
  }
  if (sunshine >= 1800) return "rgba(255,200,61,0.62)"; // sunny
  if (sunshine >= 600) return "rgba(255,224,130,0.50)"; // partly sunny
  // Cloudy / night : grayish
  if (code === 3 || code === 45 || code === 48) return "rgba(120,130,145,0.65)"; // overcast/fog
  return "rgba(95,105,120,0.65)"; // default cloudy/gray
}

// ---------- Alerts ----------
type WAlert = { kind: "wind" | "storm" | "snow" | "rain"; label: string; day: string };

function computeAlerts(
  daily: { date: string; code: number; gustMax: number; windMax: number; snowSum: number; rainSum: number }[],
): WAlert[] {
  const out: WAlert[] = [];
  daily.forEach((d, i) => {
    const date = new Date(`${d.date}T12:00:00`);
    const when = i === 0 ? "aujourd'hui" : i === 1 ? "demain" : DAYS_FR[date.getDay()].toLowerCase();
    if (d.gustMax >= 70) {
      out.push({ kind: "wind", day: d.date, label: `Vent fort ${when} — rafales jusqu'à ${Math.round(d.gustMax)} km/h` });
    } else if (d.windMax >= 60) {
      out.push({ kind: "wind", day: d.date, label: `Vent soutenu ${when} — jusqu'à ${Math.round(d.windMax)} km/h` });
    }
    if (d.code >= 95) {
      out.push({ kind: "storm", day: d.date, label: `Orage prévu ${when}` });
    }
    if (d.snowSum >= 5) {
      out.push({ kind: "snow", day: d.date, label: `Fortes chutes de neige ${when} — ${d.snowSum.toFixed(1).replace(".", ",")} cm` });
    }
    if (d.rainSum >= 25) {
      out.push({ kind: "rain", day: d.date, label: `Fortes pluies ${when} — ${d.rainSum.toFixed(0)} mm` });
    }
  });
  return out;
}

const ALERT_ICON: Record<WAlert["kind"], keyof typeof MaterialCommunityIcons.glyphMap> = {
  wind: "weather-windy",
  storm: "weather-lightning",
  snow: "weather-snowy-heavy",
  rain: "weather-pouring",
};

// ---------- Main screen ----------
export default function Index() {
  const { width, height } = useWindowDimensions();
  const isWide = width >= 900; // iPad landscape / large iPad
  // Scale factor based on screen height — 1.0 for iPad 13" (1024px), down to 0.78 for smaller iPads
  const s = Math.max(0.78, Math.min(1.0, height / 1024));
  const fs = (v: number) => Math.round(v * s);

  const [unit, setUnit] = useState<Unit>("C");
  const [place, setPlace] = useState<Place | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [now, setNow] = useState<Date>(new Date());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick the clock every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load persisted preferences on mount
  useEffect(() => {
    (async () => {
      const storedUnit = await storage.getItem<string>(K_UNIT, "C");
      if (storedUnit === "F" || storedUnit === "C") setUnit(storedUnit);
      const storedPlace = await storage.getItem<string>(K_PLACE, "");
      if (storedPlace) {
        try {
          const p = JSON.parse(storedPlace) as Place;
          setPlace(p);
          await loadWeather(p);
          return;
        } catch {}
      }
      // No saved place — try geolocation, otherwise fall back to Paris
      await requestGeolocation(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [hourlyCanLeft, setHourlyCanLeft] = useState(false);
  const [hourlyCanRight, setHourlyCanRight] = useState(false);

  const [mapExpanded, setMapExpanded] = useState(false);
  const [alertDismissedUntil, setAlertDismissedUntil] = useState<number>(0);

  const handleHourlyScroll = useCallback((e: { nativeEvent: { contentOffset: { x: number }; layoutMeasurement: { width: number }; contentSize: { width: number } } }) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const x = contentOffset.x;
    const maxX = Math.max(0, contentSize.width - layoutMeasurement.width);
    setHourlyCanLeft(x > 4);
    setHourlyCanRight(x < maxX - 4);
  }, []);

  const persistUnit = useCallback(async (u: Unit) => {
    setUnit(u);
    await storage.setItem(K_UNIT, u);
  }, []);

  const persistPlace = useCallback(async (p: Place) => {
    await storage.setItem(K_PLACE, JSON.stringify(p));
  }, []);

  const loadWeather = useCallback(async (p: Place) => {
    setLoading(true);
    setError(null);
    try {
      const w = await fetchWeather(p.latitude, p.longitude);
      setWeather(w);
    } catch (e) {
      setError("Impossible de récupérer la météo. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, []);

  const requestGeolocation = useCallback(
    async (silent = false) => {
      setError(null);
      try {
        const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (silent) {
            // Fallback default city
            const fallback: Place = {
              name: "Paris",
              country: "France",
              latitude: 48.8566,
              longitude: 2.3522,
            };
            setPlace(fallback);
            await persistPlace(fallback);
            await loadWeather(fallback);
            return;
          }
          if (!canAskAgain) {
            setError("Permission refusée. Ouvrez les Réglages pour autoriser la localisation.");
          } else {
            setError("Permission de localisation refusée.");
          }
          return;
        }
        setLoading(true);
        const pos = await Location.getCurrentPositionAsync({});
        const geo = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        const p: Place = {
          name: geo.name,
          country: geo.country,
          admin1: geo.admin1,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        setPlace(p);
        await persistPlace(p);
        await loadWeather(p);
      } catch (e) {
        if (!silent) setError("Localisation indisponible.");
        // fallback
        const fallback: Place = {
          name: "Paris",
          country: "France",
          latitude: 48.8566,
          longitude: 2.3522,
        };
        setPlace(fallback);
        await persistPlace(fallback);
        await loadWeather(fallback);
      } finally {
        setLoading(false);
      }
    },
    [loadWeather, persistPlace],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await geocodeCity(q);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const pickPlace = useCallback(
    async (p: Place) => {
      setPlace(p);
      setSearchQuery("");
      setSearchResults([]);
      setShowResults(false);
      Keyboard.dismiss();
      await persistPlace(p);
      await loadWeather(p);
    },
    [loadWeather, persistPlace],
  );

  // Derived values
  const gradient = useMemo(() => {
    if (!weather) return ["rgba(15,32,39,0.55)", "rgba(44,83,100,0.55)"] as [string, string];
    return gradientFor(weather.current.weatherCode, weather.current.isDay);
  }, [weather]);

  const bgImage = useMemo(() => {
    if (!weather) return BG_IMAGES.night;
    return backgroundFor(weather.current.weatherCode, weather.current.isDay);
  }, [weather]);

  const currentInfo = useMemo(() => {
    if (!weather) return { label: "—", icon: "weather-cloudy" as const };
    return infoFor(weather.current.weatherCode, weather.current.isDay);
  }, [weather]);

  const placeLabel = useMemo(() => {
    if (!place) return "—";
    const parts = [place.name, place.admin1, place.country].filter(Boolean);
    return parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : parts[0] ?? "—";
  }, [place]);

  const alerts = useMemo(() => (weather ? computeAlerts(weather.daily) : []), [weather]);
  // Alert is visible if there are alerts and we are past the dismiss expiry timestamp
  const showAlert = alerts.length > 0 && Date.now() >= alertDismissedUntil;

  // Build the Windy embed URL centered on current location, layer = rain
  const windyUrl = useMemo(() => {
    if (!place) return null;
    const lat = place.latitude.toFixed(3);
    const lon = place.longitude.toFixed(3);
    const params = new URLSearchParams({
      lat,
      lon,
      zoom: "6",
      overlay: "clouds",
      level: "surface",
      menu: "",
      message: "true",
      marker: "true",
      calendar: "now",
      pressure: "",
      type: "map",
      location: "coordinates",
      detail: "",
      metricWind: "km/h",
      metricTemp: "°C",
      radarRange: "-1",
    });
    return `https://embed.windy.com/embed2.html?${params.toString()}`;
  }, [place]);

  return (
    <View style={styles.root} testID="weather-screen">
      <ImageBackground source={bgImage} style={StyleSheet.absoluteFill} resizeMode="cover" testID="weather-background">
        <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <View style={styles.darkOverlay} />
      </ImageBackground>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* HEADER */}
          <View style={styles.header}>
            <View style={styles.searchWrap}>
              {showAlert ? (
                <View style={styles.alertBar} testID="alert-bar">
                  <MaterialCommunityIcons name={ALERT_ICON[alerts[0].kind]} size={28} color="#fff" />
                  <View style={styles.flex}>
                    <Text style={styles.alertBarTitle}>Alerte météo</Text>
                    <Text style={styles.alertBarText} numberOfLines={1}>{alerts[0].label}</Text>
                  </View>
                  <TouchableOpacity
                    testID="alert-dismiss-button"
                    onPress={() => setAlertDismissedUntil(Date.now() + 10 * 60 * 1000)}
                    hitSlop={12}
                    style={styles.alertBarClose}
                  >
                    <MaterialCommunityIcons name="close-circle" size={28} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.searchBar}>
                    <MaterialCommunityIcons name="magnify" size={28} color="#fff" />
                    <TextInput
                      testID="search-city-input"
                      value={searchQuery}
                      onChangeText={(t) => {
                        setSearchQuery(t);
                        setShowResults(true);
                      }}
                      onFocus={() => setShowResults(true)}
                      placeholder="Rechercher une ville…"
                      placeholderTextColor="rgba(255,255,255,0.7)"
                      style={styles.searchInput}
                      returnKeyType="search"
                      autoCorrect={false}
                    />
                    {searching ? <ActivityIndicator color="#fff" /> : null}
                    {searchQuery.length > 0 ? (
                      <TouchableOpacity
                        testID="search-clear-button"
                        onPress={() => {
                          setSearchQuery("");
                          setSearchResults([]);
                        }}
                        hitSlop={12}
                      >
                        <MaterialCommunityIcons name="close-circle" size={26} color="rgba(255,255,255,0.85)" />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {showResults && searchResults.length > 0 ? (
                    <View style={styles.resultsBox} testID="search-results">
                      {searchResults.map((r, i) => (
                        <TouchableOpacity
                          key={`${r.name}-${r.latitude}-${r.longitude}-${i}`}
                          style={styles.resultItem}
                          onPress={() => pickPlace(r)}
                          testID={`search-result-${i}`}
                        >
                          <MaterialCommunityIcons name="map-marker" size={26} color="#111" />
                          <Text style={styles.resultText} numberOfLines={1}>
                            {r.name}
                            {r.admin1 ? `, ${r.admin1}` : ""}
                            {r.country ? ` — ${r.country}` : ""}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
            </View>

            <TouchableOpacity
              testID="geolocation-button"
              style={styles.iconBtn}
              onPress={() => requestGeolocation(false)}
              accessibilityLabel="Utiliser ma position"
            >
              <MaterialCommunityIcons name="crosshairs-gps" size={36} color="#fff" />
            </TouchableOpacity>

            <View style={styles.unitToggle} testID="unit-toggle-button">
              <Pressable
                onPress={() => persistUnit("C")}
                style={[styles.unitChip, unit === "C" && styles.unitChipActive]}
                testID="unit-celsius"
              >
                <Text style={[styles.unitText, unit === "C" && styles.unitTextActive]}>°C</Text>
              </Pressable>
              <Pressable
                onPress={() => persistUnit("F")}
                style={[styles.unitChip, unit === "F" && styles.unitChipActive]}
                testID="unit-fahrenheit"
              >
                <Text style={[styles.unitText, unit === "F" && styles.unitTextActive]}>°F</Text>
              </Pressable>
            </View>
          </View>

          {error ? (
            <View style={styles.errorBox} testID="error-banner">
              <MaterialCommunityIcons name="alert-circle" size={28} color="#fff" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => Linking.openSettings()} testID="open-settings-button">
                <Text style={styles.errorLink}>Ouvrir les Réglages</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* BODY */}
          {/* MAIN — no scroll, fills the screen */}
          <View
            style={styles.body}
            onStartShouldSetResponder={() => {
              if (showResults) setShowResults(false);
              Keyboard.dismiss();
              return false;
            }}
          >
            {/* TOP ROW — hero (clock+date+current) + hourly | windy map */}
            <View style={styles.topRow}>
              {/* LEFT — hero combined card + hourly */}
              <View style={styles.topLeft}>
                <View style={styles.heroCard} testID="hero-card">
                  {/* Row: time on left, date + city on right */}
                  <View style={styles.heroTopRow}>
                    <Text style={[styles.clockTime, { fontSize: fs(70), lineHeight: fs(76) }]} testID="clock-time-display">
                      {pad2(now.getHours())}:{pad2(now.getMinutes())}
                    </Text>
                    <View style={styles.heroDateBlock}>
                      <Text style={[styles.cityName, { fontSize: fs(22) }]} numberOfLines={1} testID="city-name">
                        {placeLabel}
                      </Text>
                      <Text style={[styles.clockDate, { fontSize: fs(20), lineHeight: fs(24) }]} testID="clock-date-display">
                        {formatLongDate(now)}
                      </Text>
                    </View>
                  </View>
                  {/* Divider */}
                  <View style={styles.heroDivider} />
                  {/* Bottom: weather icon + temp + condition + details */}
                  {loading && !weather ? (
                    <ActivityIndicator size="large" color="#fff" style={{ marginVertical: 24 }} />
                  ) : weather ? (
                    <View style={styles.heroWeatherRow}>
                      <MaterialCommunityIcons name={currentInfo.icon} size={fs(92)} color="#fff" />
                      <View style={styles.flex}>
                        <View style={styles.tempLine}>
                          <Text style={[styles.currentTemp, { fontSize: fs(72), lineHeight: fs(78) }]} testID="current-temperature">
                            {fmtTemp(weather.current.temperature, unit)}
                          </Text>
                          <Text style={[styles.currentFeels, { fontSize: fs(18) }]} testID="current-feels-like">
                            Ressenti {fmtTemp(weather.current.apparent, unit)}
                          </Text>
                        </View>
                        <Text style={[styles.conditionText, { fontSize: fs(22) }]}>{currentInfo.label}</Text>
                        <Text style={[styles.feelsLike, { fontSize: fs(15) }]}>
                          Humidité {Math.round(weather.current.humidity)}% • Vent {Math.round(weather.current.windSpeed)} km/h
                        </Text>
                        {formatPrecip(weather.current.rain, weather.current.snowfall) ? (
                          <View style={styles.precipBadge} testID="current-precip">
                            <MaterialCommunityIcons
                              name={weather.current.snowfall > 0 ? "weather-snowy-heavy" : "weather-pouring"}
                              size={fs(20)}
                              color="#fff"
                            />
                            <Text style={[styles.precipText, { fontSize: fs(15) }]}>
                              {formatPrecip(weather.current.rain, weather.current.snowfall)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>

                {/* HOURLY under hero */}
                <View style={styles.hourlyContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.hourlyRow}
                    style={styles.hourlyScroll}
                    onScroll={handleHourlyScroll}
                    onContentSizeChange={(w) => setHourlyCanRight(w > 0)}
                    onLayout={(ev) => {
                      const layoutW = ev.nativeEvent.layout.width;
                      if (layoutW > 0) setHourlyCanRight(true);
                    }}
                    scrollEventThrottle={16}
                    testID="hourly-forecast-scroll"
                  >
                    {weather?.hourly.map((h, i) => {
                      const date = new Date(h.time);
                      const label = i === 0 ? "Maintenant" : `${pad2(date.getHours())}h`;
                      const info = infoFor(h.code, 1);
                      const tint = hourCardTint(h.precip, h.sunshine, h.code);
                      const showPrecip = h.precip >= 0.05;
                      return (
                        <View
                          key={h.time}
                          style={[styles.hourCard, { backgroundColor: tint }]}
                          testID={`hour-item-${i}`}
                        >
                          <Text style={[styles.hourLabel, { fontSize: fs(15) }]}>{label}</Text>
                          <MaterialCommunityIcons name={info.icon} size={fs(34)} color="#fff" />
                          <Text style={[styles.hourTemp, { fontSize: fs(22) }]}>{fmtTemp(h.temp, unit)}</Text>
                          <Text style={[styles.hourFeels, { fontSize: fs(12) }]} testID={`hour-feels-${i}`}>
                            ress. {fmtTemp(h.apparent, unit)}
                          </Text>
                          {showPrecip ? (
                            <Text style={[styles.hourPrecip, { fontSize: fs(12) }]} testID={`hour-precip-${i}`}>
                              {h.precip.toFixed(1).replace(".", ",")} mm
                            </Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </ScrollView>
                  {hourlyCanLeft ? (
                    <>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.hourlyFade, styles.hourlyFadeLeft]}
                      />
                      <View style={[styles.hourlyFadeChevron, styles.hourlyFadeChevronLeft]} pointerEvents="none" testID="hourly-chevron-left">
                        <MaterialCommunityIcons name="chevron-left" size={40} color="#fff" />
                      </View>
                    </>
                  ) : null}
                  {hourlyCanRight ? (
                    <>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.hourlyFade, styles.hourlyFadeRight]}
                      />
                      <View style={[styles.hourlyFadeChevron, styles.hourlyFadeChevronRight]} pointerEvents="none" testID="hourly-chevron-right">
                        <MaterialCommunityIcons name="chevron-right" size={40} color="#fff" />
                      </View>
                    </>
                  ) : null}
                </View>
              </View>

              {/* RIGHT — Windy rain map */}
              <View style={styles.topRight}>
                <View style={styles.mapCard} testID="windy-map-card">
                  {windyUrl ? (
                    <WebView
                      source={{ uri: windyUrl }}
                      style={styles.mapWebView}
                      javaScriptEnabled
                      domStorageEnabled
                      allowsInlineMediaPlayback
                      originWhitelist={["*"]}
                      startInLoadingState
                      renderLoading={() => (
                        <View style={styles.mapLoading}>
                          <ActivityIndicator color="#fff" size="large" />
                        </View>
                      )}
                    />
                  ) : (
                    <View style={styles.mapLoading}>
                      <ActivityIndicator color="#fff" size="large" />
                    </View>
                  )}
                  <TouchableOpacity
                    testID="map-expand-button"
                    style={styles.mapExpandBtn}
                    onPress={() => setMapExpanded(true)}
                    hitSlop={8}
                  >
                    <MaterialCommunityIcons name="arrow-expand" size={22} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.mapTag} pointerEvents="none">
                    <MaterialCommunityIcons name="weather-cloudy" size={16} color="#fff" />
                    <Text style={styles.mapTagText}>Nuages en temps réel</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* BOTTOM — 7-day forecast full width */}
            <View style={[styles.bottomSection, { minHeight: Math.round(290 * s) }]}>
              <View style={styles.dailyList} testID="daily-forecast-list">
                <View style={styles.tickHeader} pointerEvents="none">
                  <View style={styles.tickHeaderLeftSpacer} />
                  <View style={styles.tickHeaderTrack}>
                    {[6, 12, 18, 24].map((h) => (
                      <Text
                        key={h}
                        style={[styles.tickLabel, { left: `${(h / 24) * 100}%` }]}
                      >
                        {h}h
                      </Text>
                    ))}
                  </View>
                  <View style={styles.tickHeaderRightSpacer} />
                </View>

                {weather?.daily.map((d, i) => {
                  const date = new Date(`${d.date}T12:00:00`);
                  const dayName = i === 0 ? "Aujourd'hui" : DAYS_FR_SHORT[date.getDay()];
                  const info = infoFor(d.code, 1);
                  const precipLabel = formatPrecip(d.rainSum, d.snowSum);
                  const hours = weather ? getDayHours(weather.hourlyAll, d.date) : [];
                  return (
                    <View key={d.date} style={styles.dailyRow} testID={`day-item-${i}`}>
                      <View style={styles.dailyDayCol}>
                        <Text style={[styles.dailyDay, { fontSize: fs(17) }]}>{dayName}</Text>
                        {precipLabel ? (
                          <Text style={[styles.dailyPrecip, { fontSize: fs(11) }]} testID={`day-precip-${i}`}>
                            {precipLabel}
                          </Text>
                        ) : null}
                      </View>
                      <MaterialCommunityIcons name={info.icon} size={fs(32)} color="#fff" style={{ width: fs(38) }} />
                      <View style={styles.dailyTempCol}>
                        <Text style={[styles.dailyMin, { fontSize: fs(17) }]}>{fmtTemp(d.tMin, unit)}</Text>
                        <Text style={[styles.dailyFeels, { fontSize: fs(10) }]} testID={`day-feels-min-${i}`}>
                          ress. {fmtTemp(d.aMin, unit)}
                        </Text>
                      </View>
                      <View style={styles.timelineWrap} testID={`day-timeline-${i}`}>
                        <View style={styles.timelineTrack}>
                          {hours.map((s) => (
                            <View
                              key={s.hour}
                              style={[styles.timelineSegment, { backgroundColor: segmentColor(s) }]}
                            />
                          ))}
                        </View>
                        <View style={styles.timelineGrid} pointerEvents="none">
                          {[6, 12, 18].map((h) => (
                            <View key={h} style={[styles.timelineGridLine, { left: `${(h / 24) * 100}%` }]} />
                          ))}
                        </View>
                      </View>
                      <View style={styles.dailyTempCol}>
                        <Text style={[styles.dailyMax, { fontSize: fs(17) }]}>{fmtTemp(d.tMax, unit)}</Text>
                        <Text style={[styles.dailyFeels, { fontSize: fs(10) }]} testID={`day-feels-max-${i}`}>
                          ress. {fmtTemp(d.aMax, unit)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* FULLSCREEN MAP MODAL */}
      <Modal
        visible={mapExpanded}
        animationType="fade"
        onRequestClose={() => setMapExpanded(false)}
        statusBarTranslucent
      >
        <View style={styles.modalRoot} testID="map-fullscreen-modal">
          {windyUrl ? (
            <WebView
              source={{ uri: windyUrl }}
              style={styles.flex}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              originWhitelist={["*"]}
            />
          ) : null}
          <SafeAreaView style={styles.modalCloseWrap} edges={["top", "right"]} pointerEvents="box-none">
            <TouchableOpacity
              testID="map-close-button"
              onPress={() => setMapExpanded(false)}
              style={styles.modalCloseBtn}
            >
              <MaterialCommunityIcons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Daily bar helpers ----------
function tempBarPosition(min: number, daily: WeatherData["daily"]) {
  if (daily.length === 0) return 0;
  const allMin = Math.min(...daily.map((d) => d.tMin));
  const allMax = Math.max(...daily.map((d) => d.tMax));
  const range = Math.max(1, allMax - allMin);
  return ((min - allMin) / range) * 100;
}
function tempBarWidth(min: number, max: number, daily: WeatherData["daily"]) {
  if (daily.length === 0) return 0;
  const allMin = Math.min(...daily.map((d) => d.tMin));
  const allMax = Math.max(...daily.map((d) => d.tMax));
  const range = Math.max(1, allMax - allMin);
  return Math.max(8, ((max - min) / range) * 100);
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F2027" },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  safe: { flex: 1 },
  flex: { flex: 1 },

  // HEADER
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 12,
    zIndex: 10,
  },
  searchWrap: { flex: 1, position: "relative" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "500",
    paddingVertical: 0,
  },
  resultsBox: {
    position: "absolute",
    top: 56,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 20,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    minHeight: 48,
  },
  resultText: { fontSize: 18, color: "#111", flex: 1, fontWeight: "500" },

  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },

  unitToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 24,
    padding: 3,
    minHeight: 48,
    alignItems: "center",
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 52,
    alignItems: "center",
  },
  unitChipActive: { backgroundColor: "#fff" },
  unitText: { fontSize: 20, color: "#fff", fontWeight: "700" },
  unitTextActive: { color: "#111" },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 24,
    backgroundColor: "rgba(220,38,38,0.85)",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    flexWrap: "wrap",
  },
  errorText: { color: "#fff", fontSize: 18, fontWeight: "500", flex: 1 },
  errorLink: { color: "#fff", fontSize: 18, fontWeight: "700", textDecorationLine: "underline" },

  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },

  // STATION LAYOUT — fills viewport, no scroll
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
    flexDirection: "column",
    gap: 10,
  },
  topRow: { flex: 1, flexDirection: "row", gap: 12 },
  topLeft: { flex: 1, gap: 10 },
  topRight: { flex: 1.1, gap: 8 },
  bottomSection: { flexShrink: 0, minHeight: 290, gap: 4 },

  // MAIN LAYOUT
  mainArea: { flexDirection: "column", gap: 24, marginTop: 12 },
  mainAreaWide: { flexDirection: "row", alignItems: "flex-start" },

  heroCol: { gap: 24 },
  heroColWide: { flex: 6, marginRight: 24 },

  forecastCol: { gap: 12 },
  forecastColWide: { flex: 5 },

  // CLOCK + CURRENT combined hero card
  heroCard: {
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 22,
    gap: 10,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  heroDateBlock: { alignItems: "flex-end", flexShrink: 1 },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  heroWeatherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  tempLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 14,
  },
  clockTime: {
    color: "#fff",
    fontSize: 70,
    fontWeight: "900",
    letterSpacing: -3,
    lineHeight: 76,
    fontVariant: ["tabular-nums"],
  },
  clockDate: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "right",
    textTransform: "capitalize",
    lineHeight: 24,
  },
  cityName: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "right",
  },
  currentTemp: {
    color: "#fff",
    fontSize: 72,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 78,
  },
  currentFeels: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 18,
    fontWeight: "700",
  },
  conditionText: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 2 },
  feelsLike: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "500", marginTop: 2 },
  precipBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(52,152,219,0.7)",
  },
  precipText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // MAP (Windy)
  mapCard: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 22,
    overflow: "hidden",
    position: "relative",
    minHeight: 200,
  },
  mapWebView: { flex: 1, backgroundColor: "transparent" },
  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  mapExpandBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  mapTag: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  mapTagText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // MAP fullscreen modal
  modalRoot: { flex: 1, backgroundColor: "#000" },
  modalCloseWrap: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  modalCloseBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    margin: 16,
  },

  // ALERT bar (replaces search bar when alert active)
  alertBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(180,30,30,0.92)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
    minHeight: 48,
  },
  alertBarTitle: {
    color: "#FFD66B",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  alertBarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  alertBarClose: { padding: 4 },

  // KEEP OLD STYLES for backwards-compat reference (unused now)
  clockCard: { display: "none" },
  currentCard: { display: "none" },
  currentRow: { display: "none" },
  tempBlock: { display: "none" },
  precipBadgeOld: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(52,152,219,0.65)",
  },
  precipTextOld: { color: "#fff", fontSize: 18, fontWeight: "700" },

  // SECTION
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 2,
  },

  // HOURLY
  hourlyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  hourlyContainer: { position: "relative" },
  hourlyScroll: { flexGrow: 0 },
  hourlyRow: { gap: 8, paddingHorizontal: 4, alignItems: "stretch" },
  hourlyFade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 56,
  },
  hourlyFadeLeft: { left: 0, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  hourlyFadeRight: { right: 0, borderTopRightRadius: 18, borderBottomRightRadius: 18 },
  hourlyFadeChevron: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  hourlyFadeChevronLeft: { left: 0 },
  hourlyFadeChevronRight: { right: 0 },
  hourCard: {
    width: 84,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    gap: 4,
  },
  hourLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  hourTemp: { color: "#fff", fontSize: 22, fontWeight: "800" },
  hourFeels: { color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "600" },
  hourPrecip: { color: "#fff", fontSize: 12, fontWeight: "800" },

  // DAILY
  dailyList: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  dailyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.18)",
  },
  dailyDayCol: { width: 120 },
  dailyDay: { color: "#fff", fontSize: 17, fontWeight: "700" },
  dailyPrecip: { color: "#9BD0FF", fontSize: 11, fontWeight: "700", marginTop: 1 },
  dailyTempCol: { width: 60, alignItems: "flex-end" },
  dailyMin: { color: "rgba(255,255,255,0.95)", fontSize: 17, fontWeight: "600" },
  dailyMax: { color: "#fff", fontSize: 17, fontWeight: "700" },
  dailyFeels: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: "600", marginTop: 0 },
  // DAILY TIMELINE BAR (24h)
  tickHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 12,
  },
  tickHeaderLeftSpacer: { width: 120 + 38 + 60 + 30 },
  tickHeaderRightSpacer: { width: 60 + 8 },
  tickHeaderTrack: {
    flex: 1,
    height: 18,
    position: "relative",
  },
  tickLabel: {
    position: "absolute",
    top: 0,
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "700",
    transform: [{ translateX: -14 }],
    width: 28,
    textAlign: "center",
  },
  timelineWrap: {
    flex: 1,
    height: 22,
    marginHorizontal: 8,
    position: "relative",
    justifyContent: "center",
  },
  timelineTrack: {
    flexDirection: "row",
    height: 18,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  timelineSegment: {
    flex: 1,
    height: "100%",
    marginHorizontal: 0.5,
  },
  timelineGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  timelineGridLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
  },

  // ALERTS
  alertSection: {
    backgroundColor: "rgba(140,30,30,0.85)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  alertHeaderText: {
    color: "#FFD66B",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  alertItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
  },
  alertText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },

  // OLD temp bar (kept for safety, no longer used)
  dailyBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginHorizontal: 8,
    position: "relative",
    overflow: "hidden",
  },
  dailyBarFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "#FFD66B",
    borderRadius: 4,
  },
});
