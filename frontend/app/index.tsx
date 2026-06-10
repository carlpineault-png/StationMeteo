import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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
  };
  hourly: Array<{ time: string; temp: number; code: number }>;
  daily: Array<{ date: string; tMax: number; tMin: number; code: number }>;
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

// ---------- Gradient by condition ----------
function gradientFor(code: number, isDay = 1): [string, string, ...string[]] {
  if (!isDay) return ["#0F2027", "#203A43", "#2C5364"];
  if (code === 0 || code === 1) return ["#4DA0B0", "#D39D38"];
  if (code === 2 || code === 3 || code === 45 || code === 48) return ["#757F9A", "#D7DDE8"];
  if (code >= 51 && code <= 67) return ["#2C3E50", "#3498DB"];
  if (code >= 71 && code <= 86) return ["#83a4d4", "#b6fbff"];
  if (code >= 95) return ["#373B44", "#4286f4"];
  return ["#4DA0B0", "#D39D38"];
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
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
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

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `${OM_GEOCODE}?latitude=${lat}&longitude=${lon}&count=1&language=fr&format=json`;
    const res = await fetch(url);
    if (!res.ok) return "Ma position";
    const data = await res.json();
    const r = data?.results?.[0];
    if (!r) return "Ma position";
    return r.name as string;
  } catch {
    return "Ma position";
  }
}

async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day",
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
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
    code: d.hourly.weather_code[sliceIdx + i],
  }));

  const daily = (d.daily?.time ?? []).map((date: string, i: number) => ({
    date,
    tMax: d.daily.temperature_2m_max[i],
    tMin: d.daily.temperature_2m_min[i],
    code: d.daily.weather_code[i],
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
    },
    hourly,
    daily,
    timezone: d.timezone,
  };
}

// ---------- Storage keys ----------
const K_UNIT = "weather.unit";
const K_PLACE = "weather.place";

// ---------- Main screen ----------
export default function Index() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900; // iPad landscape / large iPad

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
        const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        const p: Place = {
          name,
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
    if (!weather) return ["#0F2027", "#2C5364"] as [string, string];
    return gradientFor(weather.current.weatherCode, weather.current.isDay);
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

  return (
    <View style={styles.root} testID="weather-screen">
      <LinearGradient colors={gradient} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* HEADER */}
          <View style={styles.header}>
            <View style={styles.searchWrap}>
              <View style={styles.searchBar}>
                <MaterialCommunityIcons name="magnify" size={32} color="#fff" />
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
                    <MaterialCommunityIcons name="close-circle" size={30} color="rgba(255,255,255,0.85)" />
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
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => {
              setShowResults(false);
              Keyboard.dismiss();
            }}
          >
            <View style={[styles.mainArea, isWide && styles.mainAreaWide]}>
              {/* LEFT / TOP — clock & current */}
              <View style={[styles.heroCol, isWide && styles.heroColWide]}>
                <View style={styles.clockCard} testID="clock-card">
                  <Text style={styles.clockTime} testID="clock-time-display">
                    {pad2(now.getHours())}:{pad2(now.getMinutes())}
                  </Text>
                  <Text style={styles.clockDate}>{formatLongDate(now)}</Text>
                </View>

                <View style={styles.currentCard} testID="current-weather-card">
                  <Text style={styles.cityName} numberOfLines={1} testID="city-name">
                    {placeLabel}
                  </Text>
                  {loading && !weather ? (
                    <ActivityIndicator size="large" color="#fff" style={{ marginVertical: 40 }} />
                  ) : weather ? (
                    <>
                      <View style={styles.currentRow}>
                        <MaterialCommunityIcons name={currentInfo.icon} size={140} color="#fff" />
                        <Text style={styles.currentTemp} testID="current-temperature">
                          {fmtTemp(weather.current.temperature, unit)}
                        </Text>
                      </View>
                      <Text style={styles.conditionText}>{currentInfo.label}</Text>
                      <Text style={styles.feelsLike}>
                        Ressenti {fmtTemp(weather.current.apparent, unit)} • Humidité {Math.round(weather.current.humidity)}% • Vent {Math.round(weather.current.windSpeed)} km/h
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>

              {/* RIGHT / BOTTOM — forecasts */}
              <View style={[styles.forecastCol, isWide && styles.forecastColWide]}>
                <Text style={styles.sectionTitle}>Prochaines heures</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.hourlyRow}
                  testID="hourly-forecast-scroll"
                >
                  {weather?.hourly.map((h, i) => {
                    const date = new Date(h.time);
                    const label = i === 0 ? "Maintenant" : `${pad2(date.getHours())}h`;
                    const info = infoFor(h.code, 1);
                    return (
                      <View key={h.time} style={styles.hourCard} testID={`hour-item-${i}`}>
                        <Text style={styles.hourLabel}>{label}</Text>
                        <MaterialCommunityIcons name={info.icon} size={44} color="#fff" />
                        <Text style={styles.hourTemp}>{fmtTemp(h.temp, unit)}</Text>
                      </View>
                    );
                  })}
                </ScrollView>

                <Text style={[styles.sectionTitle, { marginTop: 28 }]}>7 prochains jours</Text>
                <View style={styles.dailyList} testID="daily-forecast-list">
                  {weather?.daily.map((d, i) => {
                    const date = new Date(`${d.date}T12:00:00`);
                    const dayName = i === 0 ? "Aujourd'hui" : DAYS_FR_SHORT[date.getDay()];
                    const info = infoFor(d.code, 1);
                    return (
                      <View key={d.date} style={styles.dailyRow} testID={`day-item-${i}`}>
                        <Text style={styles.dailyDay}>{dayName}</Text>
                        <MaterialCommunityIcons name={info.icon} size={44} color="#fff" style={{ width: 50 }} />
                        <Text style={styles.dailyMin}>{fmtTemp(d.tMin, unit)}</Text>
                        <View style={styles.dailyBarTrack}>
                          <View
                            style={[
                              styles.dailyBarFill,
                              {
                                left: `${tempBarPosition(d.tMin, weather?.daily ?? [])}%`,
                                width: `${tempBarWidth(d.tMin, d.tMax, weather?.daily ?? [])}%`,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.dailyMax}>{fmtTemp(d.tMax, unit)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
  safe: { flex: 1 },
  flex: { flex: 1 },

  // HEADER
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 16,
    zIndex: 10,
  },
  searchWrap: { flex: 1, position: "relative" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    minHeight: 64,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 24,
    fontWeight: "500",
    paddingVertical: 0,
  },
  resultsBox: {
    position: "absolute",
    top: 72,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 8,
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    minHeight: 56,
  },
  resultText: { fontSize: 22, color: "#111", flex: 1, fontWeight: "500" },

  iconBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },

  unitToggle: {
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 32,
    padding: 4,
    minHeight: 64,
    alignItems: "center",
  },
  unitChip: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 28,
    minWidth: 64,
    alignItems: "center",
  },
  unitChipActive: { backgroundColor: "#fff" },
  unitText: { fontSize: 26, color: "#fff", fontWeight: "700" },
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

  // MAIN LAYOUT
  mainArea: { flexDirection: "column", gap: 24, marginTop: 12 },
  mainAreaWide: { flexDirection: "row", alignItems: "flex-start" },

  heroCol: { gap: 24 },
  heroColWide: { flex: 6, marginRight: 24 },

  forecastCol: { gap: 12 },
  forecastColWide: { flex: 5 },

  // CLOCK
  clockCard: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  clockTime: {
    color: "#fff",
    fontSize: 140,
    fontWeight: "900",
    letterSpacing: -4,
    lineHeight: 150,
    fontVariant: ["tabular-nums"],
  },
  clockDate: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 28,
    fontWeight: "600",
    marginTop: 4,
    textTransform: "capitalize",
  },

  // CURRENT
  currentCard: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 28,
    paddingVertical: 24,
    paddingHorizontal: 28,
  },
  cityName: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "700",
    marginBottom: 8,
  },
  currentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  currentTemp: {
    color: "#fff",
    fontSize: 150,
    fontWeight: "800",
    letterSpacing: -4,
  },
  conditionText: { color: "#fff", fontSize: 32, fontWeight: "600", marginTop: 4 },
  feelsLike: { color: "rgba(255,255,255,0.85)", fontSize: 20, fontWeight: "500", marginTop: 8 },

  // SECTION
  sectionTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 12,
    marginTop: 8,
  },

  // HOURLY
  hourlyRow: { gap: 12, paddingRight: 24 },
  hourCard: {
    width: 110,
    paddingVertical: 18,
    paddingHorizontal: 8,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    gap: 8,
  },
  hourLabel: { color: "#fff", fontSize: 20, fontWeight: "600" },
  hourTemp: { color: "#fff", fontSize: 28, fontWeight: "700" },

  // DAILY
  dailyList: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  dailyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.18)",
  },
  dailyDay: { color: "#fff", fontSize: 26, fontWeight: "700", width: 100 },
  dailyMin: { color: "rgba(255,255,255,0.85)", fontSize: 24, fontWeight: "600", width: 60, textAlign: "right" },
  dailyMax: { color: "#fff", fontSize: 24, fontWeight: "700", width: 60, textAlign: "right" },
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
