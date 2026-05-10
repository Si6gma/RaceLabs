"""
Streaming CSV parser for telemetry data.
Supports large files, auto-detection, and incremental processing.
"""
import csv
import logging
from typing import Iterator, Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from io import StringIO

logger = logging.getLogger(__name__)

# Expected CSV columns
REQUIRED_COLUMNS = {
    "carId", "trackId", "trackLength", "lapIndex", "lapNum",
    "binIndex", "world_position_X", "world_position_Y", "world_position_Z",
    "velocity_X", "velocity_Y", "velocity_Z",
    "throttle", "brake", "steering", "gear", "rpm"
}

OPTIONAL_COLUMNS = {
    "lapFlag", "validBin", "lap_time",
    "world_right_X", "world_right_Y", "world_right_Z",
    "gforce_Y", "race_position"
}

ALL_COLUMNS = REQUIRED_COLUMNS | OPTIONAL_COLUMNS


@dataclass
class CSVValidationResult:
    valid: bool
    headers: List[str]
    missing_required: List[str]
    unknown_columns: List[str]
    row_count: int = 0
    sample_rows: List[Dict[str, Any]] = None
    errors: List[str] = None

    def __post_init__(self):
        if self.sample_rows is None:
            self.sample_rows = []
        if self.errors is None:
            self.errors = []


@dataclass
class CSVParseStats:
    total_rows: int = 0
    valid_rows: int = 0
    invalid_rows: int = 0
    laps_detected: int = 0
    samples_per_second: float = 0.0
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


def detect_dialect(sample: str) -> Tuple[str, str]:
    """Detect CSV dialect from sample."""
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        return dialect.delimiter, dialect.quotechar
    except csv.Error:
        return ',', '"'


def validate_csv_headers(headers: List[str]) -> CSVValidationResult:
    """Validate CSV headers against expected schema."""
    header_set = set(headers)
    missing_required = list(REQUIRED_COLUMNS - header_set)
    unknown_columns = list(header_set - ALL_COLUMNS)
    
    valid = len(missing_required) == 0
    
    return CSVValidationResult(
        valid=valid,
        headers=headers,
        missing_required=missing_required,
        unknown_columns=unknown_columns,
    )


def validate_csv_preview(file_content: str, max_rows: int = 10) -> CSVValidationResult:
    """Validate CSV file and return preview."""
    try:
        lines = file_content.splitlines()
        if not lines:
            return CSVValidationResult(valid=False, headers=[], missing_required=list(REQUIRED_COLUMNS), errors=["Empty file"])
        
        delimiter, _ = detect_dialect('\n'.join(lines[:5]))
        
        reader = csv.DictReader(lines, delimiter=delimiter)
        headers = reader.fieldnames or []
        result = validate_csv_headers(headers)
        
        # Read sample rows
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            parsed = _parse_row(row, headers)
            if parsed:
                result.sample_rows.append(parsed)
        
        result.row_count = sum(1 for _ in csv.DictReader(lines[1:], delimiter=delimiter))
        return result
        
    except Exception as e:
        logger.error(f"CSV validation error: {e}")
        return CSVValidationResult(
            valid=False, headers=[], missing_required=list(REQUIRED_COLUMNS),
            errors=[str(e)]
        )


# Pre-built type mapping for fast row parsing
_NUMERIC_FIELDS = {
    "trackLength": float, "lapIndex": int, "lapNum": int,
    "binIndex": int, "world_position_X": float, "world_position_Y": float,
    "world_position_Z": float, "world_right_X": float, "world_right_Y": float,
    "world_right_Z": float, "velocity_X": float, "velocity_Y": float,
    "velocity_Z": float, "gforce_Y": float, "race_position": int,
    "throttle": float, "brake": float, "steering": float,
    "gear": int, "rpm": int, "lap_time": float,
}


def _parse_row(row: Dict[str, str], headers: List[str]) -> Optional[Dict[str, Any]]:
    """Parse a single CSV row into typed values."""
    try:
        result: Dict[str, Any] = {}
        
        # String fields
        val = row.get("carId")
        if val:
            result["carId"] = val.strip()
        val = row.get("trackId")
        if val:
            result["trackId"] = val.strip()
        
        # Numeric fields — local variable lookup is faster than attribute access
        nf = _NUMERIC_FIELDS
        row_get = row.get
        for field, field_type in nf.items():
            raw = row_get(field)
            if raw is not None:
                raw = raw.strip()
                if raw:
                    try:
                        val = field_type(raw)
                        if val == -1 or val == -1.0:
                            result[field] = None
                        else:
                            result[field] = val
                    except (ValueError, TypeError):
                        result[field] = None
                    continue
            result[field] = None
        
        # Boolean fields
        raw = row_get("validBin")
        if raw is not None:
            raw = raw.strip().lower()
            result["validBin"] = raw in ("1", "true", "yes", "1.0") if raw else True
        else:
            result["validBin"] = True
            
        raw = row_get("lapFlag")
        if raw is not None:
            raw = raw.strip().lower()
            result["lapFlag"] = raw in ("1", "true", "yes", "1.0") if raw else False
        else:
            result["lapFlag"] = False
        
        return result
    except Exception as e:
        logger.warning(f"Row parse error: {e}")
        return None


def is_row_valid(row: Dict[str, Any]) -> bool:
    """Check if a row has actual telemetry data (not all -1/garage values)."""
    # Key fields that must not be None/-1 for the row to be valid
    key_fields = ["world_position_X", "velocity_X", "throttle", "gear", "rpm"]
    for field in key_fields:
        if row.get(field) is not None and row[field] != -1:
            return True
    return False


def stream_csv_rows(file_content: str, chunk_size: int = 1000) -> Iterator[List[Dict[str, Any]]]:
    """Stream CSV rows in chunks to avoid memory issues.
    
    Filters out rows with no actual telemetry data (garage/idle rows with all -1s).
    """
    lines = file_content.splitlines()
    if not lines:
        return
    
    delimiter, _ = detect_dialect('\n'.join(lines[:5]))
    reader = csv.DictReader(lines, delimiter=delimiter)
    headers = reader.fieldnames or []
    
    chunk = []
    for row in reader:
        parsed = _parse_row(row, headers)
        if parsed is not None and is_row_valid(parsed):
            chunk.append(parsed)
        
        if len(chunk) >= chunk_size:
            yield chunk
            chunk = []
    
    if chunk:
        yield chunk


def parse_csv_file(file_content: str) -> Tuple[List[Dict[str, Any]], CSVParseStats]:
    """Parse entire CSV file into memory. Use stream_csv_rows for large files."""
    stats = CSVParseStats()
    all_rows = []
    total_raw_rows = 0
    
    for chunk in stream_csv_rows(file_content):
        all_rows.extend(chunk)
        stats.valid_rows += len(chunk)
        total_raw_rows += len(chunk)  # stream_csv_rows yields filtered chunks
    
    stats.total_rows = total_raw_rows
    
    # Detect laps using lapIndex (more reliable than lapNum)
    lap_indices = set()
    for row in all_rows:
        if row.get("lapIndex") is not None:
            lap_indices.add(row["lapIndex"])
    stats.laps_detected = len(lap_indices)
    
    return all_rows, stats
