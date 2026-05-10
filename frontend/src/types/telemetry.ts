export interface TelemetryFrame {
  packet_id: number;
  session_time: number;
  frame_identifier: number;
  player_car_index: number;
  timestamp: number;
  motion?: MotionData;
  lap?: LapData;
  telemetry?: CarTelemetry;
  status?: CarStatus;
  damage?: CarDamage;
  session?: SessionData;
}

export interface MotionData {
  speed: number;
  world_pos_x: number;
  world_pos_y: number;
  world_pos_z: number;
  g_force_lat: number;
  g_force_lon: number;
  g_force_vert: number;
  yaw: number;
  pitch: number;
  roll: number;
  wheel_speed: number[];
}

export interface LapData {
  last_lap_time_ms: number;
  current_lap_time_ms: number;
  sector1_time_ms: number;
  sector2_time_ms: number;
  lap_distance: number;
  total_distance: number;
  car_position: number;
  current_lap_num: number;
  pit_status: number;
  sector: number;
  current_lap_invalid: boolean;
  penalties: number;
  driver_status: number;
  result_status: number;
}

export interface CarTelemetry {
  speed: number;
  throttle: number;
  steer: number;
  brake: number;
  clutch: number;
  gear: number;
  engine_rpm: number;
  drs: number;
  rev_lights_percent: number;
  brakes_temp: number[];
  tyres_surface_temp: number[];
  tyres_inner_temp: number[];
  engine_temp: number;
  tyres_pressure: number[];
}

export interface CarStatus {
  fuel_in_tank: number;
  fuel_capacity: number;
  fuel_remaining_laps: number;
  drs_allowed: number;
  tyres_wear: number[];
  tyre_compound: number;
  tyres_age_laps: number;
  front_left_wing_damage: number;
  front_right_wing_damage: number;
  rear_wing_damage: number;
  engine_damage: number;
  gearbox_damage: number;
  ers_store_energy: number;
  ers_deploy_mode: number;
  ers_harvested_this_lap_mguk: number;
  ers_harvested_this_lap_mguh: number;
  ers_deployed_this_lap: number;
}

export interface CarDamage {
  tyres_wear: number[];
  tyres_damage: number[];
  front_left_wing_damage: number;
  front_right_wing_damage: number;
  rear_wing_damage: number;
  floor_damage: number;
  diffuser_damage: number;
  sidepod_damage: number;
  gear_box_damage: number;
  engine_damage: number;
}

export interface SessionData {
  weather: number;
  track_temperature: number;
  air_temperature: number;
  total_laps: number;
  track_length: number;
  session_type: number;
  track_id: number;
  session_time_left: number;
  session_duration: number;
  safety_car_status: number;
}

export interface SessionSummary {
  session_id: string;
  track: string;
  session_type: string;
  current_lap: number;
  best_lap_time: number | null;
  total_laps: number;
  weather: number;
  track_temp: number;
  air_temp: number;
  lap_count: number;
  is_active: boolean;
}

export interface LapSummary {
  lap_number: number;
  lap_time_ms: number;
  sector1_ms: number;
  sector2_ms: number;
  valid: boolean;
  frame_count: number;
}

export type TelemetryChannel = 'live' | 'replay' | 'session';
