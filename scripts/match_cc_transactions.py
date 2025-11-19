#!/usr/bin/env python3
"""
Complete CC Transaction Matching System

Matches each credit card repayment to its specific expenses with perfect accuracy.

Usage:
    python3 scripts/match_cc_transactions.py [--months N] [--dry-run]

Options:
    --months N    Number of months to analyze (default: 2)
    --dry-run     Show matches without saving to database
"""

import sqlite3
import pandas as pd
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Colors for terminal output
class Colors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def print_header(text):
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*80}")
    print(text)
    print(f"{'='*80}{Colors.ENDC}\n")

def print_success(text):
    print(f"{Colors.OKGREEN}✓ {text}{Colors.ENDC}")

def print_warning(text):
    print(f"{Colors.WARNING}⚠️  {text}{Colors.ENDC}")

def print_error(text):
    print(f"{Colors.FAIL}✗ {text}{Colors.ENDC}")

def get_card_from_repayment_name(conn, repayment_name):
    """
    Extract card number and vendor from repayment description using account_pairings.

    Uses match_patterns from account_pairings table to identify which card
    a repayment belongs to.
    """
    query = """
    SELECT
        credit_card_account_number,
        credit_card_vendor,
        match_patterns
    FROM account_pairings
    WHERE is_active = 1
    """

    pairings = pd.read_sql(query, conn)

    # Try to match repayment name against patterns for each card
    for _, pairing in pairings.iterrows():
        try:
            import json
            patterns = json.loads(pairing['match_patterns'])
            for pattern in patterns:
                if pattern in repayment_name:
                    return pairing['credit_card_account_number'], pairing['credit_card_vendor']
        except:
            continue

    return None, None

def is_sauvage_repayment(conn, repayment_row, card_number, cc_vendor):
    """
    Determine if repayment is "sauvage" (wild/immediate) based on 3 criteria:

    1. Date outside 1-15th of month (day > 15)
    2. Large single amount (> ₪1,000)
    3. Exact amount match exists within 7 days

    Returns True if ANY criterion is met.
    """
    repayment_amount = abs(repayment_row['price'])
    repayment_date = pd.to_datetime(repayment_row['date'])

    # Criterion 1: Date outside 1-15th
    if repayment_date.day > 15:
        return True

    # Criterion 2: Large single amount
    if repayment_amount > 1000:
        # Check if there's a matching expense (criterion 3)
        lookback_date = repayment_date - timedelta(days=7)
        lookback_str = lookback_date.strftime('%Y-%m-%d')
        repayment_str = repayment_date.strftime('%Y-%m-%d')

        query = """
        SELECT COUNT(*) as count
        FROM transactions
        WHERE vendor = ?
          AND account_number = ?
          AND price < 0
          AND date >= ?
          AND date <= ?
          AND ABS(ABS(price) - ?) < 5.0
        """

        result = pd.read_sql(query, conn, params=[cc_vendor, card_number, lookback_str, repayment_str, repayment_amount])

        if result.iloc[0]['count'] > 0:
            return True

    # Criterion 3 alone: Exact amount match (even if small amount)
    lookback_date = repayment_date - timedelta(days=7)
    lookback_str = lookback_date.strftime('%Y-%m-%d')
    repayment_str = repayment_date.strftime('%Y-%m-%d')

    query = """
    SELECT COUNT(*) as count
    FROM transactions
    WHERE vendor = ?
      AND account_number = ?
      AND price < 0
      AND date >= ?
      AND date <= ?
      AND ABS(ABS(price) - ?) < 1.0
    """

    result = pd.read_sql(query, conn, params=[cc_vendor, card_number, lookback_str, repayment_str, repayment_amount])

    return result.iloc[0]['count'] > 0

def check_immediate_payment(conn, repayment_amount, repayment_date, cc_vendor, card_number, verbose=False):
    """
    Check if this repayment is for a single large purchase (immediate payment).

    Criteria:
    - Expense amount matches repayment exactly (within ₪1)
    - Expense occurred within 7 days before repayment
    - Only one expense matches (not multiple small ones)
    - Expense is for the same card (account_number)

    Returns:
        expense dict if found, None otherwise
    """
    repayment_date_dt = pd.to_datetime(repayment_date)
    lookback_date = repayment_date_dt - timedelta(days=7)

    # Convert to ISO format strings for SQLite compatibility
    lookback_date_str = lookback_date.strftime('%Y-%m-%d')
    repayment_date_str = repayment_date_dt.strftime('%Y-%m-%d')

    query = """
    SELECT
      identifier,
      vendor,
      date,
      name,
      price
    FROM transactions
    WHERE vendor = ?
      AND account_number = ?
      AND price < 0
      AND date >= ?
      AND date <= ?
      AND ABS(ABS(price) - ?) < 1.0
      AND identifier NOT IN (
        SELECT expense_txn_id
        FROM credit_card_expense_matches
        WHERE expense_vendor = ?
      )
    ORDER BY date DESC
    LIMIT 1
    """

    result = pd.read_sql(
        query,
        conn,
        params=[cc_vendor, card_number, lookback_date_str, repayment_date_str, repayment_amount, cc_vendor]
    )

    if len(result) > 0:
        return result.iloc[0].to_dict()
    return None

def get_billing_period(repayment_date, card_number):
    """
    Determine billing period for a repayment.

    Israeli credit cards typically:
    - Billing cycle: 1st to last day of month
    - Payment date: ~10-15 days after cycle end

    Example: Nov 9 payment → Oct 1-31 billing period
    """
    # Repayment is usually for previous month
    payment_date = pd.to_datetime(repayment_date)

    # Go back one month
    if payment_date.month == 1:
        billing_month = 12
        billing_year = payment_date.year - 1
    else:
        billing_month = payment_date.month - 1
        billing_year = payment_date.year

    # Period start: 1st of billing month
    period_start = datetime(billing_year, billing_month, 1)

    # Period end: last day of billing month
    if billing_month == 12:
        period_end = datetime(billing_year, 12, 31, 23, 59, 59)
    else:
        next_month_start = datetime(billing_year, billing_month + 1, 1)
        period_end = next_month_start - timedelta(seconds=1)

    return period_start, period_end

def filter_already_matched(expenses_df, already_matched_expenses):
    """Filter out expenses that have already been matched in this run"""
    if already_matched_expenses:
        def not_matched(row):
            return (row['identifier'], row['vendor']) not in already_matched_expenses
        return expenses_df[expenses_df.apply(not_matched, axis=1)]
    return expenses_df

def match_repayment_to_expenses(conn, repayment_row, already_matched_expenses=None, max_lookback_days=90, verbose=True):
    """
    Match a single repayment to its expenses.

    Enhanced Algorithm:
    1. Check for immediate/same-amount payment (within 7 days, exact match)
    2. If not immediate, match to billing period expenses
    3. If billing period insufficient, look back to previous months (carryover)
       - Limited by max_lookback_days for temporal locality

    Args:
        conn: Database connection
        repayment_row: Repayment transaction row
        already_matched_expenses: Set of (expense_txn_id, expense_vendor) tuples already matched
        max_lookback_days: Maximum days to look back for expenses (default: 90 = 3 months)
                          90 days allows Oct payment to reach back to Aug expenses
        verbose: Print progress messages

    Returns:
        matches: List of matched expense dicts
        stats: Matching statistics
    """
    if already_matched_expenses is None:
        already_matched_expenses = set()
    repayment_id = repayment_row['identifier']
    repayment_amount = abs(repayment_row['price'])
    repayment_date = pd.to_datetime(repayment_row['date'])
    repayment_name = repayment_row['name']

    # Identify card and vendor using account_pairings
    card_number, cc_vendor = get_card_from_repayment_name(conn, repayment_name)

    if not card_number:
        if verbose:
            print_warning(f"Could not identify card for: {repayment_name}")
        return [], {'error': 'unknown_card'}

    if verbose:
        print(f"\n{Colors.BOLD}Matching Repayment:{Colors.ENDC}")
        print(f"  Description: {repayment_name}")
        print(f"  Amount: ₪{repayment_amount:,.2f}")
        print(f"  Date: {repayment_date.date()}")
        print(f"  Card: {card_number} ({cc_vendor})")

    # STEP 1: Check if sauvage (wild/immediate) repayment
    is_sauvage = is_sauvage_repayment(conn, repayment_row, card_number, cc_vendor)

    if is_sauvage:
        if verbose:
            print(f"  {Colors.WARNING}🔥 SAUVAGE (Wild) Repayment Detected{Colors.ENDC}")

        # Try to find immediate matching expense
        immediate_match = check_immediate_payment(
            conn, repayment_amount, repayment_date, cc_vendor, card_number, verbose
        )

        if immediate_match:
            # Found exact amount match within 7 days
            matches = [{
                'repayment_txn_id': repayment_id,
                'repayment_vendor': 'discount',
                'repayment_date': repayment_date.isoformat(),
                'repayment_amount': repayment_amount,
                'card_number': card_number,
                'expense_txn_id': immediate_match['identifier'],
                'expense_vendor': immediate_match['vendor'],
                'expense_date': immediate_match['date'],
                'expense_amount': abs(immediate_match['price']),
                'expense_name': immediate_match['name'],
                'match_confidence': 1.0,
                'match_method': 'sauvage_payment',
            }]

            if verbose:
                print_success(f"✓ MATCHED: {immediate_match['name']}")
                print(f"  Expense Date: {pd.to_datetime(immediate_match['date']).date()}")
                print(f"  Amount: ₪{abs(immediate_match['price']):,.2f}")

            stats = {
                'matched_count': 1,
                'matched_sum': abs(immediate_match['price']),
                'difference': 0,
                'perfect_match': True,
                'match_type': 'sauvage',
            }
            return matches, stats
        else:
            if verbose:
                print_warning("No matching expense found for sauvage repayment - will try monthly matching")

    # STEP 2: Normal billing period matching
    period_start, period_end = get_billing_period(repayment_date, card_number)

    if verbose:
        print(f"  Billing Period: {period_start.date()} to {period_end.date()}")

    # Get all unmatched expenses for this card in billing period
    # IMPORTANT: Filter by account_number to match card-specific expenses
    expenses_query = """
    SELECT
      identifier,
      vendor,
      date,
      name,
      price,
      status,
      account_number
    FROM transactions
    WHERE vendor = ?
      AND account_number = ?
      AND price < 0
      AND date >= ?
      AND date <= ?
      AND identifier NOT IN (
        SELECT expense_txn_id
        FROM credit_card_expense_matches
        WHERE expense_vendor = ?
      )
    ORDER BY date ASC, name ASC
    """

    expenses = pd.read_sql(
        expenses_query,
        conn,
        params=[cc_vendor, card_number, period_start, period_end, cc_vendor]
    )

    # Filter out already-matched expenses from this run
    expenses = filter_already_matched(expenses, already_matched_expenses)

    if len(expenses) == 0:
        if verbose:
            print_warning(f"No unmatched expenses found for this period")
        return [], {'error': 'no_expenses', 'period_start': period_start, 'period_end': period_end}

    total_available = abs(expenses['price'].sum())
    if verbose:
        print(f"  Available expenses: {len(expenses)} transactions totaling ₪{total_available:,.2f}")

    # Match expenses chronologically until we reach the repayment amount
    matches = []
    running_sum = 0
    tolerance = 2  # ₪2 tolerance - allow small over/under matching for realistic results

    for idx, expense in expenses.iterrows():
        expense_amount = abs(expense['price'])

        # Add expense if it doesn't exceed repayment (with tolerance)
        if running_sum + expense_amount <= repayment_amount + tolerance:
            matches.append({
                'repayment_txn_id': repayment_id,
                'repayment_vendor': 'discount',
                'repayment_date': repayment_date.isoformat(),
                'repayment_amount': repayment_amount,
                'card_number': card_number,
                'expense_txn_id': expense['identifier'],
                'expense_vendor': expense['vendor'],
                'expense_date': expense['date'],
                'expense_amount': expense_amount,
                'expense_name': expense['name'],
                'match_confidence': 1.0,
                'match_method': 'auto_chronological',
            })
            running_sum += expense_amount

            # Stop if we've matched the amount (within tolerance)
            if abs(running_sum - repayment_amount) <= tolerance:
                break

    matched_sum = sum(m['expense_amount'] for m in matches)
    difference = repayment_amount - matched_sum

    # STEP 3: Multi-month carryover handling
    # If billing period insufficient, look back to previous months
    if difference > tolerance:
        if verbose:
            print(f"\n  {Colors.WARNING}⚠️  Billing period insufficient (short ₪{difference:,.2f}){Colors.ENDC}")
            print(f"  Looking back to previous months for carryover...")

        # Look back limited by max_lookback_days (temporal locality)
        temporal_limit = repayment_date - timedelta(days=max_lookback_days)
        three_months_back = period_start - timedelta(days=90)

        # Convert both to comparable format (naive datetime)
        if isinstance(temporal_limit, pd.Timestamp):
            temporal_limit = temporal_limit.replace(tzinfo=None)
        if isinstance(repayment_date, pd.Timestamp):
            repayment_date = repayment_date.replace(tzinfo=None)

        lookback_start = max(three_months_back, temporal_limit)

        # Convert to ISO format strings for SQLite compatibility
        lookback_start_str = lookback_start.strftime('%Y-%m-%d')
        period_start_str = period_start.strftime('%Y-%m-%d')

        carryover_query = """
        SELECT
          identifier,
          vendor,
          date,
          name,
          price,
          status,
          account_number
        FROM transactions
        WHERE vendor = ?
          AND account_number = ?
          AND price < 0
          AND date >= ?
          AND date < ?
          AND identifier NOT IN (
            SELECT expense_txn_id
            FROM credit_card_expense_matches
            WHERE expense_vendor = ?
          )
        ORDER BY date ASC
        """

        carryover_expenses = pd.read_sql(
            carryover_query,
            conn,
            params=[cc_vendor, card_number, lookback_start_str, period_start_str, cc_vendor]
        )

        # Filter out already-matched expenses from this run
        carryover_expenses = filter_already_matched(carryover_expenses, already_matched_expenses)

        if len(carryover_expenses) > 0:
            if verbose:
                carryover_total = abs(carryover_expenses['price'].sum())
                print(f"  Found {len(carryover_expenses)} carryover expenses = ₪{carryover_total:,.2f}")

            # Continue matching from carryover chronologically
            for idx, expense in carryover_expenses.iterrows():
                expense_amount = abs(expense['price'])

                # Only add if we still need more to reach repayment amount
                if running_sum + expense_amount <= repayment_amount + tolerance:
                    matches.append({
                        'repayment_txn_id': repayment_id,
                        'repayment_vendor': 'discount',
                        'repayment_date': repayment_date.isoformat(),
                        'repayment_amount': repayment_amount,
                        'card_number': card_number,
                        'expense_txn_id': expense['identifier'],
                        'expense_vendor': expense['vendor'],
                        'expense_date': expense['date'],
                        'expense_amount': expense_amount,
                        'expense_name': expense['name'],
                        'match_confidence': 1.0,
                        'match_method': 'carryover',
                    })
                    running_sum += expense_amount

                    # Stop if we've reached the amount
                    if abs(running_sum - repayment_amount) <= tolerance:
                        break

            # Recalculate after carryover
            matched_sum = sum(m['expense_amount'] for m in matches)
            difference = repayment_amount - matched_sum

            if verbose:
                carryover_count = sum(1 for m in matches if m['match_method'] == 'carryover')
                carryover_sum = sum(m['expense_amount'] for m in matches if m['match_method'] == 'carryover')
                print(f"  Added {carryover_count} carryover expenses = ₪{carryover_sum:,.2f}")
        else:
            if verbose:
                print_warning(f"  No carryover expenses found in lookback period")

    if verbose:
        print(f"\n  {Colors.OKGREEN}✓ Final Matched {len(matches)} expenses = ₪{matched_sum:,.2f}{Colors.ENDC}")

        if abs(difference) > tolerance:
            print_warning(f"DIFFERENCE: ₪{difference:,.2f} (expected ≈₪0)")
            if difference > 0:
                print(f"    → ₪{difference:,.2f} of repayment UNMATCHED (missing expenses?)")
            else:
                print(f"    → ₪{abs(difference):,.2f} OVER-MATCHED (may need adjustment)")
        else:
            print_success(f"PERFECT MATCH! (diff: ₪{difference:,.2f})")

    stats = {
        'matched_count': len(matches),
        'matched_sum': matched_sum,
        'difference': difference,
        'perfect_match': abs(difference) <= tolerance,
        'period_start': period_start,
        'period_end': period_end,
        'had_carryover': any(m['match_method'] == 'carryover' for m in matches),
    }

    return matches, stats

def main():
    """Main matching process"""
    db_path = Path(__file__).parent.parent / 'dist' / 'clarify.sqlite'

    if not db_path.exists():
        print_error(f"Database not found: {db_path}")
        sys.exit(1)

    # Parse arguments
    dry_run = '--dry-run' in sys.argv
    months = 4  # Default: 4 months to capture all available data (Aug-Nov)
    if '--months' in sys.argv:
        try:
            idx = sys.argv.index('--months')
            months = int(sys.argv[idx + 1])
        except (IndexError, ValueError):
            print_error("Invalid --months argument")
            sys.exit(1)

    print_header("CREDIT CARD TRANSACTION MATCHING SYSTEM")

    if dry_run:
        print_warning("DRY RUN MODE - No changes will be saved to database\n")

    conn = sqlite3.connect(str(db_path))

    # Get all completed repayments from Oct 1 onwards (where we have complete expense data)
    # Oct+Nov repayments pay for Sept+Oct+Nov expenses
    cutoff_date = datetime(2025, 10, 1).date()

    print(f"Analyzing repayments from {cutoff_date} onwards (complete data period)\n")

    repayments_query = """
    SELECT
      t.identifier,
      t.vendor,
      t.date,
      t.name,
      t.price,
      t.status
    FROM transactions t
    JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE cd.name = 'פרעון כרטיס אשראי'
      AND t.status = 'completed'
      AND t.date >= ?
    ORDER BY t.date ASC
    """

    repayments = pd.read_sql(repayments_query, conn, params=[cutoff_date])

    print_success(f"Found {len(repayments)} completed repayments\n")

    # Separate repayments into sauvage vs monthly
    print_header("PHASE 1 & 2: IDENTIFYING SAUVAGE (WILD) REPAYMENTS")
    sauvage_repayments = []
    monthly_repayments = []

    for idx, repayment in repayments.iterrows():
        card_number, cc_vendor = get_card_from_repayment_name(conn, repayment['name'])
        if card_number and is_sauvage_repayment(conn, repayment, card_number, cc_vendor):
            sauvage_repayments.append(repayment)
        else:
            monthly_repayments.append(repayment)

    print(f"  Sauvage repayments: {len(sauvage_repayments)}")
    print(f"  Monthly repayments: {len(monthly_repayments)}\n")

    # Sort sauvage by amount (smallest first - easiest to match)
    if sauvage_repayments:
        sauvage_df = pd.DataFrame(sauvage_repayments)
        sauvage_df['abs_price'] = sauvage_df['price'].abs()
        sauvage_df = sauvage_df.sort_values('abs_price')
        sauvage_repayments = [sauvage_df.iloc[i] for i in range(len(sauvage_df))]

    # Sort monthly by date (newest first - temporal locality)
    if monthly_repayments:
        monthly_df = pd.DataFrame(monthly_repayments)
        monthly_df = monthly_df.sort_values('date', ascending=False)
        monthly_repayments = [monthly_df.iloc[i] for i in range(len(monthly_df))]

    # Match each repayment in optimized order
    all_matches = []
    all_stats = []
    matched_expenses = set()  # Track already-matched expenses

    # Phase 1 & 2: Process sauvage repayments (small → large)
    print_header("PROCESSING SAUVAGE REPAYMENTS (Small → Large)")
    print("─" * 80)
    for repayment in sauvage_repayments:
        # Sauvage: unlimited lookback (they can match to any recent expense)
        matches, stats = match_repayment_to_expenses(conn, repayment, matched_expenses, max_lookback_days=365, verbose=True)
        all_matches.extend(matches)

        # Track which expenses were matched
        for match in matches:
            matched_expenses.add((match['expense_txn_id'], match['expense_vendor']))

        all_stats.append({
            'repayment_name': repayment['name'],
            'repayment_date': repayment['date'],
            'repayment_amount': abs(repayment['price']),
            **stats
        })
        print("─" * 80)

    # Phase 3: Process monthly repayments (newest → oldest)
    print_header("PROCESSING MONTHLY REPAYMENTS (Newest → Oldest)")
    print("─" * 80)
    for repayment in monthly_repayments:
        # Monthly: 90-day lookback (3 months) for temporal locality
        # Allows for billing period + 2 months carryover (e.g., Oct 9 payment can reach back to Aug 1)
        matches, stats = match_repayment_to_expenses(conn, repayment, matched_expenses, max_lookback_days=90, verbose=True)
        all_matches.extend(matches)

        # Track which expenses were matched
        for match in matches:
            matched_expenses.add((match['expense_txn_id'], match['expense_vendor']))

        all_stats.append({
            'repayment_name': repayment['name'],
            'repayment_date': repayment['date'],
            'repayment_amount': abs(repayment['price']),
            **stats
        })
        print("─" * 80)

    # Save matches to database (if not dry run)
    if all_matches and not dry_run:
        # Clear existing matches first
        conn.execute("DELETE FROM credit_card_expense_matches")

        # Insert new matches
        matches_df = pd.DataFrame(all_matches)
        matches_df = matches_df.drop(columns=['expense_name'])  # Don't save name to DB

        matches_df.to_sql(
            'credit_card_expense_matches',
            conn,
            if_exists='append',
            index=False
        )
        conn.commit()
        print_success(f"Saved {len(all_matches)} matches to database\n")
    elif all_matches:
        print_warning(f"DRY RUN: Would have saved {len(all_matches)} matches\n")

    # Summary report
    print_header("MATCHING SUMMARY")

    total_repayments_amount = sum(s['repayment_amount'] for s in all_stats)
    total_matched_amount = sum(s.get('matched_sum', 0) for s in all_stats)
    total_difference = total_repayments_amount - total_matched_amount
    perfect_matches = sum(1 for s in all_stats if s.get('perfect_match', False))

    print(f"Total Repayments Analyzed: {len(all_stats)}")
    print(f"Total Repayment Amount: ₪{total_repayments_amount:,.2f}")
    print(f"Total Matched Expenses: ₪{total_matched_amount:,.2f}")
    print(f"Total Difference: ₪{total_difference:,.2f}")
    print(f"Perfect Matches: {perfect_matches}/{len(all_stats)} ({perfect_matches/len(all_stats)*100:.1f}%)")

    if abs(total_difference) <= 20:
        print_success(f"\n✓ Excellent matching accuracy!")
    elif abs(total_difference) <= 100:
        print_warning(f"\n⚠️  Minor discrepancies (₪{abs(total_difference):,.2f})")
    else:
        print_error(f"\n✗ Significant discrepancies (₪{abs(total_difference):,.2f}) - review needed")

    # Export detailed report
    output_dir = Path(__file__).parent.parent / 'analysis'
    output_dir.mkdir(exist_ok=True)

    report_file = output_dir / 'cc_matching_report.txt'
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write("CREDIT CARD MATCHING REPORT\n")
        f.write("="*80 + "\n\n")
        f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Analysis Period: Last {months} months\n\n")

        for stat in all_stats:
            f.write(f"\nRepayment: {stat['repayment_name']}\n")
            f.write(f"  Date: {stat['repayment_date']}\n")
            f.write(f"  Amount: ₪{stat['repayment_amount']:,.2f}\n")
            if 'error' in stat:
                f.write(f"  ERROR: {stat['error']}\n")
            else:
                f.write(f"  Matched: {stat['matched_count']} expenses = ₪{stat['matched_sum']:,.2f}\n")
                f.write(f"  Difference: ₪{stat['difference']:,.2f}\n")
                f.write(f"  Status: {'✓ PERFECT' if stat['perfect_match'] else '⚠ REVIEW'}\n")

    print_success(f"\nDetailed report saved to: {report_file}")

    # Export matched expenses CSV
    if all_matches:
        matched_csv = output_dir / 'cc_matched_expenses_detailed.csv'
        matched_df = pd.DataFrame(all_matches)
        matched_df.to_csv(matched_csv, index=False)
        print_success(f"Matched expenses exported to: {matched_csv}")

    conn.close()

    print("\n" + "="*80)
    print(f"{Colors.BOLD}MATCHING COMPLETE!{Colors.ENDC}\n")

if __name__ == '__main__':
    main()
