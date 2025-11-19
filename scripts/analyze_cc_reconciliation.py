#!/usr/bin/env python3
"""
Credit Card Reconciliation Analysis Script

Analyzes credit card expenses vs repayments to calculate true available bank balance.

Usage:
    python scripts/analyze_cc_reconciliation.py

Output:
    - Console summary of findings
    - CSV files with matched/unmatched transactions
    - Pending debt history
"""

import sqlite3
import pandas as pd
import sys
from pathlib import Path
from datetime import datetime

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
    UNDERLINE = '\033[4m'

def print_header(text):
    print(f"\n{Colors.BOLD}{Colors.HEADER}{'='*70}")
    print(text)
    print(f"{'='*70}{Colors.ENDC}\n")

def print_section(text):
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}{text}{Colors.ENDC}")

def print_success(text):
    print(f"{Colors.OKGREEN}✓ {text}{Colors.ENDC}")

def print_warning(text):
    print(f"{Colors.WARNING}⚠️  {text}{Colors.ENDC}")

def print_error(text):
    print(f"{Colors.FAIL}✗ {text}{Colors.ENDC}")


def chronological_matching(expenses_df, repayments_df, tolerance=10):
    """
    Match CC expenses to repayments chronologically.

    Args:
        expenses_df: DataFrame of CC expenses
        repayments_df: DataFrame of CC repayments
        tolerance: Amount tolerance in ₪

    Returns:
        matched_expenses, unmatched_expenses, matched_repayments
    """
    expenses = expenses_df.copy().sort_values('date')
    repayments = repayments_df.copy().sort_values('date')

    expenses['matched'] = False
    expenses['matched_to_repayment'] = None
    expenses['repayment_date'] = None

    matched_repayments = []

    for rep_idx, repayment in repayments.iterrows():
        repayment_amount = abs(repayment['price'])
        repayment_date = repayment['date']

        # Get unpaid expenses before this repayment
        unpaid = expenses[
            (~expenses['matched']) &
            (expenses['date'] <= repayment_date)
        ].copy()

        if len(unpaid) == 0:
            continue

        # Try to match expenses to this repayment
        running_sum = 0
        matched_indices = []

        for exp_idx, expense in unpaid.iterrows():
            expense_amount = abs(expense['price'])

            if running_sum + expense_amount <= repayment_amount + tolerance:
                matched_indices.append(exp_idx)
                running_sum += expense_amount

                # If we're close enough to the repayment amount, stop
                if abs(running_sum - repayment_amount) <= tolerance:
                    break

        # Mark matched expenses
        if matched_indices:
            expenses.loc[matched_indices, 'matched'] = True
            expenses.loc[matched_indices, 'matched_to_repayment'] = rep_idx
            expenses.loc[matched_indices, 'repayment_date'] = repayment_date

            matched_repayments.append({
                'repayment_idx': rep_idx,
                'repayment_date': repayment_date,
                'repayment_amount': repayment_amount,
                'matched_amount': running_sum,
                'difference': repayment_amount - running_sum,
                'expense_count': len(matched_indices)
            })

    matched_df = expenses[expenses['matched']]
    unmatched_expenses_df = expenses[~expenses['matched']]
    matched_repayments_df = pd.DataFrame(matched_repayments)

    return matched_df, unmatched_expenses_df, matched_repayments_df


def main():
    print_header("CREDIT CARD RECONCILIATION ANALYSIS")

    # Database path
    db_path = Path(__file__).parent.parent / 'dist' / 'clarify.sqlite'

    if not db_path.exists():
        print_error(f"Database not found: {db_path}")
        sys.exit(1)

    print_success(f"Connected to database: {db_path}")

    try:
        conn = sqlite3.connect(str(db_path))

        # ========== PHASE 1: Load Data ==========
        print_section("Phase 1: Loading Data")

        # Load transactions (removed vendor_credentials JOIN to prevent duplicates)
        # Note: vendor_credentials has multiple rows per vendor (e.g., 2 for "max")
        # which causes each transaction to appear multiple times
        query_transactions = """
        SELECT DISTINCT
            t.*,
            cd.name as category_name,
            cd.category_type
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        WHERE t.date >= '2025-10-01' AND t.date <= '2025-11-12'
        """
        transactions = pd.read_sql(query_transactions, conn)
        transactions['date'] = pd.to_datetime(transactions['date'])
        print_success(f"Loaded {len(transactions):,} transactions (Oct 1 - Nov 12, 2025)")

        # Load account pairings
        pairings = pd.read_sql("SELECT * FROM account_pairings WHERE is_active = 1", conn)
        print_success(f"Loaded {len(pairings)} active account pairings")

        # Load bank balances (current/latest)
        query_balances = """
        SELECT
            ia.account_name,
            fi.vendor_code as bank_vendor,
            ih.current_value,
            ih.as_of_date
        FROM investment_accounts ia
        JOIN investment_holdings ih ON ia.id = ih.account_id
        LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
        WHERE ia.account_type = 'bank_balance'
          AND ia.is_active = 1
          AND ih.as_of_date = (SELECT MAX(as_of_date) FROM investment_holdings WHERE account_id = ia.id)
        """
        bank_balances = pd.read_sql(query_balances, conn)
        print_success(f"Loaded {len(bank_balances)} bank accounts (Latest balance: ₪{bank_balances['current_value'].sum():,.2f})")

        # ========== PHASE 2: Identify Transactions ==========
        print_section("Phase 2: Identifying Transaction Types")

        # Get CC repayment category
        cc_repayment_cat = pd.read_sql(
            "SELECT * FROM category_definitions WHERE name LIKE '%פרעון כרטיס אשראי%'",
            conn
        )

        if len(cc_repayment_cat) == 0:
            print_error("Credit card repayment category not found!")
            sys.exit(1)

        cc_repayment_cat_id = cc_repayment_cat.iloc[0]['id']
        print_success(f"CC Repayment category: {cc_repayment_cat.iloc[0]['name']}")

        # Get CC vendors from pairings
        cc_vendors = pairings['credit_card_vendor'].unique()

        # CC repayments (from bank account)
        cc_repayments = transactions[
            transactions['category_definition_id'] == cc_repayment_cat_id
        ].copy()

        # Separate completed vs pending repayments
        completed_repayments = cc_repayments[cc_repayments['status'] == 'completed'].copy()
        pending_repayments = cc_repayments[cc_repayments['status'] == 'pending'].copy()

        print_success(f"Found {len(completed_repayments)} completed CC repayments (₪{abs(completed_repayments['price'].sum()):,.2f})")
        if len(pending_repayments) > 0:
            print_warning(f"Found {len(pending_repayments)} pending CC repayments (₪{abs(pending_repayments['price'].sum()):,.2f} - future payments)")

        # CC expenses
        cc_expenses = transactions[
            (transactions['vendor'].isin(cc_vendors)) &
            (transactions['price'] < 0)
        ].copy()
        print_success(f"Found {len(cc_expenses)} CC expense transactions (₪{abs(cc_expenses['price'].sum()):,.2f})")

        # ========== PHASE 3: Matching Algorithm ==========
        print_section("Phase 3: Matching Expenses to Repayments")

        # Only match against COMPLETED repayments (pending ones are future payments)
        matched, unmatched_exp, matched_reps = chronological_matching(cc_expenses, completed_repayments)

        match_rate = (len(matched) / len(cc_expenses) * 100) if len(cc_expenses) > 0 else 0
        print_success(f"Matched {len(matched)} / {len(cc_expenses)} expenses ({match_rate:.1f}%)")
        print(f"  Matched amount: ₪{abs(matched['price'].sum()):,.2f}")
        print(f"  Unmatched amount: ₪{abs(unmatched_exp['price'].sum()):,.2f}")

        # Get last completed repayment date for better insights
        if len(completed_repayments) > 0:
            last_repayment_date = completed_repayments['date'].max()
            print(f"\n  Last completed repayment: {last_repayment_date.strftime('%Y-%m-%d')}")

            # Show expenses after last repayment (these are truly pending)
            expenses_after_last_payment = cc_expenses[cc_expenses['date'] > last_repayment_date]
            print(f"  Expenses after last repayment: {len(expenses_after_last_payment)} (₪{abs(expenses_after_last_payment['price'].sum()):,.2f})")

        # ========== PHASE 4: Calculate True Balance ==========
        print_section("Phase 4: Calculating True Available Balance")

        current_bank_balance = bank_balances['current_value'].sum()

        # Pending debt = expenses after last completed repayment
        # (unmatched could include expenses paid by earlier repayments if matching isn't perfect)
        if len(completed_repayments) > 0:
            last_repayment_date = completed_repayments['date'].max()
            truly_pending_expenses = cc_expenses[cc_expenses['date'] > last_repayment_date]
            pending_cc_debt = abs(truly_pending_expenses['price'].sum())
        else:
            # No repayments yet, all expenses are pending
            pending_cc_debt = abs(cc_expenses['price'].sum())

        true_available_balance = current_bank_balance - pending_cc_debt

        difference = current_bank_balance - true_available_balance
        percentage = (difference / current_bank_balance * 100) if current_bank_balance != 0 else 0

        print_header("FINAL RESULTS")

        print(f"\n{Colors.BOLD}1. CURRENT BANK BALANCE (from investment_holdings):{Colors.ENDC}")
        print(f"   ₪{current_bank_balance:,.2f}")

        print(f"\n{Colors.BOLD}2. CREDIT CARD ANALYSIS SUMMARY:{Colors.ENDC}")
        print(f"   Total CC Expenses (Oct 1 - Nov 12): ₪{abs(cc_expenses['price'].sum()):,.2f}")
        print(f"   Completed Repayments: ₪{abs(completed_repayments['price'].sum()):,.2f}")
        if len(pending_repayments) > 0:
            print(f"   Pending Repayments (future): ₪{abs(pending_repayments['price'].sum()):,.2f}")
        if len(completed_repayments) > 0:
            print(f"   Last completed payment: {last_repayment_date.strftime('%Y-%m-%d')}")

        print(f"\n{Colors.BOLD}3. PENDING CREDIT CARD DEBT (expenses after last repayment):{Colors.ENDC}")
        print(f"   {Colors.WARNING}₪{pending_cc_debt:,.2f}{Colors.ENDC}")
        if len(completed_repayments) > 0:
            print(f"   - {len(truly_pending_expenses)} transactions after {last_repayment_date.strftime('%Y-%m-%d')}")
        else:
            print(f"   - {len(cc_expenses)} total transactions (no repayments yet)")
        print(f"   - This represents CC purchases not yet paid from bank")

        print(f"\n{Colors.BOLD}4. TRUE AVAILABLE BANK BALANCE:{Colors.ENDC}")
        print(f"   {Colors.OKGREEN}{Colors.BOLD}₪{true_available_balance:,.2f}{Colors.ENDC}")
        print(f"   - Calculation: ₪{current_bank_balance:,.2f} - ₪{pending_cc_debt:,.2f}")

        print(f"\n{Colors.BOLD}5. IMPACT:{Colors.ENDC}")
        if difference > 0:
            print_warning(f"The shown balance is OVERSTATED by ₪{difference:,.2f} ({percentage:.1f}%)")
            print_warning(f"You have ₪{difference:,.2f} LESS available than shown!")
            print(f"   This amount is committed to paying off credit card expenses.")
        else:
            print_success(f"Balance is accurate or understated by ₪{abs(difference):,.2f}")

        # ========== PHASE 5: Export Results ==========
        print_section("Phase 5: Exporting Results")

        output_dir = Path(__file__).parent.parent / 'analysis'
        output_dir.mkdir(exist_ok=True)

        # Export matched expenses
        matched_file = output_dir / 'matched_cc_expenses.csv'
        matched[['date', 'vendor', 'name', 'price', 'category_name', 'repayment_date']].to_csv(
            matched_file, index=False
        )
        print_success(f"Exported matched expenses: {matched_file}")

        # Export truly pending expenses (after last repayment)
        unmatched_file = output_dir / 'unmatched_cc_expenses.csv'
        if len(completed_repayments) > 0:
            truly_pending_expenses[['date', 'vendor', 'name', 'price', 'category_name']].to_csv(
                unmatched_file, index=False
            )
            print_success(f"Exported {len(truly_pending_expenses)} pending expenses: {unmatched_file}")
        else:
            cc_expenses[['date', 'vendor', 'name', 'price', 'category_name']].to_csv(
                unmatched_file, index=False
            )
            print_success(f"Exported {len(cc_expenses)} pending expenses (no repayments): {unmatched_file}")

        # Export summary
        summary_file = output_dir / 'cc_reconciliation_summary.txt'
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write("CREDIT CARD RECONCILIATION ANALYSIS SUMMARY\n")
            f.write("="*70 + "\n\n")
            f.write(f"Analysis Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"CURRENT BANK BALANCE: ₪{current_bank_balance:,.2f}\n")
            f.write(f"PENDING CC DEBT: ₪{pending_cc_debt:,.2f}\n")
            f.write(f"TRUE AVAILABLE BALANCE: ₪{true_available_balance:,.2f}\n\n")
            f.write(f"DIFFERENCE: ₪{difference:,.2f} ({percentage:.1f}%)\n\n")
            f.write(f"MATCHING STATISTICS:\n")
            f.write(f"  - Total CC expenses: {len(cc_expenses)}\n")
            f.write(f"  - Matched expenses: {len(matched)} ({match_rate:.1f}%)\n")
            f.write(f"  - Unmatched expenses: {len(unmatched_exp)}\n\n")
            f.write(f"RECOMMENDATION:\n")
            f.write(f"The dashboard should display:\n")
            f.write(f"  • Actual Bank Balance: ₪{current_bank_balance:,.2f}\n")
            f.write(f"  • Pending CC Debt: ₪{pending_cc_debt:,.2f}\n")
            f.write(f"  • Available Balance: ₪{true_available_balance:,.2f}\n")

        print_success(f"Exported summary: {summary_file}")

        print_header("ANALYSIS COMPLETE")
        print(f"\nResults exported to: {output_dir}")
        print(f"\nNext steps:")
        print(f"  1. Review unmatched_cc_expenses.csv to understand pending debt")
        print(f"  2. Update dashboard to show true available balance")
        print(f"  3. Consider implementing automatic expense matching")

        conn.close()

    except Exception as e:
        print_error(f"Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
