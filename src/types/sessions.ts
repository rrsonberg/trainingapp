/**
 * Session types — mirrors session_types in schema.sql.
 *
 * A session is polymorphic. Strength training is ONE subtype of fourteen.
 * Never write code that assumes a session contains exercises.
 */

export type SessionFamily = 'training' | 'recovery' | 'passive';

export type SessionTypeKey =
  | 'strength' | 'cardio' | 'mobility'
  | 'cold_exposure' | 'heat' | 'contrast' | 'hyperbaric'
  | 'compression' | 'float' | 'pemf' | 'red_light' | 'massage'
  | 'sleep' | 'rest_day';

export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';

export type ParameterField = {
  key: string;
  label: string;
  /** SI unit stored in the database. Display conversion happens at render. */
  unit?: 'celsius' | 'ata' | 'mmhg' | 'seconds' | 'percent' | null;
  input: 'number' | 'select' | 'multiselect' | 'text';
  options?: string[];
  required?: boolean;
  min?: number;
  max?: number;
};

export type SessionTypeDef = {
  key: SessionTypeKey;
  family: SessionFamily;
  label: string;
  /** Show contraindication screening before first use. */
  requiresScreening: boolean;
  parameters: ParameterField[];
};

export const SESSION_TYPES: Record<SessionTypeKey, SessionTypeDef> = {
  strength: {
    key: 'strength', family: 'training', label: 'Strength Training',
    requiresScreening: false,
    parameters: [], // detail lives in session_exercises / exercise_sets
  },
  cardio: {
    key: 'cardio', family: 'training', label: 'Cardio',
    requiresScreening: false,
    parameters: [
      { key: 'modality', label: 'Type', input: 'select', required: true,
        options: ['run', 'bike', 'row', 'swim', 'ruck', 'other'] },
      { key: 'distance_m', label: 'Distance', unit: null, input: 'number' },
      { key: 'avg_hr', label: 'Average heart rate', input: 'number' },
    ],
  },
  mobility: {
    key: 'mobility', family: 'training', label: 'Mobility',
    requiresScreening: false,
    parameters: [
      { key: 'focus', label: 'Focus area', input: 'text' },
    ],
  },

  cold_exposure: {
    key: 'cold_exposure', family: 'recovery', label: 'Cold Exposure',
    requiresScreening: true,
    parameters: [
      { key: 'temperature_c', label: 'Temperature', unit: 'celsius',
        input: 'number', required: true, min: -5, max: 25 },
      { key: 'method', label: 'Method', input: 'select', required: true,
        options: ['plunge', 'immersion', 'shower', 'cryo'] },
    ],
  },
  heat: {
    key: 'heat', family: 'recovery', label: 'Sauna / Heat',
    requiresScreening: true,
    parameters: [
      { key: 'heat_type', label: 'Type', input: 'select', required: true,
        options: ['traditional', 'infrared', 'steam'] },
      { key: 'temperature_c', label: 'Temperature', unit: 'celsius',
        input: 'number', required: true, min: 20, max: 120 },
    ],
  },
  contrast: {
    key: 'contrast', family: 'recovery', label: 'Contrast Therapy',
    requiresScreening: true,
    parameters: [
      { key: 'cycles', label: 'Cycles', input: 'number', required: true, min: 1, max: 12 },
      { key: 'hot_seconds', label: 'Hot phase', unit: 'seconds', input: 'number' },
      { key: 'cold_seconds', label: 'Cold phase', unit: 'seconds', input: 'number' },
    ],
  },
  hyperbaric: {
    key: 'hyperbaric', family: 'recovery', label: 'Hyperbaric',
    requiresScreening: true,
    parameters: [
      { key: 'pressure_ata', label: 'Pressure', unit: 'ata',
        input: 'number', required: true, min: 1.0, max: 3.0 },
      { key: 'chamber', label: 'Chamber', input: 'select', required: true,
        options: ['soft shell', 'hard shell', 'upright cabin'] },
      { key: 'oxygen', label: 'Oxygen delivery', input: 'select',
        options: ['ambient air', 'concentrator', 'mask'] },
    ],
  },
  compression: {
    key: 'compression', family: 'recovery', label: 'Compression',
    requiresScreening: true,
    parameters: [
      { key: 'pressure_mmhg', label: 'Pressure', unit: 'mmhg',
        input: 'number', required: true, min: 20, max: 260 },
      { key: 'mode', label: 'Mode', input: 'select',
        options: ['sequential', 'peristaltic', 'static'] },
      { key: 'limbs', label: 'Areas', input: 'multiselect',
        options: ['legs', 'arms', 'hips'] },
    ],
  },
  float: {
    key: 'float', family: 'recovery', label: 'Float',
    requiresScreening: true,
    parameters: [],
  },
  pemf: {
    key: 'pemf', family: 'recovery', label: 'PEMF',
    requiresScreening: true,
    parameters: [
      { key: 'program', label: 'Program', input: 'text' },
      { key: 'intensity', label: 'Intensity', input: 'number' },
    ],
  },
  red_light: {
    key: 'red_light', family: 'recovery', label: 'Red Light',
    requiresScreening: true,
    parameters: [
      { key: 'distance_cm', label: 'Distance', input: 'number' },
      { key: 'wavelength_nm', label: 'Wavelength', input: 'select',
        options: ['660', '850', 'combined'] },
    ],
  },
  massage: {
    key: 'massage', family: 'recovery', label: 'Massage',
    requiresScreening: false, parameters: [],
  },
  sleep: {
    key: 'sleep', family: 'passive', label: 'Sleep',
    requiresScreening: false, parameters: [],
  },
  rest_day: {
    key: 'rest_day', family: 'passive', label: 'Rest Day',
    requiresScreening: false, parameters: [],
  },
};

export type Session = {
  id: string;
  clientGeneratedId: string;
  tenantId: string;
  clientId: string;
  sessionType: SessionTypeKey;
  status: SessionStatus;
  scheduledFor: string | null;      // YYYY-MM-DD
  startedAt: string | null;         // ISO
  completedAt: string | null;       // ISO
  durationSeconds: number | null;
  parameters: Record<string, unknown>;
  source: 'manual' | 'qr' | 'wearable' | 'import';
  locationId: string | null;
  perceivedExertion: number | null;
  clientNotes: string | null;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
};

/** Hard ceiling from the schema — nothing runs for 18 hours. */
export const MAX_SESSION_SECONDS = 14400;
