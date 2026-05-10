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


class DriverStatus(IntEnum):
    IN_GARAGE = 0
    FLYING_LAP = 1
    IN_LAP = 2
    OUT_LAP = 3
    ON_TRACK = 4


class PitStatus(IntEnum):
    NONE = 0
    PITTING = 1
    IN_PIT_AREA = 2


class ResultStatus(IntEnum):
    INVALID = 0
    INACTIVE = 1
    ACTIVE = 2
    FINISHED = 3
    DID_NOT_FINISH = 4
    DISQUALIFIED = 5
    NOT_CLASSIFIED = 6
    RETIRED = 7


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
    sector1_time_minutes: int = 0
    sector2_time_ms: int = 0
    sector2_time_minutes: int = 0
    delta_to_car_in_front_ms: int = 0
    delta_to_race_leader_ms: int = 0
    lap_distance: float = 0.0
    total_distance: float = 0.0
    safety_car_delta: float = 0.0
    car_position: int = 0
    current_lap_num: int = 0
    pit_status: int = 0
    num_pit_stops: int = 0
    sector: int = 0
    current_lap_invalid: bool = False
    penalties: int = 0
    total_warnings: int = 0
    corner_cutting_warnings: int = 0
    num_unserved_drive_through_pens: int = 0
    num_unserved_stop_go_pens: int = 0
    grid_position: int = 0
    driver_status: int = 0
    result_status: int = 0
    pit_lane_timer_active: int = 0
    pit_lane_time_in_lane_in_ms: int = 0
    pit_stop_timer_in_ms: int = 0
    pit_stop_should_serve_pen: int = 0

    @property
    def is_in_pits(self) -> bool:
        return self.pit_status in (PitStatus.PITTING, PitStatus.IN_PIT_AREA)

    @property
    def is_on_flying_lap(self) -> bool:
        return self.driver_status == DriverStatus.FLYING_LAP

    @property
    def is_out_lap(self) -> bool:
        return self.driver_status == DriverStatus.OUT_LAP

    @property
    def is_in_lap(self) -> bool:
        return self.driver_status == DriverStatus.IN_LAP

    @property
    def is_in_garage(self) -> bool:
        return self.driver_status == DriverStatus.IN_GARAGE

    @property
    def is_on_track(self) -> bool:
        return self.driver_status == DriverStatus.ON_TRACK

    @property
    def is_active(self) -> bool:
        return self.result_status in (ResultStatus.ACTIVE, ResultStatus.FINISHED)

    @property
    def lap_phase(self) -> str:
        """Return a human-readable lap phase."""
        if self.is_in_garage:
            return "garage"
        if self.is_in_pits:
            return "pitting"
        if self.pit_lane_timer_active:
            return "pit_lane"
        if self.is_out_lap:
            return "out_lap"
        if self.is_in_lap:
            return "in_lap"
        if self.is_on_flying_lap:
            return "flying_lap"
        if self.is_on_track:
            return "on_track"
        if self.result_status == ResultStatus.INVALID:
            return "invalid"
        if self.result_status == ResultStatus.INACTIVE:
            return "inactive"
        return "unknown"


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
    overall_frame_identifier: int = 0
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
    # F1 23/24 header: m_packetFormat(2), m_gameYear(1), m_gameMajorVersion(1), m_gameMinorVersion(1),
    # m_packetVersion(1), m_packetId(1), m_sessionUID(8), m_sessionTime(4), m_frameIdentifier(4),
    # m_overallFrameIdentifier(4), m_playerCarIndex(1), m_secondaryPlayerCarIndex(1)
    HEADER_FORMAT = '<H5BQf2I2B'
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
            game_year = header[1]
            game_major = header[2]
            game_minor = header[3]
            packet_version = header[4]
            packet_type = header[5]
            session_uid = header[6]
            session_time = header[7]
            frame_id = header[8]
            overall_frame_id = header[9]
            player_car = header[10]
            secondary_car = header[11]

            frame = TelemetryFrame(
                packet_id=packet_type,
                session_time=session_time,
                frame_identifier=frame_id,
                overall_frame_identifier=overall_frame_id,
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
        # LapData per car: 50 bytes (F1 23 spec)
        # Group adjacent same-type fields to minimize struct calls (10 vs 28)
        offset = self.HEADER_SIZE + (player_idx * 50)
        try:
            d0 = struct.unpack_from('<2I', data, offset)        # 0-7
            d1 = struct.unpack_from('<H', data, offset + 8)     # 8-9
            d2 = struct.unpack_from('<B', data, offset + 10)    # 10
            d3 = struct.unpack_from('<H', data, offset + 11)    # 11-12
            d4 = struct.unpack_from('<B', data, offset + 13)    # 13
            d5 = struct.unpack_from('<2H', data, offset + 14)   # 14-17
            d6 = struct.unpack_from('<3f', data, offset + 18)   # 18-29
            d7 = struct.unpack_from('<15B', data, offset + 30)  # 30-44
            d8 = struct.unpack_from('<2H', data, offset + 45)   # 45-48
            d9 = struct.unpack_from('<B', data, offset + 49)    # 49
            return LapData(
                last_lap_time_ms=d0[0],
                current_lap_time_ms=d0[1],
                sector1_time_ms=d1[0],
                sector1_time_minutes=d2[0],
                sector2_time_ms=d3[0],
                sector2_time_minutes=d4[0],
                delta_to_car_in_front_ms=d5[0],
                delta_to_race_leader_ms=d5[1],
                lap_distance=d6[0],
                total_distance=d6[1],
                safety_car_delta=d6[2],
                car_position=d7[0],
                current_lap_num=d7[1],
                pit_status=d7[2],
                num_pit_stops=d7[3],
                sector=d7[4],
                current_lap_invalid=d7[5] > 0,
                penalties=d7[6],
                total_warnings=d7[7],
                corner_cutting_warnings=d7[8],
                num_unserved_drive_through_pens=d7[9],
                num_unserved_stop_go_pens=d7[10],
                grid_position=d7[11],
                driver_status=d7[12],
                result_status=d7[13],
                pit_lane_timer_active=d7[14],
                pit_lane_time_in_lane_in_ms=d8[0],
                pit_stop_timer_in_ms=d8[1],
                pit_stop_should_serve_pen=d9[0],
            )
        except Exception as e:
            logger.warning(f"Lap data decode error: {e}")
            return LapData()

    def _decode_car_telemetry(self, data: bytes, player_idx: int) -> CarTelemetry:
        # CarTelemetry per car: 58 bytes
        # Group adjacent same-type fields to minimize struct calls
        offset = self.HEADER_SIZE + (player_idx * 58)
        try:
            d0 = struct.unpack_from('<H', data, offset)         # 0-1 (speed)
            d1 = struct.unpack_from('<3f', data, offset + 2)    # 2-13 (throttle, steer, brake)
            d2 = struct.unpack_from('<B', data, offset + 14)    # 14 (clutch)
            d3 = struct.unpack_from('<b', data, offset + 15)    # 15 (gear)
            d4 = struct.unpack_from('<H', data, offset + 16)    # 16-17 (engine_rpm)
            d5 = struct.unpack_from('<2B', data, offset + 18)   # 18-19 (drs, rev_lights_percent)
            d6 = struct.unpack_from('<H', data, offset + 20)    # 20-21 (rev_lights_bit_value)
            d7 = struct.unpack_from('<4H', data, offset + 22)   # 22-29 (brakes_temp)
            d8 = struct.unpack_from('<4B', data, offset + 30)   # 30-33 (tyres_surface_temp)
            d9 = struct.unpack_from('<4B', data, offset + 34)   # 34-37 (tyres_inner_temp)
            d10 = struct.unpack_from('<H', data, offset + 38)   # 38-39 (engine_temp)
            d11 = struct.unpack_from('<4f', data, offset + 40)  # 40-55 (tyres_pressure)
            d12 = struct.unpack_from('<4B', data, offset + 56)  # 56-59 (surface_type)
            return CarTelemetry(
                speed=d0[0],
                throttle=d1[0],
                steer=d1[1],
                brake=d1[2],
                clutch=d2[0],
                gear=d3[0],
                engine_rpm=d4[0],
                drs=d5[0],
                rev_lights_percent=d5[1],
                rev_lights_bit_value=d6[0],
                brakes_temp=list(d7),
                tyres_surface_temp=list(d8),
                tyres_inner_temp=list(d9),
                engine_temp=d10[0],
                tyres_pressure=list(d11),
                surface_type=list(d12),
            )
        except Exception:
            return CarTelemetry()

    def _decode_car_status(self, data: bytes, player_idx: int) -> CarStatus:
        # CarStatus per car: 60 bytes of actual fields (game struct is 61)
        # Group adjacent same-type fields to minimize struct calls
        offset = self.HEADER_SIZE + (player_idx * 61)
        try:
            d0 = struct.unpack_from('<5B', data, offset)        # 0-4
            d1 = struct.unpack_from('<3f', data, offset + 5)    # 5-16
            d2 = struct.unpack_from('<2H', data, offset + 17)   # 17-20
            d3 = struct.unpack_from('<B', data, offset + 21)    # 21
            d4 = struct.unpack_from('<B', data, offset + 22)    # 22
            d5 = struct.unpack_from('<H', data, offset + 23)    # 23-24
            d6 = struct.unpack_from('<4B', data, offset + 25)   # 25-28
            d7 = struct.unpack_from('<3B', data, offset + 29)   # 29-31
            d8 = struct.unpack_from('<4B', data, offset + 32)   # 32-35
            d9 = struct.unpack_from('<7B', data, offset + 36)   # 36-42
            d10 = struct.unpack_from('<f', data, offset + 43)   # 43-46
            d11 = struct.unpack_from('<B', data, offset + 47)   # 47
            d12 = struct.unpack_from('<3f', data, offset + 48)  # 48-59
            return CarStatus(
                traction_control=d0[0],
                anti_lock_brakes=d0[1],
                fuel_mix=d0[2],
                front_brake_bias=d0[3],
                pit_limiter_status=d0[4],
                fuel_in_tank=d1[0],
                fuel_capacity=d1[1],
                fuel_remaining_laps=d1[2],
                max_rpm=d2[0],
                idle_rpm=d2[1],
                max_gears=d3[0],
                drs_allowed=d4[0],
                drs_activation_distance=d5[0],
                tyres_wear=list(d6),
                actual_tyre_compound=d7[0],
                visual_tyre_compound=d7[1],
                tyres_age_laps=d7[2],
                tyres_damage=list(d8),
                front_left_wing_damage=d9[0],
                front_right_wing_damage=d9[1],
                rear_wing_damage=d9[2],
                drs_fault=d9[3],
                engine_damage=d9[4],
                gearbox_damage=d9[5],
                vehicle_fia_flags=d9[6],
                ers_store_energy=d10[0],
                ers_deploy_mode=d11[0],
                ers_harvested_this_lap_mguk=d12[0],
                ers_harvested_this_lap_mguh=d12[1],
                ers_deployed_this_lap=d12[2],
            )
        except Exception:
            return CarStatus()

    def _decode_car_damage(self, data: bytes, player_idx: int) -> CarDamage:
        # CarDamage per car: 35 bytes of actual fields (game struct is 39)
        # Group adjacent same-type fields to minimize struct calls
        offset = self.HEADER_SIZE + (player_idx * 39)
        try:
            d0 = struct.unpack_from('<4f', data, offset)        # 0-15
            d1 = struct.unpack_from('<4B', data, offset + 16)   # 16-19
            d2 = struct.unpack_from('<15B', data, offset + 20)  # 20-34
            return CarDamage(
                tyres_wear=list(d0),
                tyres_damage=list(d1),
                front_left_wing_damage=d2[0],
                front_right_wing_damage=d2[1],
                rear_wing_damage=d2[2],
                floor_damage=d2[3],
                diffuser_damage=d2[4],
                sidepod_damage=d2[5],
                drs_fault=d2[6],
                gear_box_damage=d2[7],
                engine_damage=d2[8],
                engine_mguh_wear=d2[9],
                engine_es_wear=d2[10],
                engine_ce_wear=d2[11],
                engine_ice_wear=d2[12],
                engine_mguk_wear=d2[13],
                engine_tc_wear=d2[14],
            )
        except Exception:
            return CarDamage()

    def _decode_session(self, data: bytes) -> SessionData:
        # Session data: sparse fields with gaps (marshal zones, etc.)
        # Group adjacent same-type fields where possible
        offset = self.HEADER_SIZE
        try:
            d0 = struct.unpack_from('<B', data, offset)         # 0 (weather)
            d1 = struct.unpack_from('<2b', data, offset + 1)    # 1-2 (track_temp, air_temp)
            d2 = struct.unpack_from('<B', data, offset + 3)     # 3 (total_laps)
            d3 = struct.unpack_from('<H', data, offset + 4)     # 4-5 (track_length)
            d4 = struct.unpack_from('<B', data, offset + 6)     # 6 (session_type)
            d5 = struct.unpack_from('<b', data, offset + 7)     # 7 (track_id)
            d6 = struct.unpack_from('<B', data, offset + 8)     # 8 (formula)
            d7 = struct.unpack_from('<2H', data, offset + 9)    # 9-12 (session_time_left, session_duration)
            d8 = struct.unpack_from('<5B', data, offset + 13)   # 13-17 (pit_speed_limit, game_paused, is_spectating, spectator_car_index, sli_pro_native_support)
            d9 = struct.unpack_from('<B', data, offset + 18)    # 18 (num_marshal_zones)
            d10 = struct.unpack_from('<B', data, offset + 49)   # 49 (safety_car_status)
            d11 = struct.unpack_from('<B', data, offset + 50)   # 50 (network_game)
            return SessionData(
                weather=d0[0],
                track_temperature=d1[0],
                air_temperature=d1[1],
                total_laps=d2[0],
                track_length=d3[0],
                session_type=d4[0],
                track_id=d5[0],
                formula=d6[0],
                session_time_left=d7[0],
                session_duration=d7[1],
                pit_speed_limit=d8[0],
                game_paused=d8[1],
                is_spectating=d8[2],
                spectator_car_index=d8[3],
                sli_pro_native_support=d8[4],
                num_marshal_zones=d9[0],
                safety_car_status=d10[0],
                network_game=d11[0],
            )
        except Exception:
            return SessionData()

    def frame_to_dict(self, frame: TelemetryFrame) -> Dict[str, Any]:
        result = {
            "packet_id": frame.packet_id,
            "session_time": frame.session_time,
            "frame_identifier": frame.frame_identifier,
            "overall_frame_identifier": frame.overall_frame_identifier,
            "player_car_index": frame.player_car_index,
            "timestamp": frame.timestamp,
        }

        if frame.motion:
            telem = frame.telemetry
            result["motion"] = {
                "speed": telem.speed if telem is not None else 0,
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
            lap = frame.lap
            result["lap"] = {
                "last_lap_time_ms": lap.last_lap_time_ms,
                "current_lap_time_ms": lap.current_lap_time_ms,
                "sector1_time_ms": lap.sector1_time_ms,
                "sector2_time_ms": lap.sector2_time_ms,
                "lap_distance": lap.lap_distance,
                "total_distance": lap.total_distance,
                "car_position": lap.car_position,
                "current_lap_num": lap.current_lap_num,
                "pit_status": lap.pit_status,
                "num_pit_stops": lap.num_pit_stops,
                "sector": lap.sector,
                "current_lap_invalid": lap.current_lap_invalid,
                "penalties": lap.penalties,
                "total_warnings": lap.total_warnings,
                "corner_cutting_warnings": lap.corner_cutting_warnings,
                "driver_status": lap.driver_status,
                "result_status": lap.result_status,
                "grid_position": lap.grid_position,
                "pit_lane_timer_active": lap.pit_lane_timer_active,
                "pit_lane_time_in_lane_in_ms": lap.pit_lane_time_in_lane_in_ms,
                "pit_stop_timer_in_ms": lap.pit_stop_timer_in_ms,
                "lap_phase": lap.lap_phase,
                "is_in_pits": lap.is_in_pits,
                "is_on_flying_lap": lap.is_on_flying_lap,
                "is_out_lap": lap.is_out_lap,
                "is_in_lap": lap.is_in_lap,
                "is_in_garage": lap.is_in_garage,
                "is_on_track": lap.is_on_track,
                "is_active": lap.is_active,
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
                "surface_type": frame.telemetry.surface_type,
            }

        if frame.status:
            result["status"] = {
                "fuel_in_tank": round(frame.status.fuel_in_tank, 2),
                "fuel_capacity": round(frame.status.fuel_capacity, 2),
                "fuel_remaining_laps": round(frame.status.fuel_remaining_laps, 2),
                "drs_allowed": frame.status.drs_allowed,
                "pit_limiter_status": frame.status.pit_limiter_status,
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
