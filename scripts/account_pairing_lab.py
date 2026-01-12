#!/usr/bin/env python3
"""
Account Pairing Lab (SQLite)

Goal:
  Help debug + simplify the CC↔Bank pairing problem using data already in the DB.

What it does:
  Two modes:
    - --mode app (default): mirrors the app's current methodology in
      app/server/services/accounts/auto-pairing.js (findBestBankAccount + calculateDiscrepancy).
    - --mode discover: legacy cycle-similarity exploration (useful when you don't have pairings yet).

  App mode:
    - If --pairing-id is provided, loads that row from account_pairings and prints cycle statuses.
    - If --cc is provided (and --bank is optional), finds the best bank account like the app and prints cycle statuses.
    - If nothing is provided, runs discrepancy over all active pairings in account_pairings.

This script is read-only and safe to run.

Examples:
  # App-parity discrepancy for all active pairings
  python3 scripts/account_pairing_lab.py

  # App-parity discrepancy for a specific pairing
  python3 scripts/account_pairing_lab.py --pairing-id 3 --months 6

  # App-parity: find best bank account for this CC, then compute discrepancy
  python3 scripts/account_pairing_lab.py --cc visaCal:1456 --months 6

  # Legacy discovery mode
  python3 scripts/account_pairing_lab.py --mode discover --cc visaCal:1456 --verbose
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import logging
import math
import re
import sqlite3
import statistics
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, Optional

LOGGER = logging.getLogger("account_pairing_lab")


VENDOR_KEYWORDS: dict[str, list[str]] = {
    "max": ["מקס", "max"],
    "visaCal": ["כ.א.ל", "cal", "ויזה כאל", "visa cal"],
    "isracard": ["ישראכרט", "isracard"],
    "amex": ["אמקס", "אמריקן אקספרס", "amex", "american express"],
    "leumi": ["לאומי כרט", "leumi card"],
    "diners": ["דיינרס", "diners"],
}

REPAYMENT_CATEGORY_MATCH = {
    "name": ["פרעון כרטיס אשראי", "החזר כרטיס אשראי"],
    "name_en": ["Credit Card Repayment", "Card repayment", "Credit card repayment"],
    "name_fr": ["Remboursement de carte de crédit"],
}

LAST4_RE = re.compile(r"\d{4}")


@dataclass(frozen=True)
class VendorCredential:
    vendor: str
    institution_type: Optional[str]
    display_name_en: Optional[str]
    bank_account_number: Optional[str]
    nickname: Optional[str]
    card6_digits: list[str]


@dataclass(frozen=True)
class RepaymentTxn:
    identifier: str
    bank_vendor: str
    bank_account_number: Optional[str]
    iso_datetime: str
    cycle_date: str
    name: str
    price: float
    detected_cc_vendor: Optional[str]
    detected_last4: Optional[str]

@dataclass(frozen=True)
class AccountPairing:
    id: int
    credit_card_vendor: str
    credit_card_account_number: Optional[str]
    bank_vendor: str
    bank_account_number: Optional[str]
    match_patterns: list[str]
    is_active: bool
    discrepancy_acknowledged: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="dist/clarify.sqlite", help="SQLite DB path (default: dist/clarify.sqlite)")
    parser.add_argument("--months", type=int, default=6, help="How many months back to analyze (app: from today, discover: from DB max(date))")
    parser.add_argument("--top", type=int, default=5, help="Top candidates to display (discover mode)")
    parser.add_argument("--mode", default="app", choices=["app", "discover"], help="Which methodology to run (default: app)")
    parser.add_argument("--pairing-id", type=int, default=None, help="Run app discrepancy for an existing account_pairings.id")
    parser.add_argument("--include-inactive", action="store_true", help="Include inactive pairings when running app mode without --pairing-id/--cc")
    parser.add_argument("--json", action="store_true", help="Output JSON to stdout (app mode only)")
    parser.add_argument("--cc", default=None, help="Filter by CC vendor/account: e.g. visaCal:1456")
    parser.add_argument("--bank", default=None, help="Filter by bank vendor/account: e.g. discount:0162490242")
    parser.add_argument("--verbose", action="store_true", help="Verbose logs (prints more per-cycle details)")
    return parser.parse_args()


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s")


def iso_to_datetime(value: str) -> dt.datetime:
    # DB stores e.g. 2025-11-22T22:00:00.000Z
    normalized = value.replace("Z", "+00:00")
    return dt.datetime.fromisoformat(normalized)


def subtract_months(anchor: dt.datetime, months: int) -> dt.datetime:
    # Simple, good-enough for analysis: approximate months as 30 days.
    return anchor - dt.timedelta(days=months * 30)

def subtract_calendar_months(anchor: dt.date, months: int) -> dt.date:
    if months <= 0:
        return anchor

    month0 = (anchor.year * 12 + (anchor.month - 1)) - months
    year = month0 // 12
    month = (month0 % 12) + 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)


def db_connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def fetchone(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> Optional[sqlite3.Row]:
    cur = conn.execute(sql, params)
    row = cur.fetchone()
    cur.close()
    return row


def fetchall(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    cur = conn.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    return rows


def log_section(title: str) -> None:
    LOGGER.info("")
    LOGGER.info("==== %s ====", title)


def normalize_text(value: str) -> str:
    return (value or "").lower()


def detect_cc_vendor_from_name(name: str) -> Optional[str]:
    name_lower = normalize_text(name)
    for vendor, keywords in VENDOR_KEYWORDS.items():
        for kw in keywords:
            if normalize_text(kw) in name_lower:
                return vendor
    return None


def extract_last4(name: str) -> Optional[str]:
    matches = LAST4_RE.findall(name or "")
    return matches[-1] if matches else None

def get_account_last4(account_number: Optional[str]) -> Optional[str]:
    if not account_number or not isinstance(account_number, str):
        return None
    trimmed = account_number.strip()
    if not trimmed:
        return None
    return trimmed[-4:] if len(trimmed) > 4 else trimmed

def extract_digit_sequences(text: Optional[str]) -> list[str]:
    if not text:
        return []
    matches = re.findall(r"\d{4,}", text)
    out: set[str] = set()
    for m in matches:
        out.add(m)
        if len(m) > 4:
            out.add(m[-4:])
    return sorted(out)

def name_contains_vendor(name: Optional[str], cc_vendor: Optional[str]) -> bool:
    if not name or not cc_vendor:
        return False
    keywords = VENDOR_KEYWORDS.get(cc_vendor, [])
    name_lower = name.lower()
    return any(kw.lower() in name_lower for kw in keywords)

def build_match_patterns(cc_vendor: str, cc_account_number: Optional[str]) -> list[str]:
    patterns: list[str] = []
    patterns.extend(VENDOR_KEYWORDS.get(cc_vendor, []))
    if cc_account_number:
        patterns.append(cc_account_number)
        last4 = get_account_last4(cc_account_number)
        if last4 and last4 != cc_account_number:
            patterns.append(last4)
    seen: set[str] = set()
    unique: list[str] = []
    for p in patterns:
        if not p:
            continue
        if p in seen:
            continue
        seen.add(p)
        unique.append(p)
    return unique


def load_vendor_credentials(conn: sqlite3.Connection) -> list[VendorCredential]:
    rows = fetchall(
        conn,
        """
        SELECT
          vc.vendor,
          vc.bank_account_number,
          vc.nickname,
          vc.card6_digits,
          fi.institution_type,
          fi.display_name_en
        FROM vendor_credentials vc
        LEFT JOIN institution_nodes fi ON vc.institution_id = fi.id
        ORDER BY fi.institution_type, vc.vendor
        """,
    )
    credentials: list[VendorCredential] = []
    for row in rows:
        card6 = []
        if row["card6_digits"]:
            card6 = [part.strip() for part in str(row["card6_digits"]).split(";") if part.strip()]
        credentials.append(
            VendorCredential(
                vendor=str(row["vendor"]),
                institution_type=row["institution_type"],
                display_name_en=row["display_name_en"],
                bank_account_number=row["bank_account_number"],
                nickname=row["nickname"],
                card6_digits=card6,
            )
        )
    return credentials


def build_category_predicates() -> tuple[str, list[str]]:
    """
    Returns:
      (sql_predicate, params) where predicate can be embedded into WHERE.
    """
    clauses = []
    params: list[str] = []
    if REPAYMENT_CATEGORY_MATCH["name"]:
        placeholders = ",".join("?" for _ in REPAYMENT_CATEGORY_MATCH["name"])
        clauses.append(f"cd.name IN ({placeholders})")
        params.extend(REPAYMENT_CATEGORY_MATCH["name"])
    if REPAYMENT_CATEGORY_MATCH["name_en"]:
        placeholders = ",".join("?" for _ in REPAYMENT_CATEGORY_MATCH["name_en"])
        clauses.append(f"cd.name_en IN ({placeholders})")
        params.extend(REPAYMENT_CATEGORY_MATCH["name_en"])
    if REPAYMENT_CATEGORY_MATCH["name_fr"]:
        placeholders = ",".join("?" for _ in REPAYMENT_CATEGORY_MATCH["name_fr"])
        clauses.append(f"cd.name_fr IN ({placeholders})")
        params.extend(REPAYMENT_CATEGORY_MATCH["name_fr"])

    if not clauses:
        return "(0)", []

    return "(" + " OR ".join(clauses) + ")", params


def get_cc_fees_category_id(conn: sqlite3.Connection) -> Optional[int]:
    row = fetchone(
        conn,
        """
        SELECT id FROM category_definitions
        WHERE name_en = 'Bank & Card Fees'
           OR name = 'עמלות בנק וכרטיס'
        LIMIT 1
        """,
    )
    if not row or row["id"] is None:
        return None
    try:
        return int(row["id"])
    except (TypeError, ValueError):
        return None


def get_cc_earliest_cycle_date(
    conn: sqlite3.Connection,
    *,
    cc_vendor: str,
    cc_account_number: Optional[str],
    cc_fees_category_id: Optional[int],
) -> Optional[dt.date]:
    params: list[Any] = [cc_vendor]
    account_filter = ""
    if cc_account_number:
        params.append(cc_account_number)
        account_filter = "AND t.account_number = ?"

    fees_filter = ""
    if cc_fees_category_id is not None:
        params.append(cc_fees_category_id)
        fees_filter = "AND (t.category_definition_id IS NULL OR t.category_definition_id != ?)"

    row = fetchone(
        conn,
        f"""
        SELECT MIN(substr(COALESCE(t.processed_date, t.date), 1, 10)) AS min_date
        FROM transactions t
        WHERE t.vendor = ?
          AND t.status = 'completed'
          AND t.price < 0
          {account_filter}
          {fees_filter}
        """,
        tuple(params),
    )
    if not row or not row["min_date"]:
        return None
    try:
        return dt.date.fromisoformat(str(row["min_date"]))
    except ValueError:
        return None


def get_db_time_window(conn: sqlite3.Connection, months_back: int) -> tuple[str, str]:
    row = fetchone(conn, "SELECT MAX(date) AS max_date, MIN(date) AS min_date FROM transactions")
    if not row or not row["max_date"]:
        raise RuntimeError("No transactions found in DB.")
    end_dt = iso_to_datetime(str(row["max_date"]))
    start_dt = subtract_months(end_dt, months_back)
    start_date = start_dt.date().isoformat()
    end_date = end_dt.date().isoformat()
    LOGGER.info("DB range: %s → %s (analyzing last %s months: %s → %s)", row["min_date"], row["max_date"], months_back, start_date, end_date)
    return start_date, end_date

def parse_json_list(value: Optional[str]) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if item is not None]

def table_has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    try:
        rows = fetchall(conn, f"PRAGMA table_info('{table}')")
    except sqlite3.OperationalError:
        return False
    return any(str(row["name"] or "") == column for row in rows)

def load_pairing_by_id(conn: sqlite3.Connection, pairing_id: int) -> Optional[AccountPairing]:
    has_ack = table_has_column(conn, "account_pairings", "discrepancy_acknowledged")
    select_ack = ", discrepancy_acknowledged" if has_ack else ""
    try:
        row = fetchone(
            conn,
            f"""
            SELECT
              id,
              credit_card_vendor,
              credit_card_account_number,
              bank_vendor,
              bank_account_number,
              match_patterns,
              is_active
              {select_ack}
            FROM account_pairings
            WHERE id = ?
            """,
            (pairing_id,),
        )
    except sqlite3.OperationalError:
        return None

    if not row:
        return None

    return AccountPairing(
        id=int(row["id"]),
        credit_card_vendor=str(row["credit_card_vendor"]),
        credit_card_account_number=(str(row["credit_card_account_number"]) if row["credit_card_account_number"] is not None else None),
        bank_vendor=str(row["bank_vendor"]),
        bank_account_number=(str(row["bank_account_number"]) if row["bank_account_number"] is not None else None),
        match_patterns=parse_json_list(row["match_patterns"]),
        is_active=bool(row["is_active"]),
        discrepancy_acknowledged=bool(row["discrepancy_acknowledged"]) if has_ack else False,
    )

def list_pairings(conn: sqlite3.Connection, *, include_inactive: bool) -> list[AccountPairing]:
    has_ack = table_has_column(conn, "account_pairings", "discrepancy_acknowledged")
    select_ack = ", discrepancy_acknowledged" if has_ack else ""
    try:
        rows = fetchall(
            conn,
            f"""
            SELECT
              id,
              credit_card_vendor,
              credit_card_account_number,
              bank_vendor,
              bank_account_number,
              match_patterns,
              is_active
              {select_ack}
            FROM account_pairings
            ORDER BY created_at DESC
            """,
        )
    except sqlite3.OperationalError:
        return []

    pairings: list[AccountPairing] = []
    for row in rows:
        is_active = bool(row["is_active"])
        if not include_inactive and not is_active:
            continue
        pairings.append(
            AccountPairing(
                id=int(row["id"]),
                credit_card_vendor=str(row["credit_card_vendor"]),
                credit_card_account_number=(str(row["credit_card_account_number"]) if row["credit_card_account_number"] is not None else None),
                bank_vendor=str(row["bank_vendor"]),
                bank_account_number=(str(row["bank_account_number"]) if row["bank_account_number"] is not None else None),
                match_patterns=parse_json_list(row["match_patterns"]),
                is_active=is_active,
                discrepancy_acknowledged=bool(row["discrepancy_acknowledged"]) if has_ack else False,
            )
        )
    return pairings

def find_best_bank_account_app(
    conn: sqlite3.Connection,
    *,
    credit_card_vendor: str,
    credit_card_account_number: Optional[str],
    bank_vendor_filter: Optional[str],
    bank_account_filter: Optional[str],
    limit: int = 500,
) -> dict[str, Any]:
    if not credit_card_vendor:
        raise ValueError("credit_card_vendor is required")

    cc_last4 = get_account_last4(credit_card_account_number)
    cc_vendors = sorted(VENDOR_KEYWORDS.keys())

    predicate, pred_params = build_category_predicates()
    placeholders = ",".join("?" for _ in cc_vendors) if cc_vendors else "''"

    params: list[Any] = []
    where_clauses: list[str] = []

    where_clauses.append(f"t.vendor NOT IN ({placeholders})")
    params.extend(cc_vendors)

    if bank_vendor_filter:
        where_clauses.append("t.vendor = ?")
        params.append(bank_vendor_filter)
    if bank_account_filter:
        where_clauses.append("t.account_number = ?")
        params.append(bank_account_filter)

    where_clauses.append("t.price < 0")
    where_clauses.append(predicate)
    params.extend(pred_params)

    rows = fetchall(
        conn,
        f"""
        SELECT
          t.identifier,
          t.vendor,
          t.account_number,
          t.name,
          t.price,
          t.date
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        WHERE {' AND '.join(where_clauses)}
        ORDER BY t.date DESC
        LIMIT {int(limit)}
        """,
        tuple(params),
    )

    if not rows:
        return {"found": False, "reason": "No bank repayment transactions found"}

    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        vendor = str(row["vendor"])
        account_number = str(row["account_number"]) if row["account_number"] is not None else None
        key = f"{vendor}|{account_number or 'null'}"
        group = groups.setdefault(
            key,
            {
                "bankVendor": vendor,
                "bankAccountNumber": account_number,
                "transactions": [],
                "matchingLast4Count": 0,
                "matchingVendorCount": 0,
            },
        )
        name = str(row["name"] or "")
        group["transactions"].append(
            {
                "identifier": str(row["identifier"]),
                "name": name,
                "price": float(row["price"] or 0),
                "date": str(row["date"]),
            }
        )

        name_contains_cc = bool(cc_last4 and name and cc_last4 in name)
        name_has_vendor = name_contains_vendor(name, credit_card_vendor)

        if name_contains_cc:
            group["matchingLast4Count"] += 1
        if name_has_vendor:
            group["matchingVendorCount"] += 1

    candidates = [
        g for g in groups.values()
        if g["matchingLast4Count"] > 0 or g["matchingVendorCount"] > 0
    ]
    candidates.sort(
        key=lambda g: (
            g["matchingLast4Count"],
            g["matchingVendorCount"],
            len(g["transactions"]),
        ),
        reverse=True,
    )

    if not candidates:
        return {
            "found": False,
            "reason": f"No bank repayments reference this credit card (last4: {cc_last4 or 'unknown'})",
        }

    best = candidates[0]
    match_patterns = build_match_patterns(credit_card_vendor, credit_card_account_number)

    sample_transactions: list[dict[str, Any]] = []
    for txn in best["transactions"]:
        name = str(txn.get("name") or "")
        has_last4 = bool(cc_last4 and cc_last4 in name)
        has_vendor = name_contains_vendor(name, credit_card_vendor)
        if not (has_last4 or has_vendor):
            continue
        sample_transactions.append(
            {
                "name": name,
                "price": txn.get("price"),
                "date": txn.get("date"),
            }
        )
        if len(sample_transactions) >= 3:
            break

    return {
        "found": True,
        "bankVendor": best["bankVendor"],
        "bankAccountNumber": best["bankAccountNumber"],
        "transactionCount": len(best["transactions"]),
        "matchingLast4Count": best["matchingLast4Count"],
        "matchingVendorCount": best["matchingVendorCount"],
        "matchPatterns": match_patterns,
        "sampleTransactions": sample_transactions,
        "otherCandidates": [
            {
                "bankVendor": c["bankVendor"],
                "bankAccountNumber": c["bankAccountNumber"],
                "transactionCount": len(c["transactions"]),
            }
            for c in candidates[1:3]
        ],
    }

def calculate_discrepancy_app(
    conn: sqlite3.Connection,
    *,
    pairing_id: Optional[int],
    bank_vendor: str,
    bank_account_number: Optional[str],
    cc_vendor: str,
    cc_account_number: Optional[str],
    months_back: int,
    limit: int = 500,
) -> dict[str, Any]:
    if not bank_vendor or not cc_vendor:
        return {"exists": False, "cycles": []}

    today = dt.datetime.now(dt.timezone.utc).date()
    today_str = today.isoformat()
    start_date = subtract_calendar_months(today, months_back)
    start_date_str = start_date.isoformat()

    EPSILON = 1.0
    MAX_FEE_AMOUNT = 200.0
    actionable_statuses = {"fee_candidate", "large_discrepancy", "cc_over_bank", "missing_cc_cycle"}
    EARLY_GRACE_DAYS = 14
    RECENT_GRACE_DAYS = 14

    acknowledged = False
    if pairing_id is not None:
        try:
            row = fetchone(conn, "SELECT discrepancy_acknowledged FROM account_pairings WHERE id = ?", (pairing_id,))
            acknowledged = bool(row and row["discrepancy_acknowledged"])
        except sqlite3.OperationalError:
            acknowledged = False

    predicate, pred_params = build_category_predicates()
    cc_fees_category_id = get_cc_fees_category_id(conn)
    earliest_cc_cycle_date = get_cc_earliest_cycle_date(
        conn,
        cc_vendor=cc_vendor,
        cc_account_number=cc_account_number,
        cc_fees_category_id=cc_fees_category_id,
    )

    bank_account_filter_sql = ""
    bank_params: list[Any] = [bank_vendor, start_date_str, today_str]
    bank_params.extend(pred_params)
    if bank_account_number:
        bank_account_filter_sql = "AND t.account_number = ?"
        bank_params.append(bank_account_number)

    repayment_rows = fetchall(
        conn,
        f"""
        SELECT
          t.identifier,
          t.vendor,
          t.account_number,
          t.date,
          substr(t.date, 1, 10) as repayment_date,
          t.name,
          t.price
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        WHERE t.vendor = ?
          AND substr(t.date, 1, 10) >= ?
          AND substr(t.date, 1, 10) <= ?
          AND t.status = 'completed'
          AND t.price < 0
          AND {predicate}
          {bank_account_filter_sql}
        ORDER BY t.date DESC
        LIMIT {int(limit)}
        """,
        tuple(bank_params),
    )

    cc_last4 = get_account_last4(cc_account_number)
    cc_keywords = VENDOR_KEYWORDS.get(cc_vendor, [])

    def repayment_matches_cc(name: Optional[str]) -> bool:
        if not name:
            return False
        if cc_last4 and cc_last4 in name:
            return True
        name_lower = name.lower()
        return any(kw.lower() in name_lower for kw in cc_keywords)

    matching_repayments = [row for row in repayment_rows if repayment_matches_cc(str(row["name"] or ""))]
    if not matching_repayments:
        return {
            "exists": False,
            "acknowledged": acknowledged,
            "reason": f"No bank repayments found matching this credit card ({cc_vendor} {cc_last4 or ''})",
            "periodMonths": months_back,
            "cycles": [],
        }

    repayments_by_date: dict[str, dict[str, Any]] = {}
    for row in matching_repayments:
        date_key = str(row["repayment_date"])
        bucket = repayments_by_date.setdefault(
            date_key,
            {
                "repaymentDate": date_key,
                "repayments": [],
                "bankTotal": 0.0,
            },
        )
        price = float(row["price"] or 0)
        bucket["repayments"].append(
            {
                "identifier": str(row["identifier"]),
                "vendor": str(row["vendor"]),
                "accountNumber": (str(row["account_number"]) if row["account_number"] is not None else None),
                "date": str(row["date"]),
                "cycleDate": date_key,
                "name": str(row["name"] or ""),
                "price": price,
            }
        )
        bucket["bankTotal"] += abs(price)

    cc_fees_category_id_value = cc_fees_category_id if cc_fees_category_id is not None else -1

    cycles: list[dict[str, Any]] = []
    for date_key, bucket in repayments_by_date.items():
        cc_params: list[Any] = [cc_fees_category_id_value, cc_vendor, date_key]
        cc_account_filter_sql = ""
        if cc_account_number:
            cc_params.append(cc_account_number)
            cc_account_filter_sql = "AND t.account_number = ?"

        cc_rows = fetchall(
            conn,
            f"""
            SELECT
              t.account_number,
              COALESCE(SUM(
                CASE
                  WHEN t.category_definition_id = ?
                    AND t.price < 0
                    AND lower(COALESCE(t.name, '')) LIKE '%דמי כרטיס%'
                    AND (
                      lower(COALESCE(t.name, '')) LIKE '%פטור%'
                      OR lower(COALESCE(t.name, '')) LIKE '%הנחה%'
                    )
                    THEN t.price
                  ELSE -t.price
                END
              ), 0) AS total,
              COUNT(*) as txn_count
            FROM transactions t
            WHERE t.vendor = ?
              AND t.status = 'completed'
              AND substr(COALESCE(t.processed_date, t.date), 1, 10) = ?
              {cc_account_filter_sql}
            GROUP BY t.account_number
            """,
            tuple(cc_params),
        )

        cc_total: Optional[float] = None
        matched_account: Optional[str] = None
        status = "missing_cc_cycle"

        if cc_rows:
            for cc_row in cc_rows:
                row_total = max(0.0, float(cc_row["total"] or 0))
                diff_abs = abs(bucket["bankTotal"] - row_total)
                if diff_abs <= EPSILON:
                    cc_total = row_total
                    matched_account = str(cc_row["account_number"]) if cc_row["account_number"] is not None else None
                    status = "matched"
                    break
                if diff_abs <= MAX_FEE_AMOUNT and diff_abs > EPSILON and bucket["bankTotal"] > row_total:
                    cc_total = row_total
                    matched_account = str(cc_row["account_number"]) if cc_row["account_number"] is not None else None
                    status = "fee_candidate"

            if status == "missing_cc_cycle" and cc_account_number:
                cc_row = next((r for r in cc_rows if str(r["account_number"] or "") == cc_account_number), None)
                if cc_row:
                    row_total = max(0.0, float(cc_row["total"] or 0))
                    diff = bucket["bankTotal"] - row_total
                    cc_total = row_total
                    matched_account = cc_account_number
                    if abs(diff) <= EPSILON:
                        status = "matched"
                    elif diff > 0 and diff <= MAX_FEE_AMOUNT:
                        status = "fee_candidate"
                    elif diff > MAX_FEE_AMOUNT:
                        status = "large_discrepancy"
                    else:
                        status = "cc_over_bank"

        difference = None if cc_total is None else (bucket["bankTotal"] - cc_total)

        cycles.append(
            {
                "cycleDate": date_key,
                "bankTotal": round(bucket["bankTotal"], 2),
                "ccTotal": None if cc_total is None else round(cc_total, 2),
                "difference": None if difference is None else round(difference, 2),
                "repayments": bucket["repayments"],
                "status": status,
                "matchedAccount": matched_account,
            }
        )

    cycles.sort(key=lambda c: c["cycleDate"], reverse=True)

    for cycle in cycles:
        status = str(cycle.get("status") or "")
        if status not in actionable_statuses:
            continue
        cycle_date_str = str(cycle.get("cycleDate") or "")
        try:
            cycle_date = dt.date.fromisoformat(cycle_date_str)
        except ValueError:
            continue

        if earliest_cc_cycle_date is not None and (cycle_date - earliest_cc_cycle_date).days <= EARLY_GRACE_DAYS:
            cycle["status"] = "incomplete_history"
            continue
        if 0 <= (today - cycle_date).days <= RECENT_GRACE_DAYS:
            cycle["status"] = "incomplete_history"

    comparable = [c for c in cycles if c["ccTotal"] is not None and c.get("status") != "incomplete_history"]
    total_bank = sum(float(c["bankTotal"]) for c in comparable)
    total_cc = sum(float(c["ccTotal"] or 0) for c in comparable)
    total_diff = total_bank - total_cc

    has_discrepancy = any(c["status"] in actionable_statuses for c in cycles)

    return {
        "exists": bool(has_discrepancy and not acknowledged),
        "acknowledged": acknowledged,
        "totalBankRepayments": round(total_bank, 2),
        "totalCCExpenses": round(total_cc, 2),
        "difference": round(total_diff, 2),
        "differencePercentage": round((total_diff / total_cc) * 100, 2) if total_cc > 0 else 0,
        "periodMonths": months_back,
        "matchedCycleCount": sum(1 for c in cycles if c["status"] == "matched"),
        "totalCycles": len(cycles),
        "cycles": cycles,
    }


def get_cc_totals_for_date_range(
    conn: sqlite3.Connection,
    *,
    cc_vendor: str,
    cc_account_number: Optional[str],
    start_date: str,
    end_date: str,
) -> dict[str, float]:
    cc_fees_category_id = get_cc_fees_category_id(conn)
    cc_fees_category_id_value = cc_fees_category_id if cc_fees_category_id is not None else -1
    params: list[Any] = [cc_fees_category_id_value, cc_vendor, start_date, end_date]
    account_filter = ""
    if cc_account_number:
        params.append(cc_account_number)
        account_filter = "AND t.account_number = ?"

    rows = fetchall(
        conn,
        f"""
        SELECT
          substr(COALESCE(t.processed_date, t.date), 1, 10) AS cycle_date,
          COALESCE(SUM(
            CASE
              WHEN t.category_definition_id = ?
                AND t.price < 0
                AND lower(COALESCE(t.name, '')) LIKE '%דמי כרטיס%'
                AND (
                  lower(COALESCE(t.name, '')) LIKE '%פטור%'
                  OR lower(COALESCE(t.name, '')) LIKE '%הנחה%'
                )
                THEN t.price
              ELSE -t.price
            END
          ), 0) AS total
        FROM transactions t
        WHERE t.vendor = ?
          AND t.status = 'completed'
          AND substr(COALESCE(t.processed_date, t.date), 1, 10) >= ?
          AND substr(COALESCE(t.processed_date, t.date), 1, 10) <= ?
          {account_filter}
        GROUP BY substr(COALESCE(t.processed_date, t.date), 1, 10)
        """,
        tuple(params),
    )

    totals: dict[str, float] = {}
    for row in rows:
        totals[str(row["cycle_date"])] = max(0.0, float(row["total"] or 0))
    return totals


def repayment_name_match_strength(pairing: AccountPairing, name: str) -> int:
    """
    Returns:
      2 = strong (digit hint matches this card)
      1 = weak (vendor keyword match)
      0 = no match
    """
    name = name or ""
    hints = extract_digit_sequences(name)
    cc_account = pairing.credit_card_account_number
    cc_last4 = get_account_last4(cc_account)

    if cc_account and any(h == cc_account for h in hints):
        return 2
    if cc_last4 and any(h == cc_last4 for h in hints):
        return 2
    if name_contains_vendor(name, pairing.credit_card_vendor):
        return 1
    return 0


def calculate_discrepancies_app_for_bank_group(
    conn: sqlite3.Connection,
    *,
    pairings: list[AccountPairing],
    months_back: int,
    limit: int = 2000,
) -> dict[int, dict[str, Any]]:
    """
    App-like discrepancy, but allocates bank repayment txns across all pairings
    on the same bank account so we don't duplicate ambiguous repayments (e.g. "מקס ...")
    across multiple CC accounts.
    """
    if not pairings:
        return {}

    bank_vendor = pairings[0].bank_vendor
    bank_account_number = pairings[0].bank_account_number
    for pairing in pairings[1:]:
        if pairing.bank_vendor != bank_vendor or pairing.bank_account_number != bank_account_number:
            raise ValueError("All pairings in a bank group must share bank_vendor + bank_account_number")

    today = dt.datetime.now(dt.timezone.utc).date()
    today_str = today.isoformat()
    start_date = subtract_calendar_months(today, months_back)
    start_date_str = start_date.isoformat()

    EPSILON = 1.0
    MAX_FEE_AMOUNT = 200.0
    actionable_statuses = {"fee_candidate", "large_discrepancy", "cc_over_bank", "missing_cc_cycle"}
    EARLY_GRACE_DAYS = 14
    RECENT_GRACE_DAYS = 14

    predicate, pred_params = build_category_predicates()
    account_filter_sql = ""
    params: list[Any] = [bank_vendor, start_date_str, today_str]
    params.extend(pred_params)
    if bank_account_number:
        account_filter_sql = "AND t.account_number = ?"
        params.append(bank_account_number)

    repayment_rows = fetchall(
        conn,
        f"""
        SELECT
          t.identifier,
          t.vendor,
          t.account_number,
          t.date,
          substr(t.date, 1, 10) as repayment_date,
          t.name,
          t.price
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        WHERE t.vendor = ?
          AND substr(t.date, 1, 10) >= ?
          AND substr(t.date, 1, 10) <= ?
          AND t.status = 'completed'
          AND t.price < 0
          AND {predicate}
          {account_filter_sql}
        ORDER BY t.date DESC
        LIMIT {int(limit)}
        """,
        tuple(params),
    )

    repayments_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in repayment_rows:
        date_key = str(row["repayment_date"])
        repayments_by_date[date_key].append(
            {
                "identifier": str(row["identifier"]),
                "vendor": str(row["vendor"]),
                "accountNumber": (str(row["account_number"]) if row["account_number"] is not None else None),
                "date": str(row["date"]),
                "cycleDate": date_key,
                "name": str(row["name"] or ""),
                "price": float(row["price"] or 0),
            }
        )

    cc_totals_by_pairing_id: dict[int, dict[str, float]] = {}
    earliest_cc_date_by_pairing_id: dict[int, Optional[dt.date]] = {}
    cc_fees_category_id = get_cc_fees_category_id(conn)

    for pairing in pairings:
        cc_totals_by_pairing_id[pairing.id] = get_cc_totals_for_date_range(
            conn,
            cc_vendor=pairing.credit_card_vendor,
            cc_account_number=pairing.credit_card_account_number,
            start_date=start_date_str,
            end_date=today_str,
        )
        earliest_cc_date_by_pairing_id[pairing.id] = get_cc_earliest_cycle_date(
            conn,
            cc_vendor=pairing.credit_card_vendor,
            cc_account_number=pairing.credit_card_account_number,
            cc_fees_category_id=cc_fees_category_id,
        )

    cycles_by_pairing_id: dict[int, list[dict[str, Any]]] = {pairing.id: [] for pairing in pairings}

    for date_key, repayments in repayments_by_date.items():
        repayments_sorted = sorted(repayments, key=lambda r: abs(float(r.get("price") or 0)), reverse=True)
        assigned_total_by_id: dict[int, float] = {pairing.id: 0.0 for pairing in pairings}
        assigned_txns_by_id: dict[int, list[dict[str, Any]]] = {pairing.id: [] for pairing in pairings}
        unassigned: list[dict[str, Any]] = []

        for repayment in repayments_sorted:
            amount = abs(float(repayment.get("price") or 0))
            name = str(repayment.get("name") or "")

            digit_candidates: list[AccountPairing] = []
            vendor_candidates: list[AccountPairing] = []
            for pairing in pairings:
                strength = repayment_name_match_strength(pairing, name)
                if strength == 2:
                    digit_candidates.append(pairing)
                elif strength == 1:
                    vendor_candidates.append(pairing)

            candidates: list[AccountPairing]
            has_signal = True
            if digit_candidates:
                candidates = digit_candidates
            elif vendor_candidates:
                candidates = vendor_candidates
            else:
                candidates = pairings
                has_signal = False

            best_pairing: Optional[AccountPairing] = None
            best_new_diff: Optional[float] = None
            for candidate in candidates:
                cc_total = cc_totals_by_pairing_id.get(candidate.id, {}).get(date_key)
                if cc_total is None:
                    continue
                new_diff = abs((assigned_total_by_id[candidate.id] + amount) - cc_total)
                if best_new_diff is None or new_diff < best_new_diff:
                    best_new_diff = new_diff
                    best_pairing = candidate

            if best_pairing is None:
                if not has_signal:
                    unassigned.append(repayment)
                    continue
                best_pairing = candidates[0]
            else:
                if not has_signal and best_new_diff is not None and best_new_diff > EPSILON:
                    unassigned.append(repayment)
                    continue

            assigned_total_by_id[best_pairing.id] += amount
            assigned_txns_by_id[best_pairing.id].append(repayment)

        if unassigned and LOGGER.isEnabledFor(logging.DEBUG):
            LOGGER.debug(
                "Unassigned repayments on %s for bank=%s:%s: %s",
                date_key,
                bank_vendor,
                bank_account_number or "(no account_number)",
                ", ".join([f"{format_amount(abs(float(r.get('price') or 0)))}:{r.get('name')}" for r in unassigned][:6]),
            )

        for pairing in pairings:
            bank_total = assigned_total_by_id.get(pairing.id, 0.0)
            if bank_total <= 0:
                continue

            cc_total_raw = cc_totals_by_pairing_id.get(pairing.id, {}).get(date_key)
            matched_account = pairing.credit_card_account_number

            status = "missing_cc_cycle"
            cc_total: Optional[float] = None
            difference: Optional[float] = None

            if cc_total_raw is not None:
                cc_total = float(cc_total_raw)
                diff = bank_total - cc_total
                difference = diff
                if abs(diff) <= EPSILON:
                    status = "matched"
                elif diff > 0 and diff <= MAX_FEE_AMOUNT:
                    status = "fee_candidate"
                elif diff > MAX_FEE_AMOUNT:
                    status = "large_discrepancy"
                else:
                    status = "cc_over_bank"

            if status in actionable_statuses:
                try:
                    cycle_date = dt.date.fromisoformat(date_key)
                except ValueError:
                    cycle_date = None
                earliest = earliest_cc_date_by_pairing_id.get(pairing.id)
                if cycle_date is not None:
                    if earliest is not None and (cycle_date - earliest).days <= EARLY_GRACE_DAYS:
                        status = "incomplete_history"
                    elif 0 <= (today - cycle_date).days <= RECENT_GRACE_DAYS:
                        status = "incomplete_history"

            cycles_by_pairing_id[pairing.id].append(
                {
                    "cycleDate": date_key,
                    "bankTotal": round(bank_total, 2),
                    "ccTotal": None if cc_total is None else round(cc_total, 2),
                    "difference": None if difference is None else round(difference, 2),
                    "repayments": assigned_txns_by_id.get(pairing.id, []),
                    "status": status,
                    "matchedAccount": matched_account,
                }
            )

    discrepancies: dict[int, dict[str, Any]] = {}

    for pairing in pairings:
        cycles = cycles_by_pairing_id.get(pairing.id, [])
        cycles.sort(key=lambda c: c["cycleDate"], reverse=True)

        comparable = [c for c in cycles if c.get("ccTotal") is not None and c.get("status") != "incomplete_history"]
        total_bank = sum(float(c.get("bankTotal") or 0) for c in comparable)
        total_cc = sum(float(c.get("ccTotal") or 0) for c in comparable)
        total_diff = total_bank - total_cc

        has_discrepancy = any(str(c.get("status")) in actionable_statuses for c in cycles)

        acknowledged = bool(pairing.discrepancy_acknowledged)
        discrepancies[pairing.id] = {
            "exists": bool(has_discrepancy and not acknowledged),
            "acknowledged": acknowledged,
            "totalBankRepayments": round(total_bank, 2),
            "totalCCExpenses": round(total_cc, 2),
            "difference": round(total_diff, 2),
            "differencePercentage": round((total_diff / total_cc) * 100, 2) if total_cc > 0 else 0,
            "periodMonths": months_back,
            "matchedCycleCount": sum(1 for c in cycles if c.get("status") == "matched"),
            "totalCycles": len(cycles),
            "cycles": cycles,
            "method": "allocated",
        }

    return discrepancies


def print_discrepancy_summary(
    pairing_label: str,
    discrepancy: dict[str, Any],
    *,
    verbose: bool,
) -> None:
    cycles = discrepancy.get("cycles") or []
    LOGGER.info("")
    LOGGER.info("== %s ==", pairing_label)
    if discrepancy.get("reason"):
        LOGGER.info("Reason: %s", discrepancy["reason"])
    LOGGER.info(
        "exists=%s acknowledged=%s cycles=%s matched=%s bank=%s cc=%s diff=%s (%s%%)",
        discrepancy.get("exists"),
        discrepancy.get("acknowledged"),
        discrepancy.get("totalCycles"),
        discrepancy.get("matchedCycleCount"),
        format_amount(discrepancy.get("totalBankRepayments")),
        format_amount(discrepancy.get("totalCCExpenses")),
        format_amount(discrepancy.get("difference")),
        discrepancy.get("differencePercentage"),
    )

    for cycle in cycles:
        status = str(cycle.get("status") or "")
        if not verbose and status in {"matched", "incomplete_history"}:
            continue
        LOGGER.info(
            "  %s  status=%s  bank=%s  cc=%s  diff=%s",
            cycle.get("cycleDate"),
            status,
            format_amount(cycle.get("bankTotal")),
            format_amount(cycle.get("ccTotal")),
            format_amount(cycle.get("difference")),
        )
        if verbose:
            for r in cycle.get("repayments") or []:
                LOGGER.debug("    - %s | %s | %s", r.get("identifier"), format_amount(abs(float(r.get("price") or 0))), r.get("name"))


def parse_vendor_account(value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not value:
        return None, None
    if ":" not in value:
        return value, None
    vendor, account = value.split(":", 1)
    return vendor.strip() or None, account.strip() or None


def get_cc_accounts(conn: sqlite3.Connection, cc_vendors: set[str]) -> dict[str, set[str]]:
    """
    Returns: {ccVendor: {account_number, ...}}
    """
    accounts: dict[str, set[str]] = defaultdict(set)
    for vendor in sorted(cc_vendors):
        rows = fetchall(
            conn,
            "SELECT DISTINCT account_number FROM transactions WHERE vendor=? AND account_number IS NOT NULL",
            (vendor,),
        )
        for row in rows:
            accounts[vendor].add(str(row["account_number"]).strip())
    return dict(accounts)

def build_last4_index(cc_accounts_by_vendor: dict[str, set[str]]) -> dict[str, list[tuple[str, str]]]:
    """
    Maps last-4 digits → [(vendor, account_number), ...]
    """
    index: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for vendor, accounts in cc_accounts_by_vendor.items():
        for account in accounts:
            last4 = account[-4:] if len(account) > 4 else account
            if last4 and last4.isdigit():
                index[last4].append((vendor, account))
    return dict(index)


def get_cc_cycle_totals(
    conn: sqlite3.Connection,
    *,
    vendor: str,
    account_number: Optional[str],
    start_date: str,
) -> dict[str, float]:
    params: list[Any] = [vendor, start_date]
    account_filter = ""
    if account_number:
        params.append(account_number)
        account_filter = "AND t.account_number = ?"

    rows = fetchall(
        conn,
        f"""
        SELECT
          date(COALESCE(t.processed_date, t.date)) as cycle_date,
          COALESCE(SUM(ABS(t.price)), 0) as total
        FROM transactions t
        WHERE t.vendor = ?
          AND t.price < 0
          AND date(COALESCE(t.processed_date, t.date)) >= ?
          {account_filter}
        GROUP BY date(COALESCE(t.processed_date, t.date))
        """,
        tuple(params),
    )

    totals: dict[str, float] = {}
    for row in rows:
        totals[str(row["cycle_date"])] = float(row["total"] or 0)
    return totals


def get_cc_cycle_txns(
    conn: sqlite3.Connection,
    *,
    vendor: str,
    account_number: Optional[str],
    cycle_date: str,
    start_date: str,
    limit: int = 8,
) -> list[sqlite3.Row]:
    """
    Fetch CC transactions billed on a specific cycle date:
      date(COALESCE(processed_date, date)) == cycle_date
    """
    params: list[Any] = [vendor, start_date, cycle_date]
    account_filter = ""
    if account_number:
        params.append(account_number)
        account_filter = "AND t.account_number = ?"

    return fetchall(
        conn,
        f"""
        SELECT
          t.identifier,
          t.date,
          t.processed_date,
          t.name,
          t.price,
          t.type
        FROM transactions t
        WHERE t.vendor = ?
          AND t.price < 0
          AND date(COALESCE(t.processed_date, t.date)) >= ?
          AND date(COALESCE(t.processed_date, t.date)) = ?
          {account_filter}
        ORDER BY ABS(t.price) DESC
        LIMIT {int(limit)}
        """,
        tuple(params),
    )


def get_cc_history_bounds(
    conn: sqlite3.Connection,
    *,
    vendor: str,
    account_number: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    params: list[Any] = [vendor]
    account_filter = ""
    if account_number:
        params.append(account_number)
        account_filter = "AND account_number = ?"

    row = fetchone(
        conn,
        f"""
        SELECT
          MIN(date) AS min_date,
          MIN(processed_date) AS min_processed_date
        FROM transactions
        WHERE vendor = ?
          AND price < 0
          {account_filter}
        """,
        tuple(params),
    )
    if not row:
        return None, None
    return (
        str(row["min_date"]) if row["min_date"] else None,
        str(row["min_processed_date"]) if row["min_processed_date"] else None,
    )


def nearest_cycle_dates(cycle_totals: dict[str, float], target_cycle_date: str, limit: int = 5) -> list[tuple[str, float, int]]:
    """
    Returns (cycle_date, total, abs_day_diff) sorted by abs_day_diff, then by date.
    """
    try:
        target = dt.date.fromisoformat(target_cycle_date)
    except ValueError:
        return []

    scored: list[tuple[str, float, int]] = []
    for cycle_date, total in cycle_totals.items():
        try:
            cycle_dt = dt.date.fromisoformat(cycle_date)
        except ValueError:
            continue
        scored.append((cycle_date, total, abs((cycle_dt - target).days)))

    scored.sort(key=lambda item: (item[2], item[0]))
    return scored[:limit]


def get_bank_repayment_txns(
    conn: sqlite3.Connection,
    *,
    bank_vendors: set[str],
    start_date: str,
    filter_bank_vendor: Optional[str],
    filter_bank_account: Optional[str],
) -> list[RepaymentTxn]:
    predicate, pred_params = build_category_predicates()

    vendor_filter = ""
    params: list[Any] = []
    if bank_vendors:
        placeholders = ",".join("?" for _ in bank_vendors)
        vendor_filter = f"AND t.vendor IN ({placeholders})"
        params.extend(sorted(bank_vendors))

    if filter_bank_vendor:
        vendor_filter += " AND t.vendor = ?"
        params.append(filter_bank_vendor)

    account_filter = ""
    if filter_bank_account:
        account_filter = "AND t.account_number = ?"
        params.append(filter_bank_account)

    params.extend([start_date])
    params.extend(pred_params)

    sql = f"""
      SELECT
        t.identifier,
        t.vendor as bank_vendor,
        t.account_number as bank_account_number,
        t.date as iso_datetime,
        date(t.date) as cycle_date,
        t.name,
        t.price
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.price < 0
        {vendor_filter}
        {account_filter}
        AND date(t.date) >= ?
        AND {predicate}
      ORDER BY t.date DESC
    """

    rows = fetchall(conn, sql, tuple(params))
    txns: list[RepaymentTxn] = []
    for row in rows:
        name = str(row["name"] or "")
        detected_vendor = detect_cc_vendor_from_name(name)
        last4 = extract_last4(name)
        txns.append(
            RepaymentTxn(
                identifier=str(row["identifier"]),
                bank_vendor=str(row["bank_vendor"]),
                bank_account_number=(str(row["bank_account_number"]) if row["bank_account_number"] is not None else None),
                iso_datetime=str(row["iso_datetime"]),
                cycle_date=str(row["cycle_date"]),
                name=name,
                price=float(row["price"] or 0),
                detected_cc_vendor=detected_vendor,
                detected_last4=last4,
            )
        )
    return txns


def compute_fee_stats(differences: list[float]) -> dict[str, Any]:
    diffs = [d for d in differences if d is not None and not math.isnan(d)]
    if not diffs:
        return {"count": 0}

    median = statistics.median(diffs)
    mad = statistics.median([abs(d - median) for d in diffs]) if len(diffs) >= 2 else 0
    stdev = statistics.pstdev(diffs) if len(diffs) >= 2 else 0
    return {
        "count": len(diffs),
        "median": round(median, 2),
        "mad": round(mad, 2),
        "stdev": round(stdev, 2),
        "min": round(min(diffs), 2),
        "max": round(max(diffs), 2),
    }


def format_amount(value: Optional[float]) -> str:
    if value is None:
        return "—"
    return f"{value:,.2f}"


def choose_best_cc_account_for_group(
    conn: sqlite3.Connection,
    *,
    cc_vendor: str,
    candidate_accounts: list[Optional[str]],
    bank_cycles: dict[str, float],
    start_date: str,
) -> tuple[Optional[str], dict[str, Any]]:
    best: tuple[Optional[str], dict[str, Any]] = (None, {})
    best_key: tuple[int, float, float] | None = None

    for account in candidate_accounts:
        cc_cycles = get_cc_cycle_totals(conn, vendor=cc_vendor, account_number=account, start_date=start_date)
        overlap_dates = sorted(set(bank_cycles.keys()) & set(cc_cycles.keys()))
        if not overlap_dates:
            continue

        abs_errors = [abs(bank_cycles[d] - cc_cycles[d]) for d in overlap_dates]
        sum_abs_error = sum(abs_errors)
        sum_cc = sum(cc_cycles[d] for d in overlap_dates)
        mean_abs_error = sum_abs_error / max(len(overlap_dates), 1)
        rel_error = sum_abs_error / max(sum_cc, 1.0)

        key = (len(overlap_dates), -rel_error, -mean_abs_error)
        if best_key is None or key > best_key:
            best_key = key
            best = (
                account,
                {
                    "overlapCycles": len(overlap_dates),
                    "meanAbsError": round(mean_abs_error, 2),
                    "relAbsError": round(rel_error * 100, 2),
                    "sumAbsError": round(sum_abs_error, 2),
                    "sumBankMatched": round(sum(bank_cycles[d] for d in overlap_dates), 2),
                    "sumCCMatched": round(sum(cc_cycles[d] for d in overlap_dates), 2),
                },
            )

    return best


def run_app_mode(conn: sqlite3.Connection, args: argparse.Namespace) -> int:
    results: list[dict[str, Any]] = []

    if args.pairing_id is not None:
        pairing = load_pairing_by_id(conn, int(args.pairing_id))
        if not pairing:
            LOGGER.error("Pairing id=%s not found (or account_pairings table missing).", args.pairing_id)
            return 2

        all_pairings = list_pairings(conn, include_inactive=True)
        group_pairings = [
            p
            for p in all_pairings
            if p.bank_vendor == pairing.bank_vendor
            and p.bank_account_number == pairing.bank_account_number
            and (p.is_active or p.id == pairing.id)
        ]
        if pairing.id not in {p.id for p in group_pairings}:
            group_pairings.append(pairing)

        group_discrepancies = calculate_discrepancies_app_for_bank_group(
            conn,
            pairings=group_pairings,
            months_back=args.months,
        )
        discrepancy = group_discrepancies.get(pairing.id) or calculate_discrepancy_app(
            conn,
            pairing_id=pairing.id,
            bank_vendor=pairing.bank_vendor,
            bank_account_number=pairing.bank_account_number,
            cc_vendor=pairing.credit_card_vendor,
            cc_account_number=pairing.credit_card_account_number,
            months_back=args.months,
        )

        label = (
            f"pairing #{pairing.id} "
            f"{pairing.bank_vendor}:{pairing.bank_account_number or '(no account_number)'} "
            f"↔ {pairing.credit_card_vendor}:{pairing.credit_card_account_number or '(no account_number)'}"
        )

        if args.json:
            results.append(
                {
                    "pairing": {
                        "id": pairing.id,
                        "creditCardVendor": pairing.credit_card_vendor,
                        "creditCardAccountNumber": pairing.credit_card_account_number,
                        "bankVendor": pairing.bank_vendor,
                        "bankAccountNumber": pairing.bank_account_number,
                        "matchPatterns": pairing.match_patterns,
                        "isActive": pairing.is_active,
                        "discrepancyAcknowledged": pairing.discrepancy_acknowledged,
                    },
                    "discrepancy": discrepancy,
                }
            )
        else:
            print_discrepancy_summary(label, discrepancy, verbose=args.verbose)

    else:
        cc_vendor, cc_account = parse_vendor_account(args.cc)
        bank_vendor, bank_account = parse_vendor_account(args.bank)

        if cc_vendor:
            suggestion: Optional[dict[str, Any]] = None
            if not bank_vendor:
                suggestion = find_best_bank_account_app(
                    conn,
                    credit_card_vendor=cc_vendor,
                    credit_card_account_number=cc_account,
                    bank_vendor_filter=None,
                    bank_account_filter=None,
                )
                if not suggestion.get("found"):
                    LOGGER.error("%s", suggestion.get("reason") or "Failed to find bank account")
                    return 1
                bank_vendor = suggestion["bankVendor"]
                bank_account = suggestion["bankAccountNumber"]

            existing_pairings = list_pairings(conn, include_inactive=True)
            matching_pairing = next(
                (
                    p
                    for p in existing_pairings
                    if p.bank_vendor == bank_vendor
                    and p.bank_account_number == bank_account
                    and p.credit_card_vendor == cc_vendor
                    and p.credit_card_account_number == cc_account
                ),
                None,
            )

            if matching_pairing:
                group_pairings = [
                    p
                    for p in existing_pairings
                    if p.bank_vendor == bank_vendor
                    and p.bank_account_number == bank_account
                    and p.is_active
                ]
                if matching_pairing.id not in {p.id for p in group_pairings}:
                    group_pairings.append(matching_pairing)

                group_discrepancies = calculate_discrepancies_app_for_bank_group(
                    conn,
                    pairings=group_pairings,
                    months_back=args.months,
                )
                discrepancy = group_discrepancies.get(matching_pairing.id) or calculate_discrepancy_app(
                    conn,
                    pairing_id=matching_pairing.id,
                    bank_vendor=bank_vendor,
                    bank_account_number=bank_account,
                    cc_vendor=cc_vendor,
                    cc_account_number=cc_account,
                    months_back=args.months,
                )
            else:
                discrepancy = calculate_discrepancy_app(
                    conn,
                    pairing_id=None,
                    bank_vendor=bank_vendor,
                    bank_account_number=bank_account,
                    cc_vendor=cc_vendor,
                    cc_account_number=cc_account,
                    months_back=args.months,
                )

            label = f"{bank_vendor}:{bank_account or '(no account_number)'} ↔ {cc_vendor}:{cc_account or '(no account_number)'}"

            if args.json:
                results.append(
                    {
                        "pairing": {
                            "id": None if not matching_pairing else matching_pairing.id,
                            "creditCardVendor": cc_vendor,
                            "creditCardAccountNumber": cc_account,
                            "bankVendor": bank_vendor,
                            "bankAccountNumber": bank_account,
                            "matchPatterns": (suggestion or {}).get("matchPatterns") or build_match_patterns(cc_vendor, cc_account),
                            "isActive": None,
                            "discrepancyAcknowledged": None if not matching_pairing else matching_pairing.discrepancy_acknowledged,
                        },
                        "discrepancy": discrepancy,
                        "bankSuggestion": suggestion,
                    }
                )
            else:
                if suggestion:
                    LOGGER.info(
                        "Best bank account match: %s:%s (last4Matches=%s vendorMatches=%s)",
                        suggestion.get("bankVendor"),
                        suggestion.get("bankAccountNumber"),
                        suggestion.get("matchingLast4Count"),
                        suggestion.get("matchingVendorCount"),
                    )
                    LOGGER.info("Match patterns (for pairing): %s", ", ".join(suggestion.get("matchPatterns") or []))
                print_discrepancy_summary(label, discrepancy, verbose=args.verbose)
        else:
            pairings = list_pairings(conn, include_inactive=bool(args.include_inactive))
            if not pairings:
                LOGGER.warning("No account_pairings found in DB. Create a pairing in the app or run with --cc / --pairing-id.")

            pairings_by_bank: dict[tuple[str, Optional[str]], list[AccountPairing]] = defaultdict(list)
            for pairing in pairings:
                pairings_by_bank[(pairing.bank_vendor, pairing.bank_account_number)].append(pairing)

            discrepancies_by_id: dict[int, dict[str, Any]] = {}
            for group in pairings_by_bank.values():
                discrepancies_by_id.update(
                    calculate_discrepancies_app_for_bank_group(
                        conn,
                        pairings=group,
                        months_back=args.months,
                    )
                )

            for pairing in pairings:
                discrepancy = discrepancies_by_id.get(pairing.id) or calculate_discrepancy_app(
                    conn,
                    pairing_id=pairing.id,
                    bank_vendor=pairing.bank_vendor,
                    bank_account_number=pairing.bank_account_number,
                    cc_vendor=pairing.credit_card_vendor,
                    cc_account_number=pairing.credit_card_account_number,
                    months_back=args.months,
                )

                label = (
                    f"pairing #{pairing.id} "
                    f"{pairing.bank_vendor}:{pairing.bank_account_number or '(no account_number)'} "
                    f"↔ {pairing.credit_card_vendor}:{pairing.credit_card_account_number or '(no account_number)'}"
                    f"{'' if pairing.is_active else ' (inactive)'}"
                )

                if args.json:
                    results.append(
                        {
                            "pairing": {
                                "id": pairing.id,
                                "creditCardVendor": pairing.credit_card_vendor,
                                "creditCardAccountNumber": pairing.credit_card_account_number,
                                "bankVendor": pairing.bank_vendor,
                                "bankAccountNumber": pairing.bank_account_number,
                                "matchPatterns": pairing.match_patterns,
                                "isActive": pairing.is_active,
                                "discrepancyAcknowledged": pairing.discrepancy_acknowledged,
                            },
                            "discrepancy": discrepancy,
                        }
                    )
                else:
                    print_discrepancy_summary(label, discrepancy, verbose=args.verbose)

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))

    return 0


def main() -> int:
    args = parse_args()
    configure_logging(args.verbose)

    conn = db_connect(args.db)
    try:
        if args.mode == "app":
            return run_app_mode(conn, args)

        cc_filter_vendor, cc_filter_account = parse_vendor_account(args.cc)
        bank_filter_vendor, bank_filter_account = parse_vendor_account(args.bank)

        start_date, _ = get_db_time_window(conn, args.months)

        log_section("Load Credentials / Vendors")
        credentials = load_vendor_credentials(conn)
        LOGGER.info("vendor_credentials: %s", len(credentials))

        bank_vendors: set[str] = set()
        cc_vendors: set[str] = set()
        creds_by_vendor: dict[str, list[VendorCredential]] = defaultdict(list)
        for cred in credentials:
            creds_by_vendor[cred.vendor].append(cred)
            if cred.institution_type == "bank":
                bank_vendors.add(cred.vendor)
            if cred.institution_type == "credit_card":
                cc_vendors.add(cred.vendor)

        # Fallback: if no credentials, infer from known CC vendors
        if not cc_vendors:
            cc_vendors = set(VENDOR_KEYWORDS.keys())
        if not bank_vendors:
            # fallback: any vendor that has repayment category txns will show up later
            bank_vendors = set()

        LOGGER.info("Detected bank vendors: %s", ", ".join(sorted(bank_vendors)) if bank_vendors else "(none from credentials)")
        LOGGER.info("Detected CC vendors: %s", ", ".join(sorted(cc_vendors)))

        log_section("Repayment Category Lookup (by name)")
        predicate, pred_params = build_category_predicates()
        sample = fetchall(
            conn,
            f"""
            SELECT id, name, name_en
            FROM category_definitions cd
            WHERE {predicate}
            ORDER BY id
            """,
            tuple(pred_params),
        )
        if not sample:
            LOGGER.warning("No repayment categories matched by name. Check category_definitions content.")
        else:
            for row in sample:
                LOGGER.info("Repayment category match: id=%s name=%s / %s", row["id"], row["name"], row["name_en"])

        log_section("Discover CC Accounts (vendor + account_number)")
        cc_accounts_by_vendor = get_cc_accounts(conn, cc_vendors)
        last4_index = build_last4_index(cc_accounts_by_vendor)
        for vendor, accounts in sorted(cc_accounts_by_vendor.items()):
            if cc_filter_vendor and vendor != cc_filter_vendor:
                continue
            LOGGER.info("CC %s accounts: %s", vendor, ", ".join(sorted(accounts)) if accounts else "(none)")

        if cc_filter_vendor and cc_filter_vendor not in cc_accounts_by_vendor:
            LOGGER.warning("CC vendor filter %s not found in transactions.", cc_filter_vendor)

        log_section("Scan Bank Repayments (transactions in repayment category)")
        repayment_txns = get_bank_repayment_txns(
            conn,
            bank_vendors=bank_vendors,
            start_date=start_date,
            filter_bank_vendor=bank_filter_vendor,
            filter_bank_account=bank_filter_account,
        )
        LOGGER.info("Repayment txns found: %s", len(repayment_txns))

        # Group repayment txns into candidates: (bank_vendor, bank_account, detected_cc_vendor, last4)
        #
        # Important: repayment descriptions are inconsistent.
        # - Sometimes they contain vendor keywords ("כ.א.ל").
        # - Sometimes they only contain last-4 digits ("... ויזה 4886") without the CC vendor name.
        #
        # So we prefer grouping by last-4 when present (strongest signal), otherwise by detected vendor.
        groups: dict[tuple[str, Optional[str], str], list[RepaymentTxn]] = defaultdict(list)
        group_meta: dict[tuple[str, Optional[str], str], dict[str, Any]] = {}
        for txn in repayment_txns:
            if txn.detected_last4:
                group_key = (txn.bank_vendor, txn.bank_account_number, f"last4:{txn.detected_last4}")
                group_meta[group_key] = {"type": "last4", "value": txn.detected_last4}
            else:
                value = txn.detected_cc_vendor or "unknown"
                group_key = (txn.bank_vendor, txn.bank_account_number, f"vendor:{value}")
                group_meta[group_key] = {"type": "vendor", "value": value}
            groups[group_key].append(txn)

        LOGGER.info("Grouped repayment candidates: %s", len(groups))

        log_section("Repayment-First Pairing Candidates")
        # Sort groups by tx count desc
        sorted_groups = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)

        printed = 0
        for (bank_vendor, bank_account, group_id), txns in sorted_groups:
            meta = group_meta.get((bank_vendor, bank_account, group_id), {})
            group_type = meta.get("type")
            group_value = meta.get("value")

            # Build bank cycles (sum per repayment date)
            bank_cycles: dict[str, float] = defaultdict(float)
            for txn in txns:
                bank_cycles[txn.cycle_date] += abs(txn.price)

            bank_cycle_count = len(bank_cycles)
            total_bank = sum(bank_cycles.values())

            LOGGER.info("")
            evidence = f"{group_type}={group_value}"
            LOGGER.info(
                "[BANK %s %s] repayment txns=%s cycles=%s total=%s | evidence: %s",
                bank_vendor,
                bank_account or "(no account_number)",
                len(txns),
                bank_cycle_count,
                format_amount(total_bank),
                evidence,
            )

            # Candidate CC accounts (vendor+account)
            candidate_cc_accounts: list[tuple[str, Optional[str]]] = []

            if group_type == "last4" and isinstance(group_value, str):
                for vendor, account in last4_index.get(group_value, []):
                    candidate_cc_accounts.append((vendor, account))
            elif group_type == "vendor" and isinstance(group_value, str) and group_value != "unknown":
                for account in sorted(cc_accounts_by_vendor.get(group_value, set())):
                    candidate_cc_accounts.append((group_value, account))
            else:
                # Unknown repayment naming: consider all CC accounts (low confidence).
                for vendor, accounts in sorted(cc_accounts_by_vendor.items()):
                    for account in sorted(accounts):
                        candidate_cc_accounts.append((vendor, account))

            # Apply user filters
            if cc_filter_vendor:
                candidate_cc_accounts = [(v, a) for (v, a) in candidate_cc_accounts if v == cc_filter_vendor]
            if cc_filter_account:
                candidate_cc_accounts = [(v, a) for (v, a) in candidate_cc_accounts if a == cc_filter_account]

            if not candidate_cc_accounts:
                LOGGER.warning("  No candidate CC accounts for this group (after filters).")
                continue

            # Evaluate candidates; pick best by overlap/error
            best_vendor: Optional[str] = None
            best_account: Optional[str] = None
            best_metrics: dict[str, Any] = {}
            best_key: tuple[int, float, float] | None = None

            # De-duplicate (vendor, account) pairs
            seen_pairs: set[tuple[str, Optional[str]]] = set()
            unique_candidates: list[tuple[str, Optional[str]]] = []
            for pair in candidate_cc_accounts:
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                unique_candidates.append(pair)

            for vendor, account in unique_candidates:
                cc_cycles = get_cc_cycle_totals(conn, vendor=vendor, account_number=account, start_date=start_date)
                overlap_dates = sorted(set(bank_cycles.keys()) & set(cc_cycles.keys()))
                if not overlap_dates:
                    continue

                abs_errors = [abs(bank_cycles[d] - cc_cycles[d]) for d in overlap_dates]
                sum_abs_error = sum(abs_errors)
                sum_cc = sum(cc_cycles[d] for d in overlap_dates)
                mean_abs_error = sum_abs_error / max(len(overlap_dates), 1)
                rel_error = sum_abs_error / max(sum_cc, 1.0)

                key = (len(overlap_dates), -rel_error, -mean_abs_error)
                if best_key is None or key > best_key:
                    best_key = key
                    best_vendor = vendor
                    best_account = account
                    best_metrics = {
                        "overlapCycles": len(overlap_dates),
                        "meanAbsError": round(mean_abs_error, 2),
                        "relAbsError": round(rel_error * 100, 2),
                        "sumAbsError": round(sum_abs_error, 2),
                        "sumBankMatched": round(sum(bank_cycles[d] for d in overlap_dates), 2),
                        "sumCCMatched": round(sum(cc_cycles[d] for d in overlap_dates), 2),
                    }

            if not best_vendor or not best_account:
                LOGGER.warning("  No overlapping cycles found with any candidate CC account.")
                continue

            LOGGER.info("  Best CC match: %s:%s metrics=%s", best_vendor, best_account, json.dumps(best_metrics))

            if args.verbose:
                min_date, min_processed = get_cc_history_bounds(conn, vendor=best_vendor, account_number=best_account)
                if min_date or min_processed:
                    LOGGER.debug("  CC history bounds: min(date)=%s min(processed_date)=%s", min_date, min_processed)

            # Print cycle table (top few)
            cc_cycles = get_cc_cycle_totals(conn, vendor=best_vendor, account_number=best_account, start_date=start_date)
            overlap_dates = sorted(set(bank_cycles.keys()) & set(cc_cycles.keys()), reverse=True)
            missing_cc = sorted(set(bank_cycles.keys()) - set(cc_cycles.keys()), reverse=True)

            diffs: list[float] = []
            LOGGER.info("  Cycles (bank repayment date ↔ cc processed_date):")
            for cycle_date in overlap_dates[: min(16, len(overlap_dates))]:
                bank_total = bank_cycles[cycle_date]
                cc_total = cc_cycles[cycle_date]
                diff = bank_total - cc_total
                diffs.append(diff)
                LOGGER.info(
                    "    %s  bank=%s  cc=%s  diff=%s",
                    cycle_date,
                    format_amount(bank_total),
                    format_amount(cc_total),
                    format_amount(diff),
                )

                if args.verbose:
                    # Print the underlying repayment txns for this cycle
                    cycle_txns = [t for t in txns if t.cycle_date == cycle_date]
                    for t in cycle_txns[:10]:
                        LOGGER.debug("      - %s | %s", t.identifier, t.name)
                    if len(cycle_txns) > 10:
                        LOGGER.debug("      ... +%s more repayment txns", len(cycle_txns) - 10)

                    if abs(diff) > 0.01:
                        closest = nearest_cycle_dates(cc_cycles, cycle_date, limit=4)
                        if closest:
                            closest_label = ", ".join(
                                [f"{d}={format_amount(total)} (±{days}d)" for (d, total, days) in closest]
                            )
                            LOGGER.debug("      Closest CC billed dates: %s", closest_label)

                        cc_txns = get_cc_cycle_txns(
                            conn,
                            vendor=best_vendor,
                            account_number=best_account,
                            cycle_date=cycle_date,
                            start_date=start_date,
                            limit=8,
                        )
                        if not cc_txns:
                            LOGGER.debug("      CC txns in cycle: (none)")
                        else:
                            LOGGER.debug("      CC txns in cycle: %s", len(cc_txns))
                            for row in cc_txns:
                                amount = abs(float(row["price"] or 0))
                                purchase_date = str(row["date"] or "")[:10]
                                billed_date = str(row["processed_date"] or row["date"] or "")[:10]
                                LOGGER.debug(
                                    "        - %s | %s | purchase=%s billed=%s | %s",
                                    str(row["identifier"]),
                                    format_amount(amount),
                                    purchase_date,
                                    billed_date,
                                    str(row["name"] or ""),
                                )

            if missing_cc:
                LOGGER.info("  Cycles with bank repayment but missing CC cycle: %s", ", ".join(missing_cc[:10]))
                if args.verbose:
                    closest = nearest_cycle_dates(cc_cycles, missing_cc[0], limit=4)
                    if closest:
                        closest_label = ", ".join(
                            [f"{d}={format_amount(total)} (±{days}d)" for (d, total, days) in closest]
                        )
                        LOGGER.debug("  Closest CC billed dates (for first missing): %s", closest_label)

            fee_stats = compute_fee_stats([d for d in diffs if d > 0.01])
            if fee_stats.get("count", 0) > 0:
                LOGGER.info("  Positive diffs (fee/interest candidate) stats: %s", json.dumps(fee_stats))

            printed += 1
            if printed >= args.top and not args.verbose:
                break

        log_section("CC-First: Find Best Bank Account By Cycle Similarity")
        for cc_vendor, accounts in sorted(cc_accounts_by_vendor.items()):
            if cc_filter_vendor and cc_vendor != cc_filter_vendor:
                continue
            for cc_account in sorted(accounts):
                if cc_filter_account and cc_account != cc_filter_account:
                    continue

                cc_cycles = get_cc_cycle_totals(conn, vendor=cc_vendor, account_number=cc_account, start_date=start_date)
                if not cc_cycles:
                    continue

                LOGGER.info("")
                LOGGER.info("[CC %s:%s] cycles=%s total=%s", cc_vendor, cc_account, len(cc_cycles), format_amount(sum(cc_cycles.values())))

                # Compare to every bank account we saw in repayments
                candidates: list[dict[str, Any]] = []
                cc_last4 = cc_account[-4:] if len(cc_account) > 4 else cc_account
                for (bank_vendor, bank_account, group_id), txns in groups.items():
                    if bank_filter_vendor and bank_vendor != bank_filter_vendor:
                        continue
                    if bank_filter_account and bank_account != bank_filter_account:
                        continue
                    meta = group_meta.get((bank_vendor, bank_account, group_id), {})
                    group_type = meta.get("type")
                    group_value = meta.get("value")

                    # Prefer high-signal comparisons:
                    # - last4 groups must match this CC account last4
                    # - vendor groups must match this CC vendor (ignore "unknown" by default)
                    if group_type == "last4" and group_value != cc_last4:
                        continue
                    if group_type == "vendor":
                        if group_value == "unknown":
                            continue
                        if group_value != cc_vendor:
                            continue

                    bank_cycles: dict[str, float] = defaultdict(float)
                    for txn in txns:
                        bank_cycles[txn.cycle_date] += abs(txn.price)

                    overlap = sorted(set(bank_cycles.keys()) & set(cc_cycles.keys()))
                    if not overlap:
                        continue

                    abs_errors = [abs(bank_cycles[d] - cc_cycles[d]) for d in overlap]
                    sum_abs_error = sum(abs_errors)
                    sum_cc = sum(cc_cycles[d] for d in overlap)
                    rel_error = sum_abs_error / max(sum_cc, 1.0)

                    candidates.append(
                        {
                            "bankVendor": bank_vendor,
                            "bankAccount": bank_account,
                            "repaymentEvidence": group_id,
                            "overlapCycles": len(overlap),
                            "meanAbsError": round(sum_abs_error / max(len(overlap), 1), 2),
                            "relAbsErrorPct": round(rel_error * 100, 2),
                        }
                    )

                candidates.sort(key=lambda c: (c["overlapCycles"], -c["relAbsErrorPct"], -c["meanAbsError"]), reverse=True)
                for c in candidates[: args.top]:
                    LOGGER.info(
                        "  Candidate bank=%s:%s overlap=%s meanAbs=%s relAbs=%s%% evidence=%s",
                        c["bankVendor"],
                        c["bankAccount"] or "(no account_number)",
                        c["overlapCycles"],
                        c["meanAbsError"],
                        c["relAbsErrorPct"],
                        c["repaymentEvidence"],
                    )

    finally:
        conn.close()

    LOGGER.info("")
    LOGGER.info("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
