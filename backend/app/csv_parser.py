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


def _parse_row(row: Dict[str, str], headers: List[str]) -> Optional[Dict[str, Any]]:
    """Parse a single CSV row into typed values."""
    try:
        result = {}
        
        # String fields
        for col in ["carId", "trackId"]:
            if col in row:
                result[col] = row[col].strip()
        
        # Numeric fields
        numeric_fields = {
            "trackLength": float, "lapIndex": int, "lapNum": int,
            "binIndex": int, "world_position_X": float, "world_position_Y": float,
            "world_position_Z": float, "world_right_X": float, "world_right_Y": float,
            "world_right_Z": float, "velocity_X": float, "velocity_Y": float,
            "velocity_Z": float, "gforce_Y": float, "race_position": int,
            "throttle": float, "brake": float, "steering": float,
            "gear": int, "rpm": int, "lap_time": float,
        }
        
        for field, field_type in numeric_fields.items():
            if field in row and row[field].strip():
                try:
                    result[field] = field_type(row[field])
                except (ValueError, TypeError):
                    result[field] = None
            else:
                result[field] = None
        
        # Boolean fields
        if "validBin" in row:
            val = row["validBin"].strip().lower()
            result["validBin"] = val in ("1", "true", "yes", "1.0") if val else True
        else:
            result["validBin"] = True
            
        if "lapFlag" in row:
            val = row["lapFlag"].strip().lower()
            result["lapFlag"] = val in ("1", "true", "yes", "1.0") if val else False
        else:
            result["lapFlag"] = False
        
        return result
    except Exception as e:
        logger.warning(f"Row parse error: {e}")
        return None


def stream_csv_rows(file_content: str, chunk_size: int = 1000) -> Iterator[List[Dict[str, Any]]]:
    """Stream CSV rows in chunks to avoid memory issues."""
    lines = file_content.splitlines()
    if not lines:
        return
    
    delimiter, _ = detect_dialect('\n'.join(lines[:5]))
    reader = csv.DictReader(lines, delimiter=delimiter)
    headers = reader.fieldnames or []
    
    chunk = []
    for row in reader:
        parsed = _parse_row(row, headers)
        if parsed is not None:
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
    
    for chunk in stream_csv_rows(file_content):
        all_rows.extend(chunk)
        stats.valid_rows += len(chunk)
    
    stats.total_rows = len(all_rows)
    
    # Detect laps
    lap_nums = set()
    for row in all_rows:
        if row.get("lapNum") is not None:
            lap_nums.add(row["lapNum"])
    stats.laps_detected = len(lap_nums)
    
    return all_rows, stats
