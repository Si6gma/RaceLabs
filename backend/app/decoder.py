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
    all_lap_distances: List[float] = field(default_factory=list)
    car_team_ids: List[int] = field(default_factory=list)
    # Per-car arrays (all 22 slots) for spectating cars other than the player
    motion_all: List[MotionData] = field(default_factory=list)
    lap_all: List[LapData] = field(default_factory=list)
    telemetry_all: List[CarTelemetry] = field(default_factory=list)
    status_all: List[CarStatus] = field(default_factory=list)
    damage_all: List[CarDamage] = field(default_factory=list)
    participants: List[Dict[str, Any]] = field(default_factory=list)
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
            # Spectating with no player car reports 255; clamp for safe array indexing.
            pc = player_car if player_car < 22 else 0

            frame = TelemetryFrame(
                packet_id=packet_type,
                session_time=session_time,
                frame_identifier=frame_id,
                overall_frame_identifier=overall_frame_id,
                player_car_index=player_car,
                secondary_player_car_index=secondary_car,
            )

            if packet_type == PacketType.MOTION:
                frame.motion_all = [self._decode_motion(data, i) for i in range(22)]
                frame.motion = frame.motion_all[pc]
            elif packet_type == PacketType.LAP_DATA:
                frame.lap_all = [self._decode_lap_data(data, i) for i in range(22)]
                frame.lap = frame.lap_all[pc]
                frame.all_lap_distances = self._decode_all_lap_distances(data)
            elif packet_type == PacketType.PARTICIPANTS:
                frame.car_team_ids, frame.participants = self._decode_participants_full(data)
            elif packet_type == PacketType.CAR_TELEMETRY:
                frame.telemetry_all = [self._decode_car_telemetry(data, i) for i in range(22)]
                frame.telemetry = frame.telemetry_all[pc]
            elif packet_type == PacketType.CAR_STATUS:
                frame.status_all = [self._decode_car_status(data, i) for i in range(22)]
                frame.status = frame.status_all[pc]
            elif packet_type == PacketType.CAR_DAMAGE:
                frame.damage_all = [self._decode_car_damage(data, i) for i in range(22)]
                frame.damage = frame.damage_all[pc]
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
            m.g_force_lat, m.g_force_lon, m.g_force_vert = struct.unpack_from('<3f', data, offset + 24)
            m.yaw, m.pitch, m.roll = struct.unpack_from('<3f', data, offset + 36)
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
        # CarTelemetry per car: 60 bytes
        # Group adjacent same-type fields to minimize struct calls
        offset = self.HEADER_SIZE + (player_idx * 60)
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
        # CarStatus per car: 55 bytes (F1 24)
        # F1 24 layout vs F1 23: added enginePowerICE/ERS (8 bytes) after vehicleFiaFlags,
        # removed tyre/wing/engine damage fields (moved to CarDamage packet).
        offset = self.HEADER_SIZE + (player_idx * 55)
        try:
            d0 = struct.unpack_from('<5B', data, offset)        # 0-4  tc,abs,fuelMix,brakeBias,pitLimiter
            d1 = struct.unpack_from('<3f', data, offset + 5)    # 5-16 fuelInTank,fuelCapacity,fuelRemainingLaps
            d2 = struct.unpack_from('<2H', data, offset + 17)   # 17-20 maxRPM,idleRPM
            d3 = struct.unpack_from('<B', data, offset + 21)    # 21   maxGears
            d4 = struct.unpack_from('<B', data, offset + 22)    # 22   drsAllowed
            d5 = struct.unpack_from('<H', data, offset + 23)    # 23-24 drsActivationDistance
            d6 = struct.unpack_from('<3B', data, offset + 25)   # 25-27 actualTyreCompound,visualTyreCompound,tyresAgeLaps
            # 28: vehicleFiaFlags (skip)
            # 29-36: enginePowerICE + enginePowerERS floats (skip)
            d7 = struct.unpack_from('<f', data, offset + 37)    # 37-40 ersStoreEnergy
            d8 = struct.unpack_from('<B', data, offset + 41)    # 41   ersDeployMode
            d9 = struct.unpack_from('<3f', data, offset + 42)   # 42-53 ersHarvestedMGUK,MGUH,ersDeployed
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
                actual_tyre_compound=d6[0],
                visual_tyre_compound=d6[1],
                tyres_age_laps=d6[2],
                ers_store_energy=d7[0],
                ers_deploy_mode=d8[0],
                ers_harvested_this_lap_mguk=d9[0],
                ers_harvested_this_lap_mguh=d9[1],
                ers_deployed_this_lap=d9[2],
            )
        except Exception:
            return CarStatus()

    def _decode_car_damage(self, data: bytes, player_idx: int) -> CarDamage:
        # CarDamage per car: 42 bytes (F1 24)
        # F1 24 added ersFault at offset 27 (after drsFault), engineBlown/Seized at 36-37,
        # and 4 bytes of reserved/new fields at 38-41.
        offset = self.HEADER_SIZE + (player_idx * 42)
        try:
            d0 = struct.unpack_from('<4f', data, offset)        # 0-15:  tyresWear (floats, 0-100%)
            d1 = struct.unpack_from('<4B', data, offset + 16)   # 16-19: tyresDamage
            d2 = struct.unpack_from('<7B', data, offset + 20)   # 20-26: wings/floor/body/drsFault
            # offset+27: ersFault (F1 24, skip)
            d3 = struct.unpack_from('<8B', data, offset + 28)   # 28-35: gearBox,engine,MGUH/ES/CE/ICE/MGUK/TC wear
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
                gear_box_damage=d3[0],
                engine_damage=d3[1],
                engine_mguh_wear=d3[2],
                engine_es_wear=d3[3],
                engine_ce_wear=d3[4],
                engine_ice_wear=d3[5],
                engine_mguk_wear=d3[6],
                engine_tc_wear=d3[7],
            )
        except Exception:
            return CarDamage()

    def _decode_participants_full(self, data: bytes, num_cars: int = 22):
        """Decode the Participants packet. Auto-detects struct size from packet length
        (F1 22=56 bytes, F1 23=57 bytes, F1 24=58 bytes). Within each car block the
        relevant field offsets are stable across those versions:
          aiControlled(0), teamId(3), raceNumber(5), name[48](7..54), yourTelemetry(55).
        Returns (team_ids, participants) where team_ids has all 22 slots (for the track
        map) and participants lists only the active cars (for the driver selector)."""
        try:
            num_active = struct.unpack_from('<B', data, self.HEADER_SIZE)[0]
        except Exception:
            num_active = num_cars
        num_active = min(num_active, num_cars)
        payload = len(data) - self.HEADER_SIZE - 1  # subtract numActiveCars byte
        # The packet always carries 22 slots regardless of numActiveCars.
        exact = payload / num_cars
        struct_size = min((56, 57, 58), key=lambda s: abs(s - exact))
        team_ids: List[int] = []
        participants: List[Dict[str, Any]] = []
        for i in range(num_cars):
            base = self.HEADER_SIZE + 1 + i * struct_size
            try:
                ai_controlled = struct.unpack_from('<B', data, base)[0]
                team_id = struct.unpack_from('<B', data, base + 3)[0]
                race_number = struct.unpack_from('<B', data, base + 5)[0]
                name = data[base + 7:base + 7 + 48].split(b'\x00', 1)[0].decode('utf-8', errors='replace').strip()
                your_telemetry = struct.unpack_from('<B', data, base + 55)[0]
            except Exception:
                team_id, ai_controlled, race_number, name, your_telemetry = 255, 0, 0, "", 1
            team_ids.append(team_id)
            if i < num_active:
                participants.append({
                    "index": i,
                    "name": name or f"Car {i + 1}",
                    "team_id": team_id,
                    "race_number": race_number,
                    "ai_controlled": bool(ai_controlled),
                    "telemetry_public": your_telemetry == 1,
                })
        return team_ids, participants

    def _decode_all_lap_distances(self, data: bytes, num_cars: int = 22) -> List[float]:
        """Extract lap_distance for every car. lap_distance is a float at byte +18 within each 50-byte car block."""
        distances = []
        for i in range(num_cars):
            offset = self.HEADER_SIZE + i * 50 + 18
            try:
                dist = struct.unpack_from('<f', data, offset)[0]
                distances.append(round(dist, 1))
            except Exception:
                distances.append(0.0)
        return distances

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

    @staticmethod
    def _motion_dict(m: MotionData) -> Dict[str, Any]:
        return {
            "world_pos_x": m.world_pos_x,
            "world_pos_y": m.world_pos_y,
            "world_pos_z": m.world_pos_z,
            "g_force_lat": m.g_force_lat,
            "g_force_lon": m.g_force_lon,
            "g_force_vert": m.g_force_vert,
            "yaw": m.yaw,
            "pitch": m.pitch,
            "roll": m.roll,
            "wheel_speed": m.wheel_speed,
        }

    @staticmethod
    def _lap_dict(lap: LapData) -> Dict[str, Any]:
        return {
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

    @staticmethod
    def _telemetry_dict(t: CarTelemetry) -> Dict[str, Any]:
        return {
            "speed": t.speed,
            "throttle": round(t.throttle, 3),
            "steer": round(t.steer, 3),
            "brake": round(t.brake, 3),
            "clutch": t.clutch,
            "gear": t.gear,
            "engine_rpm": t.engine_rpm,
            "drs": t.drs,
            "rev_lights_percent": t.rev_lights_percent,
            "brakes_temp": t.brakes_temp,
            "tyres_surface_temp": t.tyres_surface_temp,
            "tyres_inner_temp": t.tyres_inner_temp,
            "engine_temp": t.engine_temp,
            "tyres_pressure": [round(p, 2) for p in t.tyres_pressure],
            "surface_type": t.surface_type,
        }

    @staticmethod
    def _status_dict(s: CarStatus) -> Dict[str, Any]:
        return {
            "fuel_in_tank": round(s.fuel_in_tank, 2),
            "fuel_capacity": round(s.fuel_capacity, 2),
            "fuel_remaining_laps": round(s.fuel_remaining_laps, 2),
            "drs_allowed": s.drs_allowed,
            "pit_limiter_status": s.pit_limiter_status,
            "tyres_wear": s.tyres_wear,
            "tyre_compound": s.visual_tyre_compound,
            "tyres_age_laps": s.tyres_age_laps,
            "front_left_wing_damage": s.front_left_wing_damage,
            "front_right_wing_damage": s.front_right_wing_damage,
            "rear_wing_damage": s.rear_wing_damage,
            "engine_damage": s.engine_damage,
            "gearbox_damage": s.gearbox_damage,
            "ers_store_energy": round(s.ers_store_energy, 2),
            "ers_deploy_mode": s.ers_deploy_mode,
            "ers_harvested_this_lap_mguk": round(s.ers_harvested_this_lap_mguk, 2),
            "ers_harvested_this_lap_mguh": round(s.ers_harvested_this_lap_mguh, 2),
            "ers_deployed_this_lap": round(s.ers_deployed_this_lap, 2),
        }

    @staticmethod
    def _damage_dict(d: CarDamage) -> Dict[str, Any]:
        return {
            "tyres_wear": [round(w, 2) for w in d.tyres_wear],
            "tyres_damage": d.tyres_damage,
            "front_left_wing_damage": d.front_left_wing_damage,
            "front_right_wing_damage": d.front_right_wing_damage,
            "rear_wing_damage": d.rear_wing_damage,
            "floor_damage": d.floor_damage,
            "diffuser_damage": d.diffuser_damage,
            "sidepod_damage": d.sidepod_damage,
            "gear_box_damage": d.gear_box_damage,
            "engine_damage": d.engine_damage,
        }

    def frame_to_dict(self, frame: TelemetryFrame) -> Dict[str, Any]:
        result = {
            "packet_id": frame.packet_id,
            "session_time": frame.session_time,
            "frame_identifier": frame.frame_identifier,
            "overall_frame_identifier": frame.overall_frame_identifier,
            "player_car_index": frame.player_car_index,
            "timestamp": frame.timestamp,
        }

        # Player-car fields (top level) — kept for session recording/backward compat.
        # Per-car arrays (`*_all`) let the frontend spectate any car in the session.
        if frame.motion:
            result["motion"] = self._motion_dict(frame.motion)
        if frame.motion_all:
            result["motion_all"] = [self._motion_dict(m) for m in frame.motion_all]

        if frame.lap:
            result["lap"] = self._lap_dict(frame.lap)
        if frame.lap_all:
            result["lap_all"] = [self._lap_dict(l) for l in frame.lap_all]

        if frame.telemetry:
            result["telemetry"] = self._telemetry_dict(frame.telemetry)
        if frame.telemetry_all:
            result["telemetry_all"] = [self._telemetry_dict(t) for t in frame.telemetry_all]

        if frame.status:
            result["status"] = self._status_dict(frame.status)
        if frame.status_all:
            result["status_all"] = [self._status_dict(s) for s in frame.status_all]

        if frame.damage:
            result["damage"] = self._damage_dict(frame.damage)
        if frame.damage_all:
            result["damage_all"] = [self._damage_dict(d) for d in frame.damage_all]

        if frame.all_lap_distances:
            result["all_lap_distances"] = frame.all_lap_distances

        if frame.car_team_ids:
            result["car_team_ids"] = frame.car_team_ids

        if frame.participants:
            result["participants"] = frame.participants

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
