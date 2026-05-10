"""
F1 23/24 UDP Packet Decoder
Based on Codemasters F1 telemetry protocol
"""
import struct
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any
from enum import IntEnum

logger = logging.getLogger(__name__)


class PacketType(IntEnum):
    MOTION = 0
    SESSION = 1
    LAP_DATA = 2
    EVENT = 3
    PARTICIPANTS = 4
    CAR_SETUPS = 5
    CAR_TELEMETRY = 6
    CAR_STATUS = 7
    FINAL_CLASSIFICATION = 8
    LOBBY_INFO = 9
    CAR_DAMAGE = 10
    SESSION_HISTORY = 11
    TYRE_SETS = 12
    MOTION_EX = 13


@dataclass
class MotionData:
    speed: float = 0.0
    throttle: float = 0.0
    brake: float = 0.0
    steer: float = 0.0
    gear: int = 0
    rpm: int = 0
    drs: int = 0
    g_force_lat: float = 0.0
    g_force_lon: float = 0.0
    g_force_vert: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0
    world_pos_x: float = 0.0
    world_pos_y: float = 0.0
    world_pos_z: float = 0.0
    suspension_pos: List[float] = field(default_factory=lambda: [0.0]*4)
    suspension_vel: List[float] = field(default_factory=lambda: [0.0]*4)
    wheel_speed: List[float] = field(default_factory=lambda: [0.0]*4)


@dataclass
class LapData:
    last_lap_time_ms: int = 0
    current_lap_time_ms: int = 0
    sector1_time_ms: int = 0
    sector2_time_ms: int = 0
    lap_distance: float = 0.0
    total_distance: float = 0.0
    safety_car_delta: float = 0.0
    car_position: int = 0
    current_lap_num: int = 0
    pit_status: int = 0
    sector: int = 0
    current_lap_invalid: bool = False
    penalties: int = 0
    grid_position: int = 0
    driver_status: int = 0
    result_status: int = 0


@dataclass
class CarTelemetry:
    speed: int = 0
    throttle: float = 0.0
    steer: float = 0.0
    brake: float = 0.0
    clutch: int = 0
    gear: int = 0
    engine_rpm: int = 0
    drs: int = 0
    rev_lights_percent: int = 0
    rev_lights_bit_value: int = 0
    brakes_temp: List[int] = field(default_factory=lambda: [0]*4)
    tyres_surface_temp: List[int] = field(default_factory=lambda: [0]*4)
    tyres_inner_temp: List[int] = field(default_factory=lambda: [0]*4)
    engine_temp: int = 0
    tyres_pressure: List[float] = field(default_factory=lambda: [0.0]*4)
    surface_type: List[int] = field(default_factory=lambda: [0]*4)


@dataclass
class CarStatus:
    traction_control: int = 0
    anti_lock_brakes: int = 0
    fuel_mix: int = 0
    front_brake_bias: int = 0
    pit_limiter_status: int = 0
    fuel_in_tank: float = 0.0
    fuel_capacity: float = 0.0
    fuel_remaining_laps: float = 0.0
    max_rpm: int = 0
    idle_rpm: int = 0
    max_gears: int = 0
    drs_allowed: int = 0
    drs_activation_distance: int = 0
    tyres_wear: List[int] = field(default_factory=lambda: [0]*4)
    actual_tyre_compound: int = 0
    visual_tyre_compound: int = 0
    tyres_age_laps: int = 0
    tyres_damage: List[int] = field(default_factory=lambda: [0]*4)
    front_left_wing_damage: int = 0
    front_right_wing_damage: int = 0
    rear_wing_damage: int = 0
    drs_fault: int = 0
    engine_damage: int = 0
    gearbox_damage: int = 0
    vehicle_fia_flags: int = 0
    ers_store_energy: float = 0.0
    ers_deploy_mode: int = 0
    ers_harvested_this_lap_mguk: float = 0.0
    ers_harvested_this_lap_mguh: float = 0.0
    ers_deployed_this_lap: float = 0.0


@dataclass
class CarDamage:
    tyres_wear: List[float] = field(default_factory=lambda: [0.0]*4)
    tyres_damage: List[int] = field(default_factory=lambda: [0]*4)
    front_left_wing_damage: int = 0
    front_right_wing_damage: int = 0
    rear_wing_damage: int = 0
    floor_damage: int = 0
    diffuser_damage: int = 0
    sidepod_damage: int = 0
    drs_fault: int = 0
    gear_box_damage: int = 0
    engine_damage: int = 0
    engine_mguh_wear: int = 0
    engine_es_wear: int = 0
    engine_ce_wear: int = 0
    engine_ice_wear: int = 0
    engine_mguk_wear: int = 0
    engine_tc_wear: int = 0


@dataclass
class SessionData:
    weather: int = 0
    track_temperature: int = 0
    air_temperature: int = 0
    total_laps: int = 0
    track_length: int = 0
    session_type: int = 0
    track_id: int = 0
    formula: int = 0
    session_time_left: int = 0
    session_duration: int = 0
    pit_speed_limit: int = 0
    game_paused: int = 0
    is_spectating: int = 0
    spectator_car_index: int = 0
    sli_pro_native_support: int = 0
    num_marshal_zones: int = 0
    safety_car_status: int = 0
    network_game: int = 0
    num_weather_forecast_samples: int = 0


@dataclass
class TelemetryFrame:
    packet_id: int = 0
    session_time: float = 0.0
    frame_identifier: int = 0
    player_car_index: int = 0
    secondary_player_car_index: int = 0
    motion: Optional[MotionData] = None
    lap: Optional[LapData] = None
    telemetry: Optional[CarTelemetry] = None
    status: Optional[CarStatus] = None
    damage: Optional[CarDamage] = None
    session: Optional[SessionData] = None
    timestamp: float = 0.0


class F1Decoder:
    HEADER_FORMAT = '<H4BQfI2B'
    HEADER_SIZE = struct.calcsize(HEADER_FORMAT)
    PACKET_TYPES = {
        0: PacketType.MOTION,
        1: PacketType.SESSION,
        2: PacketType.LAP_DATA,
        3: PacketType.EVENT,
        4: PacketType.PARTICIPANTS,
        5: PacketType.CAR_SETUPS,
        6: PacketType.CAR_TELEMETRY,
        7: PacketType.CAR_STATUS,
        10: PacketType.CAR_DAMAGE,
    }

    def decode_packet(self, data: bytes) -> Optional[TelemetryFrame]:
        try:
            if len(data) < self.HEADER_SIZE:
                return None

            header = struct.unpack_from(self.HEADER_FORMAT, data)
            packet_format = header[0]
            game_year = header[5]
            packet_type = header[6]
            session_time = header[7]
            frame_id = header[8]
            player_car = header[9]
            secondary_car = header[10]

            frame = TelemetryFrame(
                packet_id=packet_type,
                session_time=session_time,
                frame_identifier=frame_id,
                player_car_index=player_car,
                secondary_player_car_index=secondary_car,
            )

            if packet_type == PacketType.MOTION:
                frame.motion = self._decode_motion(data, player_car)
            elif packet_type == PacketType.LAP_DATA:
                frame.lap = self._decode_lap_data(data, player_car)
            elif packet_type == PacketType.CAR_TELEMETRY:
                frame.telemetry = self._decode_car_telemetry(data, player_car)
            elif packet_type == PacketType.CAR_STATUS:
                frame.status = self._decode_car_status(data, player_car)
            elif packet_type == PacketType.CAR_DAMAGE:
                frame.damage = self._decode_car_damage(data, player_car)
            elif packet_type == PacketType.SESSION:
                frame.session = self._decode_session(data)

            return frame
        except Exception as e:
            logger.error(f"Decode error: {e}")
            return None

    def _decode_motion(self, data: bytes, player_idx: int) -> MotionData:
        offset = self.HEADER_SIZE + (player_idx * 60)
        m = MotionData()
        try:
            m.world_pos_x, m.world_pos_y, m.world_pos_z = struct.unpack_from('<3f', data, offset)
            offset += 12
            m.g_force_lat, m.g_force_lon, m.g_force_vert = struct.unpack_from('<3f', data, offset + 36)
            m.yaw, m.pitch, m.roll = struct.unpack_from('<3f', data, offset + 48)
        except Exception:
            pass
        return m

    def _decode_lap_data(self, data: bytes, player_idx: int) -> LapData:
        offset = self.HEADER_SIZE + (player_idx * 53)
        try:
            return LapData(
                last_lap_time_ms=int(struct.unpack_from('<I', data, offset)[0]),
                current_lap_time_ms=int(struct.unpack_from('<I', data, offset+4)[0]),
                sector1_time_ms=int(struct.unpack_from('<H', data, offset+12)[0]),
                sector2_time_ms=int(struct.unpack_from('<H', data, offset+14)[0]),
                lap_distance=struct.unpack_from('<f', data, offset+16)[0],
                total_distance=struct.unpack_from('<f', data, offset+20)[0],
                safety_car_delta=struct.unpack_from('<f', data, offset+24)[0],
                car_position=struct.unpack_from('<B', data, offset+28)[0],
                current_lap_num=struct.unpack_from('<B', data, offset+29)[0],
                pit_status=struct.unpack_from('<B', data, offset+30)[0],
                sector=struct.unpack_from('<B', data, offset+31)[0],
                current_lap_invalid=struct.unpack_from('<B', data, offset+32)[0] > 0,
                penalties=struct.unpack_from('<B', data, offset+33)[0],
                grid_position=struct.unpack_from('<B', data, offset+38)[0],
                driver_status=struct.unpack_from('<B', data, offset+39)[0],
                result_status=struct.unpack_from('<B', data, offset+40)[0],
            )
        except Exception:
            return LapData()

    def _decode_car_telemetry(self, data: bytes, player_idx: int) -> CarTelemetry:
        offset = self.HEADER_SIZE + (player_idx * 58)
        try:
            return CarTelemetry(
                speed=struct.unpack_from('<H', data, offset)[0],
                throttle=struct.unpack_from('<f', data, offset+2)[0],
                steer=struct.unpack_from('<f', data, offset+6)[0],
                brake=struct.unpack_from('<f', data, offset+10)[0],
                clutch=struct.unpack_from('<B', data, offset+14)[0],
                gear=struct.unpack_from('<b', data, offset+15)[0],
                engine_rpm=struct.unpack_from('<H', data, offset+16)[0],
                drs=struct.unpack_from('<B', data, offset+18)[0],
                rev_lights_percent=struct.unpack_from('<B', data, offset+19)[0],
                rev_lights_bit_value=struct.unpack_from('<H', data, offset+20)[0],
                brakes_temp=list(struct.unpack_from('<4H', data, offset+22)),
                tyres_surface_temp=list(struct.unpack_from('<4B', data, offset+30)),
                tyres_inner_temp=list(struct.unpack_from('<4B', data, offset+34)),
                engine_temp=struct.unpack_from('<H', data, offset+38)[0],
                tyres_pressure=list(struct.unpack_from('<4f', data, offset+40)),
                surface_type=list(struct.unpack_from('<4B', data, offset+56)),
            )
        except Exception:
            return CarTelemetry()

    def _decode_car_status(self, data: bytes, player_idx: int) -> CarStatus:
        offset = self.HEADER_SIZE + (player_idx * 61)
        try:
            return CarStatus(
                traction_control=struct.unpack_from('<B', data, offset)[0],
                anti_lock_brakes=struct.unpack_from('<B', data, offset+1)[0],
                fuel_mix=struct.unpack_from('<B', data, offset+2)[0],
                front_brake_bias=struct.unpack_from('<B', data, offset+3)[0],
                pit_limiter_status=struct.unpack_from('<B', data, offset+4)[0],
                fuel_in_tank=struct.unpack_from('<f', data, offset+5)[0],
                fuel_capacity=struct.unpack_from('<f', data, offset+9)[0],
                fuel_remaining_laps=struct.unpack_from('<f', data, offset+13)[0],
                max_rpm=struct.unpack_from('<H', data, offset+17)[0],
                idle_rpm=struct.unpack_from('<H', data, offset+19)[0],
                max_gears=struct.unpack_from('<B', data, offset+21)[0],
                drs_allowed=struct.unpack_from('<B', data, offset+22)[0],
                drs_activation_distance=struct.unpack_from('<H', data, offset+23)[0],
                tyres_wear=list(struct.unpack_from('<4B', data, offset+25)),
                actual_tyre_compound=struct.unpack_from('<B', data, offset+29)[0],
                visual_tyre_compound=struct.unpack_from('<B', data, offset+30)[0],
                tyres_age_laps=struct.unpack_from('<B', data, offset+31)[0],
                tyres_damage=list(struct.unpack_from('<4B', data, offset+32)),
                front_left_wing_damage=struct.unpack_from('<B', data, offset+36)[0],
                front_right_wing_damage=struct.unpack_from('<B', data, offset+37)[0],
                rear_wing_damage=struct.unpack_from('<B', data, offset+38)[0],
                drs_fault=struct.unpack_from('<B', data, offset+39)[0],
                engine_damage=struct.unpack_from('<B', data, offset+40)[0],
                gearbox_damage=struct.unpack_from('<B', data, offset+41)[0],
                vehicle_fia_flags=struct.unpack_from('<B', data, offset+42)[0],
                ers_store_energy=struct.unpack_from('<f', data, offset+43)[0],
                ers_deploy_mode=struct.unpack_from('<B', data, offset+47)[0],
                ers_harvested_this_lap_mguk=struct.unpack_from('<f', data, offset+48)[0],
                ers_harvested_this_lap_mguh=struct.unpack_from('<f', data, offset+52)[0],
                ers_deployed_this_lap=struct.unpack_from('<f', data, offset+56)[0],
            )
        except Exception:
            return CarStatus()

    def _decode_car_damage(self, data: bytes, player_idx: int) -> CarDamage:
        offset = self.HEADER_SIZE + (player_idx * 39)
        try:
            return CarDamage(
                tyres_wear=list(struct.unpack_from('<4f', data, offset)),
                tyres_damage=list(struct.unpack_from('<4B', data, offset+16)),
                front_left_wing_damage=struct.unpack_from('<B', data, offset+20)[0],
                front_right_wing_damage=struct.unpack_from('<B', data, offset+21)[0],
                rear_wing_damage=struct.unpack_from('<B', data, offset+22)[0],
                floor_damage=struct.unpack_from('<B', data, offset+23)[0],
                diffuser_damage=struct.unpack_from('<B', data, offset+24)[0],
                sidepod_damage=struct.unpack_from('<B', data, offset+25)[0],
                drs_fault=struct.unpack_from('<B', data, offset+26)[0],
                gear_box_damage=struct.unpack_from('<B', data, offset+27)[0],
                engine_damage=struct.unpack_from('<B', data, offset+28)[0],
                engine_mguh_wear=struct.unpack_from('<B', data, offset+29)[0],
                engine_es_wear=struct.unpack_from('<B', data, offset+30)[0],
                engine_ce_wear=struct.unpack_from('<B', data, offset+31)[0],
                engine_ice_wear=struct.unpack_from('<B', data, offset+32)[0],
                engine_mguk_wear=struct.unpack_from('<B', data, offset+33)[0],
                engine_tc_wear=struct.unpack_from('<B', data, offset+34)[0],
            )
        except Exception:
            return CarDamage()

    def _decode_session(self, data: bytes) -> SessionData:
        offset = self.HEADER_SIZE
        try:
            return SessionData(
                weather=struct.unpack_from('<B', data, offset)[0],
                track_temperature=struct.unpack_from('<b', data, offset+1)[0],
                air_temperature=struct.unpack_from('<b', data, offset+2)[0],
                total_laps=struct.unpack_from('<B', data, offset+3)[0],
                track_length=struct.unpack_from('<H', data, offset+4)[0],
                session_type=struct.unpack_from('<B', data, offset+6)[0],
                track_id=struct.unpack_from('<b', data, offset+7)[0],
                formula=struct.unpack_from('<B', data, offset+8)[0],
                session_time_left=struct.unpack_from('<H', data, offset+9)[0],
                session_duration=struct.unpack_from('<H', data, offset+11)[0],
                pit_speed_limit=struct.unpack_from('<B', data, offset+13)[0],
                game_paused=struct.unpack_from('<B', data, offset+14)[0],
                is_spectating=struct.unpack_from('<B', data, offset+15)[0],
                spectator_car_index=struct.unpack_from('<B', data, offset+16)[0],
                sli_pro_native_support=struct.unpack_from('<B', data, offset+17)[0],
                num_marshal_zones=struct.unpack_from('<B', data, offset+18)[0],
                safety_car_status=struct.unpack_from('<B', data, offset+49)[0],
                network_game=struct.unpack_from('<B', data, offset+50)[0],
            )
        except Exception:
            return SessionData()

    def frame_to_dict(self, frame: TelemetryFrame) -> Dict[str, Any]:
        result = {
            "packet_id": frame.packet_id,
            "session_time": frame.session_time,
            "frame_identifier": frame.frame_identifier,
            "player_car_index": frame.player_car_index,
            "timestamp": frame.timestamp,
        }

        if frame.motion:
            result["motion"] = {
                "speed": getattr(frame, 'telemetry', None) and getattr(frame.telemetry, 'speed', 0) or 0,
                "world_pos_x": frame.motion.world_pos_x,
                "world_pos_y": frame.motion.world_pos_y,
                "world_pos_z": frame.motion.world_pos_z,
                "g_force_lat": frame.motion.g_force_lat,
                "g_force_lon": frame.motion.g_force_lon,
                "g_force_vert": frame.motion.g_force_vert,
                "yaw": frame.motion.yaw,
                "pitch": frame.motion.pitch,
                "roll": frame.motion.roll,
                "wheel_speed": frame.motion.wheel_speed,
            }

        if frame.lap:
            result["lap"] = {
                "last_lap_time_ms": frame.lap.last_lap_time_ms,
                "current_lap_time_ms": frame.lap.current_lap_time_ms,
                "sector1_time_ms": frame.lap.sector1_time_ms,
                "sector2_time_ms": frame.lap.sector2_time_ms,
                "lap_distance": frame.lap.lap_distance,
                "total_distance": frame.lap.total_distance,
                "car_position": frame.lap.car_position,
                "current_lap_num": frame.lap.current_lap_num,
                "pit_status": frame.lap.pit_status,
                "sector": frame.lap.sector,
                "current_lap_invalid": frame.lap.current_lap_invalid,
                "penalties": frame.lap.penalties,
                "driver_status": frame.lap.driver_status,
                "result_status": frame.lap.result_status,
            }

        if frame.telemetry:
            result["telemetry"] = {
                "speed": frame.telemetry.speed,
                "throttle": round(frame.telemetry.throttle, 3),
                "steer": round(frame.telemetry.steer, 3),
                "brake": round(frame.telemetry.brake, 3),
                "clutch": frame.telemetry.clutch,
                "gear": frame.telemetry.gear,
                "engine_rpm": frame.telemetry.engine_rpm,
                "drs": frame.telemetry.drs,
                "rev_lights_percent": frame.telemetry.rev_lights_percent,
                "brakes_temp": frame.telemetry.brakes_temp,
                "tyres_surface_temp": frame.telemetry.tyres_surface_temp,
                "tyres_inner_temp": frame.telemetry.tyres_inner_temp,
                "engine_temp": frame.telemetry.engine_temp,
                "tyres_pressure": [round(p, 2) for p in frame.telemetry.tyres_pressure],
            }

        if frame.status:
            result["status"] = {
                "fuel_in_tank": round(frame.status.fuel_in_tank, 2),
                "fuel_capacity": round(frame.status.fuel_capacity, 2),
                "fuel_remaining_laps": round(frame.status.fuel_remaining_laps, 2),
                "drs_allowed": frame.status.drs_allowed,
                "tyres_wear": frame.status.tyres_wear,
                "tyre_compound": frame.status.visual_tyre_compound,
                "tyres_age_laps": frame.status.tyres_age_laps,
                "front_left_wing_damage": frame.status.front_left_wing_damage,
                "front_right_wing_damage": frame.status.front_right_wing_damage,
                "rear_wing_damage": frame.status.rear_wing_damage,
                "engine_damage": frame.status.engine_damage,
                "gearbox_damage": frame.status.gearbox_damage,
                "ers_store_energy": round(frame.status.ers_store_energy, 2),
                "ers_deploy_mode": frame.status.ers_deploy_mode,
                "ers_harvested_this_lap_mguk": round(frame.status.ers_harvested_this_lap_mguk, 2),
                "ers_harvested_this_lap_mguh": round(frame.status.ers_harvested_this_lap_mguh, 2),
                "ers_deployed_this_lap": round(frame.status.ers_deployed_this_lap, 2),
            }

        if frame.damage:
            result["damage"] = {
                "tyres_wear": [round(w, 2) for w in frame.damage.tyres_wear],
                "tyres_damage": frame.damage.tyres_damage,
                "front_left_wing_damage": frame.damage.front_left_wing_damage,
                "front_right_wing_damage": frame.damage.front_right_wing_damage,
                "rear_wing_damage": frame.damage.rear_wing_damage,
                "floor_damage": frame.damage.floor_damage,
                "diffuser_damage": frame.damage.diffuser_damage,
                "sidepod_damage": frame.damage.sidepod_damage,
                "gear_box_damage": frame.damage.gear_box_damage,
                "engine_damage": frame.damage.engine_damage,
            }

        if frame.session:
            result["session"] = {
                "weather": frame.session.weather,
                "track_temperature": frame.session.track_temperature,
                "air_temperature": frame.session.air_temperature,
                "total_laps": frame.session.total_laps,
                "track_length": frame.session.track_length,
                "session_type": frame.session.session_type,
                "track_id": frame.session.track_id,
                "session_time_left": frame.session.session_time_left,
                "session_duration": frame.session.session_duration,
                "safety_car_status": frame.session.safety_car_status,
            }

        return result
