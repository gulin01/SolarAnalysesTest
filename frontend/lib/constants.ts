export const DEFAULT_GRID_RESOLUTION = 0.5   // meters
export const MIN_GRID_RESOLUTION = 0.25
export const MAX_GRID_RESOLUTION = 2.0

export const DEFAULT_GROUND_REFLECTANCE = 0.2
export const DEFAULT_MIN_IRRADIANCE = 800    // kWh/m²

export const OPTIMAL_TILT_MIN = 15           // degrees
export const OPTIMAL_TILT_MAX = 35

export const PANEL_WIDTH_M = 1.0
export const PANEL_HEIGHT_M = 1.65
export const PANEL_AREA_M2 = PANEL_WIDTH_M * PANEL_HEIGHT_M

export const MAPBOX_INITIAL_ZOOM = 15
export const MAPBOX_INITIAL_CENTER: [number, number] = [0, 51.5]  // lon, lat — London

export const MAX_MODEL_FACES = 500_000
export const MAX_UPLOAD_MB = 200

export const WS_RECONNECT_MS = 3000
